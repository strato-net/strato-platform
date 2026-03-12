{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.Kafka (indexEventsTopicName)
import Blockchain.Strato.Indexer.P2PIndexer
import Control.Monad.Composable.Kafka (createTopic)
import Control.Monad.Composable.Redis
import HFlags
import Instrumentation

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-p2p-indexer"
  runInstrumentation "strato-p2p-indexer"
  _ <- $initHFlags "Strato P2P Indexer"

  runLoggingT $ do
    runKafkaMConfigured "strato-p2p-indexer" $ createTopic indexEventsTopicName
    runKafkaMConfigured "strato-p2p-indexer" $
      runRedisM lookupRedisBlockDBConfig $
        p2pIndexerMainLoop
