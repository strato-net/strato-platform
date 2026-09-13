{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.EthConf
import BlockApps.Init
import BlockApps.Logging
import Blockchain.DB.SQLDB (sqlQueryWriter)
import Blockchain.Data.WriterLease
import Blockchain.Strato.Indexer.ApiIndexer (p2pIndexerLoop, seedSqlConsumerGroup, sqlIndexerLoop)
import Blockchain.Strato.Indexer.Bootstrap
import Blockchain.NodeStatusMirror (nodeStatusMirrorLoop)
import Control.Concurrent (forkIO)
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Redis
import qualified Data.Text as T
import Data.Time.Clock (getCurrentTime)
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp (run)
import Network.Wai.Middleware.Prometheus (metricsApp)
import UnliftIO.Async (concurrently_)

import Wiring ()

defineFlag "writer" (True :: Bool) "Claim the writer lease at startup when it is unheld, stale, or already this cell's. False for a standby core that follows the chain and writes nothing until promoted with strato-promote"

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

main :: IO ()
main = do
  blockappsInit "strato-indexer"
  runInstrumentation "strato-indexer"
  _ <- $initHFlags "Strato Indexer"
  cell <- T.pack <$> currentCellId
  -- Chain-health gauges (Blockchain.ChainMetrics) and RTS stats, scraped by
  -- the node's Prometheus and the cell's collector.
  _ <- forkIO $ run 10779 metricsApp

  runLoggingT $ do
    bootstrapIndexer

    -- The writer lease decides whether this cell's SQL side writes. A
    -- configured writer claims it unless another cell holds a fresh one;
    -- a standby only reports it.
    leaseDb <- createSQLDB 2
    now <- liftIO getCurrentTime
    runSQLMWith leaseDb $ do
      lease <- sqlQueryWriter getWriterLeaseSql
      $logInfoS "main" . T.pack $ describeLease now lease
      if flags_writer
        then do
          claimed <- sqlQueryWriter $ claimWriterLeaseSql cell False now
          case claimed of
            Claimed -> $logInfoS "main" . T.pack $ "cell " ++ T.unpack cell ++ " holds the writer lease"
            HeldBy holder _ ->
              $logWarnS "main" . T.pack $
                "cell " ++ T.unpack cell ++ " is configured as writer but " ++ T.unpack holder
                  ++ " holds a fresh lease; running as a standby until promoted (strato-promote)"
        else $logInfoS "main" . T.pack $ "cell " ++ T.unpack cell ++ " is a standby: it follows the chain and writes nothing until promoted"
    _ <- liftIO . forkIO . runLoggingT $ runSQLMWith leaseDb (heartbeatWriterLease cell)

    -- Mirror the Redis sync scalars into node_status so the API tier reads
    -- Postgres instead of Redis. Its own small pool: the main loop's pool is
    -- busy committing batches, and the mirror must not queue behind them.
    mirrorDb <- createSQLDB 2
    _ <- liftIO . forkIO . runLoggingT $ runSQLMWith mirrorDb (nodeStatusMirrorLoop cell)

    runStreamMConfigured "strato-indexer-sql" seedSqlConsumerGroup

    -- Two consumer loops, each under its own group: the Redis side for
    -- strato-p2p, and the SQL side that writes (or trails) Postgres. Either
    -- one ending, including a writer that lost its lease mid-batch, ends the
    -- process so the supervisor restarts it and the startup claim runs again.
    concurrently_
      ( runStreamMConfigured "strato-indexer" $
          runSQLM $
            runRedisM lookupRedisBlockDBConfig $
              p2pIndexerLoop
      )
      ( runStreamMConfigured "strato-indexer-sql" $
          runSQLM $
            runRedisM lookupRedisBlockDBConfig $
              sqlIndexerLoop cell
      )
