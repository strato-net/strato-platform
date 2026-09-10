{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

-- | strato-promote: move the writer lease to this core cell.
--
-- Run in the node directory of the standby. Without --force it only takes a
-- lease that is unheld, this cell's already, or whose holder's heartbeat is
-- stale, so a live writer is never displaced by accident. The cell's
-- strato-indexer and slipstream notice within a second and start writing
-- from where they trailed; the old writer's next batch fails its fence and
-- its indexer restarts as a standby.
import Blockchain.EthConf (currentCellId)
import BlockApps.Logging
import Blockchain.DB.SQLDB (sqlQueryWriter)
import Blockchain.Data.WriterLease
import Control.Monad (unless)
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Composable.SQL
import qualified Data.Text as T
import Data.Time.Clock (getCurrentTime)
import HFlags
import System.Exit (exitFailure)

defineFlag "force" (False :: Bool) "Take the lease even though its holder's heartbeat is fresh. Only after confirming that core is stopped: two writers corrupt the shared cluster"
defineFlag "status" (False :: Bool) "Print the lease and exit without claiming it"

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

main :: IO ()
main = do
  _ <- $initHFlags "Move the writer lease to this core cell"
  cell <- T.pack <$> currentCellId
  runNoLoggingT $ do
    db <- createSQLDB 1
    runSQLMWith db $ do
      now <- liftIO getCurrentTime
      lease <- sqlQueryWriter getWriterLeaseSql
      liftIO . putStrLn $ describeLease now lease
      liftIO . putStrLn $ "this cell: " ++ T.unpack cell
      unless flags_status $ do
        result <- sqlQueryWriter $ claimWriterLeaseSql cell flags_force now
        case result of
          Claimed -> liftIO . putStrLn $ "writer lease now held by " ++ T.unpack cell
          HeldBy holder _ -> liftIO $ do
            putStrLn $ "refused: " ++ T.unpack holder ++ " holds the lease and is heartbeating."
            putStrLn "Stop that core first, wait for its heartbeat to go stale (30s), or pass --force after confirming it is down."
            exitFailure
