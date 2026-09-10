{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | Copies the node's Redis sync scalars into the @node_status@ table.
--
-- Redis is the core's own fast store and stays that way. The API tier used
-- to open a Redis connection to read five keys from it; now strato-indexer,
-- which already holds both Redis and Postgres, runs this loop and the API
-- reads Postgres. One writer, one poll a second, and a write only when a
-- value changes, so the table sees a handful of updates per block rather
-- than one per peer status message.
module Blockchain.NodeStatusMirror
  ( nodeStatusMirrorLoop,
    mirrorNodeStatusOnce,
    nodeStatusMirrorIntervalMicros,
  )
where

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.NodeStatus
import Blockchain.Data.WriterLease (holdsWriterLease)
import Blockchain.Strato.RedisBlockDB (runStratoRedisIO)
import Blockchain.SyncDB
  ( getBestBlockInfo,
    getBestSequencedBlockInfo,
    getCirrusBestBlockNumber,
    getSyncStatusNow,
    getWorldBestBlockInfo,
  )
import Control.Concurrent (threadDelay)
import Control.Monad (unless)
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as T
import UnliftIO (SomeException, liftIO, try)

nodeStatusMirrorIntervalMicros :: Int
nodeStatusMirrorIntervalMicros = 1000000

-- | The last value written per key, as its encoded JSON, so unchanged values
-- cost no Postgres round trip.
type Written = Map.Map NodeStatusKey BL.ByteString

-- | Runs forever. A failure in one pass (Redis still loading, Postgres
-- briefly unavailable) is logged and retried on the next tick; the last
-- written values are kept so the retry only writes what changed. Only the
-- cell holding the writer lease mirrors: node_status describes the writer
-- core, and a standby sharing the cluster must not overwrite it. A cell
-- that regains the lease forgets what it last wrote, so it rewrites every
-- key on its first pass as writer.
nodeStatusMirrorLoop :: (MonadLogger m, HasSQLDB m) => Text -> m ()
nodeStatusMirrorLoop cell = go Map.empty
  where
    go written = do
      holds <- try $ holdsWriterLease cell
      result <- case holds of
        Right True -> try $ mirrorNodeStatusOnce written
        Right False -> pure $ Right Map.empty
        Left (e :: SomeException) -> pure $ Left e
      written' <- case result of
        Right w -> pure w
        Left (e :: SomeException) -> do
          $logWarnS "nodeStatusMirror" . T.pack $ "mirror pass failed, will retry: " ++ show e
          pure written
      liftIO $ threadDelay nodeStatusMirrorIntervalMicros
      go written'

-- | One pass: read every scalar from Redis, upsert the ones that changed.
mirrorNodeStatusOnce :: (MonadLogger m, HasSQLDB m) => Written -> m Written
mirrorNodeStatusOnce written = do
  (best, world, sequenced, synced, cirrus) <-
    runStratoRedisIO $
      (,,,,)
        <$> getBestBlockInfo
        <*> getWorldBestBlockInfo
        <*> getBestSequencedBlockInfo
        <*> getSyncStatusNow
        <*> getCirrusBestBlockNumber
  let candidates =
        [ (BestBlockKey, JSON.encode . BestBlockJSON <$> best),
          (WorldBestBlockKey, JSON.encode . BestBlockJSON <$> world),
          (BestSequencedBlockKey, JSON.encode . BestSequencedBlockJSON <$> sequenced),
          (SyncStatusKey, JSON.encode <$> synced),
          (CirrusTipKey, JSON.encode <$> cirrus)
        ]
      changed =
        [ (k, v)
        | (k, Just v) <- candidates,
          Map.lookup k written /= Just v
        ]
  unless (null changed) $
    sqlQuery $ mapM_ (uncurry setNodeStatusEncodedSql) changed
  pure $ foldr (uncurry Map.insert) written changed
