{-# LANGUAGE OverloadedStrings #-}

module Slipstream.Metrics
  ( recordGlobals,
    recordKafkaMessages,
    recordAction,
    recordCombinedAction,
    incNumTables,
    incNumMappingTables,
    incNumArrayTables,
    incNumAbstractRowTables,
    incNumHistoryTables,
    incNumBloomWrites,
    recordStackDepth,
    recordCacheHit,
    recordCacheMiss,
    recordStorageHit,
    recordStorageMiss,
    recordOffset,
    recordOffsetOverride,
  )
where

import BlockApps.Crossmon
import qualified Blockchain.Stream.Action as Action
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import qualified Data.Cache.LRU as LRU
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Prometheus
import Slipstream.Data.Action
import Slipstream.Data.Globals

{-# NOINLINE globalsSize #-}
globalsSize :: Vector T.Text Gauge
globalsSize =
  unsafeRegister
    . vector "cache_type"
    . gauge
    $ Info "slipstream_globals_size" "Number of cache entries in Globals"

{-# NOINLINE kafkaCount #-}
kafkaCount :: Counter
kafkaCount =
  unsafeRegister
    . counter
    $ Info "slipstream_kafka_read" "Number of messages read from kafka"

{-# NOINLINE actionCount #-}
actionCount :: Vector (T.Text, T.Text) Counter
actionCount =
  unsafeRegister
    . vector ("action_stage", "action_type")
    . counter
    $ Info "slipstream_action_count" "Number of actions seen, by type"

{-# NOINLINE tablesCreated #-}
tablesCreated :: Vector T.Text Counter
tablesCreated =
  unsafeRegister
    . vector "tables_created"
    . counter
    $ Info "slipstream_tables_created" "Number of tables created"

{-# NOINLINE numBloomWrites #-}
numBloomWrites :: Counter
numBloomWrites =
  unsafeRegister
    . counter
    $ Info "slipstream_bloom_writes" "Number of writes to the delayed bloom filter"

{-# NOINLINE stackDepth #-}
stackDepth :: Gauge
stackDepth =
  unsafeRegister
    . gauge
    $ Info "slipstream_bloom_stack_depth" "Number of pending items in the delayed bloom filter"

recordGlobals :: MonadIO m => Globals -> m ()
recordGlobals g = liftIO $ do
  let rec :: T.Text -> (Globals -> Int) -> IO ()
      rec lab acc = withLabel globalsSize lab (flip setGauge . fromIntegral . acc $ g)
  rec "created_tables" (M.size . createdTables)
  rec "contract_states" (LRU.size . contractStates)

recordKafkaMessages :: MonadIO m => [a] -> m ()
recordKafkaMessages = liftIO . void . addCounter kafkaCount . fromIntegral . length

recordActionOn :: MonadIO m => T.Text -> AggregateAction -> m ()
recordActionOn stage act = do
  let kind = case actionType act of
        Action.Create -> "create"
        Action.Delete -> "delete"
        Action.Update -> "update"
  liftIO $ withLabel actionCount (stage, kind) incCounter
  recordMaxBlockNumber "slipstream_processor" . actionBlockNumber $ act

recordAction :: MonadIO m => AggregateAction -> m ()
recordAction = recordActionOn "raw"

recordCombinedAction :: MonadIO m => AggregateAction -> m ()
recordCombinedAction = recordActionOn "combined"

incNumTables :: MonadIO m => m ()
incNumTables = liftIO $ withLabel tablesCreated "normal" incCounter

incNumMappingTables :: MonadIO m => m ()
incNumMappingTables = liftIO $ withLabel tablesCreated "mapping" incCounter

incNumArrayTables :: MonadIO m => m ()
incNumArrayTables = liftIO $ withLabel tablesCreated "array" incCounter

incNumAbstractRowTables :: MonadIO m => m ()
incNumAbstractRowTables = liftIO $ withLabel tablesCreated "abstract" incCounter

incNumHistoryTables :: MonadIO m => m ()
incNumHistoryTables = liftIO $ withLabel tablesCreated "history" incCounter

incNumBloomWrites :: MonadIO m => m ()
incNumBloomWrites = liftIO $ incCounter numBloomWrites

recordStackDepth :: MonadIO m => Int -> m ()
recordStackDepth = liftIO . setGauge stackDepth . fromIntegral

{-# NOINLINE cacheStats #-}
cacheStats :: Vector (T.Text, T.Text) Counter
cacheStats =
  unsafeRegister
    . vector ("kind", "response")
    . counter
    $ Info "slipstream_cache_stats" "Number of cache hits and misses for Globals"

recCache :: MonadIO m => (T.Text, T.Text) -> m ()
recCache ls = liftIO $ withLabel cacheStats ls incCounter

recordCacheHit :: MonadIO m => m ()
recordCacheHit = recCache ("cache_hit", "")

recordCacheMiss :: MonadIO m => m ()
recordCacheMiss = recCache ("cache_miss", "")

recordStorageHit :: MonadIO m => m ()
recordStorageHit = recCache ("storage_hit", "")

recordStorageMiss :: MonadIO m => T.Text -> m ()
recordStorageMiss reason = recCache ("storage_miss", reason)

{-# NOINLINE offsetChanges #-}
offsetChanges :: Counter
offsetChanges =
  unsafeRegister
    . counter
    $ Info "slipstream_offset_changes" "Number of times the kafka offset has changed"

{-# NOINLINE currentOffset #-}
currentOffset :: Gauge
currentOffset =
  unsafeRegister
    . gauge
    $ Info "slipstream_statediff_offset" "Offset into the statediff topic"

recordOffset :: MonadIO m => Offset -> m ()
recordOffset off = liftIO $ do
  incCounter offsetChanges
  setGauge currentOffset $ fromIntegral off

{-# NOINLINE offsetOverrides #-}
offsetOverrides :: Counter
offsetOverrides =
  unsafeRegister
    . counter
    $ Info "slipstream_offset_overrides" "Number of manual changes to the offset"

recordOffsetOverride :: MonadIO m => m ()
recordOffsetOverride = liftIO $ incCounter offsetOverrides
