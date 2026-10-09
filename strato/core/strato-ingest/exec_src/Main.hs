{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | strato-ingest: this core cell's transaction ingress.
--
-- The API tier posts batches of 'IngestEvent's here, to every cell, so
-- each cell's sequencer holds the same transactions and a standby promoted
-- later already has them in its mempool. A batch is appended to the cell's
-- own durable @ingest_tx@ log, which the sequencer reads under its own
-- subscriber, and is acknowledged only once the append has returned: a
-- transaction the API tier reported accepted survives the sequencer
-- restarting. Only transactions are taken; consensus messages travel by
-- p2p, never through here. The listener is for the API tier alone and
-- carries no authentication of its own: keep it inside the VPC, behind the
-- security group that admits the API tier's tasks.
module Main (main) where

import BlockApps.Init (blockappsInit)
import BlockApps.Logging
import Blockchain.EthConf
import Blockchain.Sequencer.Event (IngestEvent (..))
import Blockchain.Sequencer.Kafka (ingestTxTopicName, writeIngestTx)
import Blockchain.Data.Transaction (transactionHash)
import Blockchain.Model.WrappedBlock (IngestTx (..))
import Blockchain.Strato.Model.Keccak256 (keccak256ToByteString, keccak256ToHex)
import qualified Strato.Tracing as Tr
import Strato.Tracing.Wai (tracingMiddleware)
import qualified Control.Monad.Composable.Streaming as Local
import Control.Concurrent (forkIO)
import Control.Monad (void)
import Control.Monad.Composable.Base (runEff)
import Data.Aeson (encode, object, (.=))
import qualified Data.Binary as Bin
import qualified Data.Text as T
import HFlags
import Instrumentation
import Network.HTTP.Types (methodGet, methodPost, status200, status400, status404, status405, status500)
import Network.Wai
import Network.Wai.Handler.Warp (run, runSettings, setHost, setPort, defaultSettings)
import Network.Wai.Middleware.Prometheus (metricsApp)
import Prometheus
import Data.String (fromString)
import UnliftIO (SomeException, try)

defineFlag "port" (8600 :: Int) "Port the ingress listens on"
defineFlag "listen" ("0.0.0.0" :: String) "Address the ingress binds to"

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

{-# NOINLINE acceptedCounter #-}
acceptedCounter :: Counter
acceptedCounter = unsafeRegister . counter $ Info "strato_ingest_accepted_total" "Transactions accepted from the API tier and appended to this cell's ingest log"

{-# NOINLINE droppedCounter #-}
droppedCounter :: Counter
droppedCounter = unsafeRegister . counter $ Info "strato_ingest_dropped_total" "Non-transaction events dropped from ingress batches"

main :: IO ()
main = do
  blockappsInit "strato-ingest"
  runInstrumentation "strato-ingest"
  _ <- forkIO $ run 10781 metricsApp
  Tr.initTracing "strato-ingest"
  _ <- $initHFlags "strato-ingest: this core cell's transaction ingress"
  -- The sequencer's source must exist before the first batch lands.
  runEff $ runStreamMConfigured "strato-ingest" $ Local.createTopicAndWait ingestTxTopicName
  putStrLn $ "strato-ingest: listening on " ++ flags_listen ++ ":" ++ show flags_port ++ ", appending to " ++ show ingestTxTopicName
  runSettings (setHost (fromString flags_listen) $ setPort flags_port defaultSettings) (tracingMiddleware "strato-ingest" app)

app :: Application
app req respond = case (requestMethod req, pathInfo req) of
  (m, ["ingest"]) | m == methodPost -> do
    body <- strictRequestBody req
    case Bin.decodeOrFail body of
      Left (_, _, err) -> respond $ responseLBS status400 [("Content-Type", "text/plain")] (fromString ("undecodable batch: " ++ err))
      Right (_, _, events) -> do
        let txs = [e | e@IETx {} <- events]
            dropped = length events - length txs
        started <- Tr.nowNanos
        r <- try . runEff . runLogging $ do
          if null txs
            then pure ()
            else do
              _ <- runStreamMPooled "strato-ingest" $ writeIngestTx txs
              $logInfoS "strato-ingest" . T.pack $ "accepted " ++ show (length txs) ++ " transaction(s)"
          if dropped > 0
            then $logWarnS "strato-ingest" . T.pack $ "dropped " ++ show dropped ++ " non-transaction event(s) from an ingress batch"
            else pure ()
        case r of
          Left (e :: SomeException) -> do
            putStrLn $ "strato-ingest: append failed: " ++ show e
            respond $ responseLBS status500 [("Content-Type", "text/plain")] (fromString ("append failed: " ++ show e))
          Right () -> do
            void $ addCounter acceptedCounter (fromIntegral (length txs))
            void $ addCounter droppedCounter (fromIntegral dropped)
            recordIngressSpans started txs
            respond $ responseLBS status200 [("Content-Type", "application/json")] (encode (object ["accepted" .= length txs, "dropped" .= dropped]))
  (_, ["ingest"]) -> respond $ responseLBS status405 [] ""
  (m, ["health"]) | m == methodGet -> respond $ responseLBS status200 [("Content-Type", "application/json")] (encode (object ["status" .= True]))
  _ -> respond $ responseLBS status404 [] ""

-- | One "tx.ingress" span per transaction in the transaction's trace (its
-- id derives from the hash, as in strato-api's submit span), marking the
-- hand-off into this cell's stream.
recordIngressSpans :: Integer -> [IngestEvent] -> IO ()
recordIngressSpans started txs = do
  enabled <- Tr.tracingEnabled
  if not enabled
    then pure ()
    else do
      end <- Tr.nowNanos
      request <- Tr.currentRequestContext
      mapM_
        ( \h ->
            Tr.recordSpan (Tr.traceIdFromHash (keccak256ToByteString h)) Nothing "tx.ingress" Tr.Consumer started end
              [Tr.attrText "strato.tx_hash" (T.pack (keccak256ToHex h)), Tr.attrText "strato.stage" "ingress"]
              (maybe [] pure request)
              Nothing
        )
        [transactionHash (itTransaction it) | IETx _ it <- txs]
