{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer (indexerMainLoop)
import Blockchain.Strato.Indexer.Bootstrap
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Redis
import HFlags
import Instrumentation

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-indexer"
  runInstrumentation "strato-indexer"
  _ <- $initHFlags "Strato Indexer"

  runLoggingT $ do
    bootstrapIndexer
    runStreamMConfigured "strato-indexer" $
      runSQLM $
        runRedisM lookupRedisBlockDBConfig $
          indexerMainLoop
