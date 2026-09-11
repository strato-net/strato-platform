{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | strato-ingest: the pre-sequencer.
--
-- Consumes the shared message bus's ingest topic (transactions submitted by
-- the API tier) with a durable consumer group and forwards each batch into
-- this core's own broker, onto the @ingest_tx@ topic the sequencer reads
-- durably. The bus offset is committed only after the local produce has
-- been acknowledged, so a transaction accepted by the API survives this
-- process, the local broker and the sequencer restarting; and because every
-- core (writer and standby alike) runs its own group, a standby has the
-- same transactions in its mempool when it is promoted.
--
-- The core keeps its existing broker client for the local side and uses the
-- librdkafka client for the bus, which needs TLS and SASL.
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
import qualified Control.Monad.Composable.Streaming as Local
import qualified Control.Monad.Composable.Streaming.Kafka as Bus
import Control.Monad.Composable.Streaming.Bus (BusSettings (..), createBusEnv)
import Data.String (fromString)
import qualified Data.Text as T
import Control.Concurrent (forkIO)
import Control.Monad (void)
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp (run)
import Network.Wai.Middleware.Prometheus (metricsApp)
import Prometheus
import System.Process (readProcess)
import UnliftIO (liftIO)

{-# NOINLINE forwardedCounter #-}
forwardedCounter :: Counter
forwardedCounter = unsafeRegister . counter $ Info "strato_ingest_forwarded_total" "Transactions forwarded from the bus into this core's broker"

{-# NOINLINE droppedCounter #-}
droppedCounter :: Counter
droppedCounter = unsafeRegister . counter $ Info "strato_ingest_dropped_total" "Non-transaction events dropped from the bus ingest topic"

main :: IO ()
main = do
  blockappsInit "strato-ingest"
  runInstrumentation "strato-ingest"
  _ <- forkIO $ run 10781 metricsApp
  Tr.initTracing "strato-ingest"
  _ <- $initHFlags "strato-ingest: forward bus transactions into this core"
  bus <- case busConfig ethConf of
    Nothing -> error "strato-ingest: ethconf.yaml has no busConfig; this core has no message bus to read"
    Just b -> pure b
  hostname <- filter (/= '\n') <$> readProcess "hostname" [] ""
  let groupId = T.pack $ "strato-ingest-" ++ hostname
      ingestTopic = fromString (busIngestTopic bus)
  runLoggingT $ do
    $logInfoS "strato-ingest" . T.pack $
      "forwarding " ++ busIngestTopic bus ++ " from " ++ busHost bus ++ ":" ++ show (busPort bus)
        ++ " (" ++ busSecurity bus ++ ", group " ++ T.unpack groupId ++ ") into local " ++ show ingestTxTopicName
    -- Make sure both ends exist before consuming.
    _ <- liftIO . runStreamMConfigured "strato-ingest" $ Local.createTopicAndWait ingestTxTopicName
    busEnv <- createBusEnv "strato-ingest" (busSettings bus)
    Bus.runStreamMUsingEnv busEnv $ do
      Bus.createTopicAndWait ingestTopic
      Bus.consume groupId ingestTopic $ \(events :: [IngestEvent]) -> do
        let txs = [e | e@IETx {} <- events]
            dropped = length events - length txs
        if dropped > 0
          then do
            liftIO . void $ addCounter droppedCounter (fromIntegral dropped)
            $logWarnS "strato-ingest" . T.pack $ "dropping " ++ show dropped ++ " non-transaction event(s) from the bus"
          else pure ()
        if null txs
          then pure ()
          else do
            started <- liftIO Tr.nowNanos
            _ <- liftIO . runStreamMPooled "strato-ingest" $ writeIngestTx txs
            liftIO . void $ addCounter forwardedCounter (fromIntegral $ length txs)
            liftIO $ recordForwardSpans started txs
            $logInfoS "strato-ingest" . T.pack $ "forwarded " ++ show (length txs) ++ " transaction(s)"

-- | One "tx.forward" span per transaction in the transaction's trace (its
-- id derives from the hash, as in strato-api's submit span), marking the
-- hand-off from the bus into this core's broker.
recordForwardSpans :: Integer -> [IngestEvent] -> IO ()
recordForwardSpans started txs = do
  enabled <- Tr.tracingEnabled
  if not enabled
    then pure ()
    else do
      end <- Tr.nowNanos
      mapM_
        ( \h ->
            Tr.recordSpan (Tr.traceIdFromHash (keccak256ToByteString h)) Nothing "tx.forward" Tr.Consumer started end
              [Tr.attrText "strato.tx_hash" (T.pack (keccak256ToHex h)), Tr.attrText "strato.stage" "ingest"]
              []
              Nothing
        )
        [transactionHash (itTransaction it) | IETx _ it <- txs]

busSettings :: BusConf -> BusSettings
busSettings b = BusSettings (busHost b) (busPort b) (busSecurity b) (busSaslUsername b) (busSaslPassword b)
