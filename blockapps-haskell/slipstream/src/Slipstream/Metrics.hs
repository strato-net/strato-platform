{-# LANGUAGE OverloadedStrings #-}
module Slipstream.Metrics
  ( recordGlobals
  , recordKafkaMessages
  , recordAction
  , incNumTables
  , incNumHistoryTables
<<<<<<< HEAD
  , incNumBloomWrites
  , recordStackDepth
=======
  , recordCacheHit
  , recordCacheMiss
  , recordStorageHit
  , recordStorageMiss
>>>>>>> 786df2b06... Use cold storage as a backing store for globals
  ) where

import Control.Monad
import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import qualified Data.Text as T
import Prometheus

import Slipstream.Data.Action
import Slipstream.Data.Globals

globalsSize :: Vector T.Text Gauge
globalsSize = unsafeRegister
            . vector "cache_type"
            . gauge
            $ Info "slipstream_globals_size" "Number of cache entries in Globals"

kafkaCount :: Counter
kafkaCount = unsafeRegister
           . counter
           $ Info "slipstream_kafka_read" "Number of messages read from kafka"

actionCount :: Vector T.Text Counter
actionCount = unsafeRegister
            . vector "action_type"
            . counter
            $ Info "slipstream_action_count" "Number of actions seen, by type"

tablesCreated :: Vector T.Text Counter
tablesCreated = unsafeRegister
              . vector "tables_created"
              . counter
              $ Info "slipstream_tables_created" "Number of tables created"

numBloomWrites :: Counter
numBloomWrites = unsafeRegister
               . counter
               $ Info "slipstream_bloom_writes" "Number of writes to the delayed bloom filter"

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
  rec "no_index_list" (S.size . noIndexList)
  rec "contract_states" (M.size . contractStates)

recordKafkaMessages :: MonadIO m => [a] -> m ()
recordKafkaMessages = liftIO . void . addCounter kafkaCount . fromIntegral . length

recordAction :: MonadIO m => Action -> m ()
recordAction act =
  let lab = case actionType act of
              Create -> "create"
              Delete -> "delete"
              Update -> "update"
  in liftIO $ withLabel actionCount lab incCounter


incNumTables :: MonadIO m => m ()
incNumTables = liftIO $ withLabel tablesCreated "normal" incCounter

incNumHistoryTables :: MonadIO m => m ()
incNumHistoryTables = liftIO $ withLabel tablesCreated "history" incCounter

incNumBloomWrites :: MonadIO m => m ()
incNumBloomWrites = liftIO $ incCounter numBloomWrites

recordStackDepth :: MonadIO m => Int -> m ()
recordStackDepth = liftIO . setGauge stackDepth . fromIntegral

recordCacheHit :: MonadIO m => m ()
recordCacheHit = error "todo(tim)"

recordCacheMiss :: MonadIO m => m ()
recordCacheMiss = error "todo(tim)"

recordStorageHit :: MonadIO m => m ()
recordStorageHit = error "todo(tim)"

recordStorageMiss :: MonadIO m => T.Text -> m ()
recordStorageMiss = error "todo(tim)"
