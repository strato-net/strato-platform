{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer
import Control.Monad.Composable.SQL
import HFlags
import Instrumentation

import Wiring ()

main :: IO ()
main = do
  blockappsInit "strato-api-indexer"
  runInstrumentation "strato-api-indexer"
  _ <- $initHFlags "Strato API Indexer"

  runLoggingT $
    runKafkaMConfigured "strato-api-indexer" $
    runSQLM $ 
      apiIndexerMainLoop
