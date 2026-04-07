{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.Bootstrap
import Control.Monad.Composable.SQL
import HFlags
import Instrumentation

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-api-indexer"
  runInstrumentation "strato-api-indexer"
  _ <- $initHFlags "Strato API Indexer"

  runLoggingT $ do
    bootstrapIndexer
    runKafkaMConfigured "strato-api-indexer" $
      runSQLM $
        apiIndexerMainLoop
