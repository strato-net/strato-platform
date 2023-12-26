{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.TxrIndexer
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import Data.String
import HFlags

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-txr-indexer"
  _ <- $initHFlags "Strato TxResults Indexer"

  let k = kafkaConfig ethConf

  runLoggingT $
    runKafkaM "strato-txr-indexer" (fromString $ kafkaHost k, fromIntegral $ kafkaPort k) $
    runRedisM lookupRedisBlockDBConfig $
    runSQLM $
      txrIndexerMainLoop
