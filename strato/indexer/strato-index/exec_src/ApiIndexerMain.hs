{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Data.String
import HFlags

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-api-indexer"
  _ <- $initHFlags "Strato API Indexer"

  let k = kafkaConfig ethConf

  runLoggingT $
    runKafkaM "strato-api-indexer" (fromString $ kafkaHost k, fromIntegral $ kafkaPort k) $
    runSQLM $ 
      apiIndexerMainLoop
