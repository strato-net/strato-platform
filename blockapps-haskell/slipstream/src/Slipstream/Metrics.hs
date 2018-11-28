{-# LANGUAGE OverloadedStrings #-}
module Slipstream.Metrics
  ( recordGlobals
  , recordKafkaMessages
  , recordAction
  , recordCombinedAction
  , incNumTables
  , incNumHistoryTables
  , incNumBloomWrites
  , recordStackDepth
  , recordCacheHit
  , recordCacheMiss
  , recordStorageHit
  , recordStorageMiss
  ) where

import Control.Monad
import Control.Monad.IO.Class
import qualified Data.Cache.LRU as LRU
import qualified Data.Set as S
import qualified Data.Text as T
import Prometheus

import Slipstream.Data.Action
import Slipstream.Data.Globals

{-# NOINLINE globalsSize #-}
globalsSize :: Vector T.Text Gauge
globalsSize = unsafeRegister
            . vector "cache_type"
            . gauge
            $ Info "slipstream_globals_size" "Number of cache entries in Globals"

{-# NOINLINE kafkaCount #-}
kafkaCount :: Counter
kafkaCount = unsafeRegister
           . counter
           $ Info "slipstream_kafka_read" "Number of messages read from kafka"

{-# NOINLINE actionCount #-}
actionCount :: Vector T.Text Counter
actionCount = unsafeRegister
            . vector "action_type"
            . counter
            $ Info "slipstream_action_count" "Number of actions seen, by type"

{-# NOINLINE combinedActionCount #-}
combinedActionCount :: Vector T.Text Counter
combinedActionCount = unsafeRegister
                    . vector "combined_action_type"
                    . counter
                    $ Info "slipstream_combined_action_count" "Number of combined actions seen, by type"

{-# NOINLINE tablesCreated #-}
tablesCreated :: Vector T.Text Counter
tablesCreated = unsafeRegister
              . vector "tables_created"
              . counter
              $ Info "slipstream_tables_created" "Number of tables created"

{-# NOINLINE numBloomWrites #-}
numBloomWrites :: Counter
numBloomWrites = unsafeRegister
               . counter
               $ Info "slipstream_bloom_writes" "Number of writes to the delayed bloom filter"

{-# NOINLINE stackDepth #-}
stackDepth :: Gauge
stackDepth = unsafeRegister
           . gauge
           $ Info "slipstream_bloom_stack_depth" "Number of pending items in the delayed bloom filter"

recordGlobals :: MonadIO m => Globals -> m ()
recordGlobals g = liftIO $ do
  let rec  :: T.Text -> (Globals -> Int) -> IO ()
      rec lab acc = withLabel globalsSize lab (flip setGauge . fromIntegral . acc $ g)
  rec "created_contracts" (S.size . createdContracts)
  rec "history_list" (S.size . historyList)
  rec "function_history_list" (S.size . functionHistoryList)
  rec "no_index_list" (S.size . noIndexList)
  rec "contract_states" (LRU.size . contractStates)

recordKafkaMessages :: MonadIO m => [a] -> m ()
recordKafkaMessages = liftIO . void . addCounter kafkaCount . fromIntegral . length

recordActionOn :: MonadIO m => Vector T.Text Counter -> Action -> m ()
recordActionOn vec act =
  let lab = case actionType act of
              Create -> "create"
              Delete -> "delete"
              Update -> "update"
  in liftIO $ withLabel vec lab incCounter

recordAction :: MonadIO m => Action -> m ()
recordAction = recordActionOn actionCount

recordCombinedAction :: MonadIO m => Action -> m ()
recordCombinedAction = recordActionOn combinedActionCount

incNumTables :: MonadIO m => m ()
incNumTables = liftIO $ withLabel tablesCreated "normal" incCounter

incNumHistoryTables :: MonadIO m => m ()
incNumHistoryTables = liftIO $ withLabel tablesCreated "history" incCounter

incNumBloomWrites :: MonadIO m => m ()
incNumBloomWrites = liftIO $ incCounter numBloomWrites

recordStackDepth :: MonadIO m => Int -> m ()
recordStackDepth = liftIO . setGauge stackDepth . fromIntegral

{-# NOINLINE cacheStats #-}
cacheStats :: Vector (T.Text, T.Text) Counter
cacheStats = unsafeRegister
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
