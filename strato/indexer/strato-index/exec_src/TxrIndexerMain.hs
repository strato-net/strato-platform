{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.TxrIndexer
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import HFlags
import Instrumentation

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-txr-indexer"
  runInstrumentation "strato-txr-indexer"
  _ <- $initHFlags "Strato TxResults Indexer"

  runLoggingT $
    runKafkaMConfigured "strato-txr-indexer" $
    runRedisM lookupRedisBlockDBConfig $
    runSQLM $
      txrIndexerMainLoop
