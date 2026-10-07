{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer (indexerMainLoop, p2pIndexerLoop)
import Blockchain.Strato.Indexer.Bootstrap
import Control.Monad.Composable.Base (runEff)
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Redis
import HFlags
import Instrumentation

import Wiring ()

defineFlag "sql" (True :: Bool) "Index blocks, transactions and state into the SQL database. --sql=false keeps only the Redis block index that strato-p2p serves peers from, for a node with no API (strato-setup --validator)"

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

main :: IO ()
main = do
  blockappsInit "strato-indexer"
  runInstrumentation "strato-indexer"
  _ <- $initHFlags "Strato Indexer"

  runEff . runLogging $
    if flags_sql
      then do
        bootstrapIndexer
        runStreamMConfigured "strato-indexer" $
          runSQLM $
            runRedisM lookupRedisBlockDBConfig $
              indexerMainLoop
      else do
        -- No SQL side at all: the eth database is neither created nor
        -- migrated here, and the Redis side runs under the same consumer
        -- group as the combined loop, so it resumes where that left off.
        bootstrapIndexerTopic
        runStreamMConfigured "strato-indexer" $
          runRedisM lookupRedisBlockDBConfig $
            p2pIndexerLoop
