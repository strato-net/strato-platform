{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | The writer lease: which core cell writes the shared Postgres cluster.
--
-- Cores that share a cluster all execute every block, but only one may
-- index it: strato-indexer inserts as it goes and slipstream issues DDL, so
-- two writers conflict immediately. The @writer_lease@ row names the cell
-- allowed to write. The holder heartbeats it; a batch is written inside a
-- transaction that first re-asserts the lease ('fenceWriterLeaseSql'), so a
-- cell that lost the lease cannot commit a late batch. Standbys follow the
-- chain and the progress rows without writing until the lease moves to
-- them, which is what @strato-promote@ does.
module Blockchain.Data.WriterLease
  ( coreWriterLease,
    staleAfterSeconds,
    ClaimResult (..),
    LostWriterLease (..),
    getWriterLeaseSql,
    claimWriterLeaseSql,
    fenceWriterLeaseSql,
    holdsWriterLease,
    heartbeatWriterLease,
    describeLease,
  )
where

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Control.Concurrent (threadDelay)
import Control.Exception (Exception)
import Control.Monad (forever, void)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock (NominalDiffTime, UTCTime, diffUTCTime, getCurrentTime)
import qualified Database.Persist.Postgresql as SQL
import UnliftIO (SomeException, try)

-- | One lease per cluster: the core writer role.
coreWriterLease :: Text
coreWriterLease = "core"

-- | A holder whose heartbeat is older than this is presumed gone, so an
-- unforced claim may take the lease. The holder heartbeats every 10s.
staleAfterSeconds :: NominalDiffTime
staleAfterSeconds = 30

data ClaimResult
  = -- | This cell holds the lease now (newly taken, or already its own).
    Claimed
  | -- | Another cell holds it and its heartbeat is fresh.
    HeldBy Text UTCTime
  deriving (Eq, Show)

-- | Thrown by a writer whose batch transaction found the lease gone.
newtype LostWriterLease = LostWriterLease Text
  deriving (Show)

instance Exception LostWriterLease

getWriterLeaseSql :: MonadIO m => SQL.SqlPersistT m (Maybe WriterLease)
getWriterLeaseSql = fmap SQL.entityVal <$> SQL.getBy (UniqueWriterLeaseName coreWriterLease)

-- | Take the lease for @cell@ if nobody holds it, this cell already holds
-- it, the holder's heartbeat is stale, or @force@ is set. Row-locked, so
-- two cells claiming at once serialize and the second one sees the first.
claimWriterLeaseSql :: MonadIO m => Text -> Bool -> UTCTime -> SQL.SqlPersistT m ClaimResult
claimWriterLeaseSql cell force now = do
  void $ SQL.rawExecute "LOCK TABLE writer_lease IN SHARE ROW EXCLUSIVE MODE" []
  existing <- SQL.getBy (UniqueWriterLeaseName coreWriterLease)
  case existing of
    Nothing -> do
      void $ SQL.insert (WriterLease coreWriterLease cell now now)
      return Claimed
    Just (SQL.Entity key lease)
      | writerLeaseHolder lease == cell -> do
          SQL.update key [WriterLeaseHeartbeatAt SQL.=. now]
          return Claimed
      | force || now `diffUTCTime` writerLeaseHeartbeatAt lease > staleAfterSeconds -> do
          SQL.update key [WriterLeaseHolder SQL.=. cell, WriterLeaseClaimedAt SQL.=. now, WriterLeaseHeartbeatAt SQL.=. now]
          return Claimed
      | otherwise -> return $ HeldBy (writerLeaseHolder lease) (writerLeaseHeartbeatAt lease)

-- | Re-assert the lease from inside a write transaction, refreshing the
-- heartbeat. False means the lease is not this cell's: the caller must
-- abort the transaction. The row stays locked until the transaction ends,
-- so a promotion cannot slip between the check and the commit.
fenceWriterLeaseSql :: MonadIO m => Text -> UTCTime -> SQL.SqlPersistT m Bool
fenceWriterLeaseSql cell now = do
  n <- SQL.updateWhereCount
    [WriterLeaseName SQL.==. coreWriterLease, WriterLeaseHolder SQL.==. cell]
    [WriterLeaseHeartbeatAt SQL.=. now]
  return (n == 1)

-- | Whether @cell@ holds the lease right now, read from the writer endpoint.
holdsWriterLease :: HasSQLDB m => Text -> m Bool
holdsWriterLease cell = do
  lease <- sqlQueryWriter getWriterLeaseSql
  return $ maybe False ((== cell) . writerLeaseHolder) lease

-- | Runs forever: keeps this cell's heartbeat fresh while it holds the
-- lease (a no-op otherwise). The write path also heartbeats with every
-- batch; this covers an idle chain, where no batch arrives for a long time.
heartbeatWriterLease :: (MonadLogger m, HasSQLDB m) => Text -> m ()
heartbeatWriterLease cell = forever $ do
  r <- try $ do
    now <- liftIO getCurrentTime
    sqlQueryWriter $ fenceWriterLeaseSql cell now
  case r of
    Left (e :: SomeException) ->
      $logWarnS "writerLease" . T.pack $ "heartbeat failed, will retry: " ++ show e
    Right _ -> return ()
  liftIO $ threadDelay 10000000

describeLease :: UTCTime -> Maybe WriterLease -> String
describeLease _ Nothing = "writer lease: unheld (no core has claimed it yet)"
describeLease now (Just l) =
  "writer lease: held by " ++ T.unpack (writerLeaseHolder l)
    ++ " since " ++ show (writerLeaseClaimedAt l)
    ++ ", last heartbeat " ++ show (round (now `diffUTCTime` writerLeaseHeartbeatAt l) :: Integer) ++ "s ago"
    ++ (if now `diffUTCTime` writerLeaseHeartbeatAt l > staleAfterSeconds then " (stale)" else "")
