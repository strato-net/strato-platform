{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.Strato.Indexer.ApiIndexer (indexerMainLoop)
import Blockchain.Strato.Indexer.Bootstrap
import Blockchain.NodeStatusMirror (nodeStatusMirrorLoop)
import Control.Concurrent (forkIO)
import Control.Monad.IO.Class (liftIO)
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
    -- Mirror the Redis sync scalars into node_status so the API tier reads
    -- Postgres instead of Redis. Its own small pool: the main loop's pool is
    -- busy committing batches, and the mirror must not queue behind them.
    mirrorDb <- createSQLDB 2
    _ <- liftIO . forkIO . runLoggingT $ runSQLMWith mirrorDb nodeStatusMirrorLoop
    runStreamMConfigured "strato-indexer" $
      runSQLM $
        runRedisM lookupRedisBlockDBConfig $
          indexerMainLoop
