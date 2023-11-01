{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.P2PIndexer
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Data.String
import HFlags

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-p2p-indexer"
  _ <- $initHFlags "Strato P2P Indexer"

  let k = kafkaConfig ethConf

  runLoggingT $
    runKafkaM "strato-p2p-indexer" (fromString $ kafkaHost k, fromIntegral $ kafkaPort k) $
    runRedisM lookupRedisBlockDBConfig $
      p2pIndexerMainLoop
