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
import qualified Control.Monad.Composable.Streaming as Local
import qualified Control.Monad.Composable.Streaming.Kafka as Bus
import Control.Monad.Composable.Streaming.Bus (BusSettings (..), createBusEnv)
import Data.String (fromString)
import qualified Data.Text as T
import HFlags
import Instrumentation
import System.Process (readProcess)
import UnliftIO (liftIO)

main :: IO ()
main = do
  blockappsInit "strato-ingest"
  runInstrumentation "strato-ingest"
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
          then $logWarnS "strato-ingest" . T.pack $ "dropping " ++ show dropped ++ " non-transaction event(s) from the bus"
          else pure ()
        if null txs
          then pure ()
          else do
            _ <- liftIO . runStreamMPooled "strato-ingest" $ writeIngestTx txs
            $logInfoS "strato-ingest" . T.pack $ "forwarded " ++ show (length txs) ++ " transaction(s)"

busSettings :: BusConf -> BusSettings
busSettings b = BusSettings (busHost b) (busPort b) (busSecurity b) (busSaslUsername b) (busSaslPassword b)
