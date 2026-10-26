{-# LANGUAGE OverloadedStrings #-}

-- | Chain-level health as Prometheus gauges, served by strato-indexer.
--
-- These are the signals that caught the testnet outages: how old the best
-- block is, how far the sequencer is ahead of execution, how far behind
-- the world this node is, and how far the two indexers trail the chain.
-- They come from the Redis sync scalars and the progress rows that the
-- node status mirror already reads once a second, plus the writer lease.
module Blockchain.ChainMetrics
  ( setBestBlock,
    setBestBlockTimestamp,
    setBestSequencedBlock,
    setWorldBestBlock,
    setCirrusTip,
    setIndexerProgress,
    setWriterLeaseHeld,
  )
where

import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Time.Clock (UTCTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Prometheus

{-# NOINLINE bestBlockGauge #-}
bestBlockGauge :: Gauge
bestBlockGauge = unsafeRegister . gauge $ Info "strato_best_block_number" "Highest block this node has executed"

{-# NOINLINE bestBlockTimestampGauge #-}
bestBlockTimestampGauge :: Gauge
bestBlockTimestampGauge =
  unsafeRegister . gauge $ Info "strato_best_block_timestamp_seconds" "Timestamp of the best block, seconds since the epoch; time() minus this is the block age"

{-# NOINLINE bestSequencedGauge #-}
bestSequencedGauge :: Gauge
bestSequencedGauge = unsafeRegister . gauge $ Info "strato_best_sequenced_block_number" "Highest block the sequencer has ordered"

{-# NOINLINE worldBestGauge #-}
worldBestGauge :: Gauge
worldBestGauge = unsafeRegister . gauge $ Info "strato_world_best_block_number" "Highest block number seen from peers"

{-# NOINLINE cirrusTipGauge #-}
cirrusTipGauge :: Gauge
cirrusTipGauge = unsafeRegister . gauge $ Info "strato_cirrus_tip_block_number" "Highest block slipstream has indexed into Cirrus"

{-# NOINLINE indexerProgressGauge #-}
indexerProgressGauge :: Gauge
indexerProgressGauge = unsafeRegister . gauge $ Info "strato_indexer_progress_block_number" "Highest block strato-indexer has committed to the eth tables (indexer_progress)"

{-# NOINLINE writerLeaseGauge #-}
writerLeaseGauge :: Gauge
writerLeaseGauge = unsafeRegister . gauge $ Info "strato_writer_lease_held" "1 while this cell holds the writer lease of the shared Postgres cluster"

setBestBlock :: MonadIO m => Integer -> m ()
setBestBlock = liftIO . setGauge bestBlockGauge . fromIntegral

setBestBlockTimestamp :: MonadIO m => UTCTime -> m ()
setBestBlockTimestamp = liftIO . setGauge bestBlockTimestampGauge . realToFrac . utcTimeToPOSIXSeconds

setBestSequencedBlock :: MonadIO m => Integer -> m ()
setBestSequencedBlock = liftIO . setGauge bestSequencedGauge . fromIntegral

setWorldBestBlock :: MonadIO m => Integer -> m ()
setWorldBestBlock = liftIO . setGauge worldBestGauge . fromIntegral

setCirrusTip :: MonadIO m => Integer -> m ()
setCirrusTip = liftIO . setGauge cirrusTipGauge . fromIntegral

setIndexerProgress :: MonadIO m => Integer -> m ()
setIndexerProgress = liftIO . setGauge indexerProgressGauge . fromIntegral

setWriterLeaseHeld :: MonadIO m => Bool -> m ()
setWriterLeaseHeld held = liftIO $ setGauge writerLeaseGauge (if held then 1 else 0)
