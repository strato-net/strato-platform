{-# LANGUAGE BangPatterns #-}

module Blockchain.Database.MerklePatricia.Profile
  ( DBProfileSnapshot (..),
    DBProfileCounter (..),
    dbProfileEnabled,
    bumpDBProfile,
    noteProfileAccount,
    noteProfileStorageKey,
    resetDBProfile,
    snapshotDBProfile,
  )
where

import Control.Monad (forM_, when)
import Data.Array.IO (IOUArray)
import Data.Array.MArray (newArray, readArray, writeArray)
import Data.IORef
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Word (Word64)
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)

data DBProfileState = DBProfileState
  { profileAccounts :: !(S.Set String),
    profileStorageKeys :: !(S.Set String)
  }

data DBProfileSnapshot = DBProfileSnapshot
  { dbProfileCounters :: !(M.Map String Word64),
    dbProfileAccountsTouched :: !Int,
    dbProfileStorageKeysTouched :: !Int
  }
  deriving (Eq, Show)

data DBProfileCounter
  = AccountBlockCacheHits
  | AccountBlockCacheMisses
  | AccountDeleteOps
  | AccountReadCacheHits
  | AccountReadCacheMisses
  | AccountReadOps
  | AccountTxCacheHits
  | AccountTxCacheMisses
  | AccountWriteOps
  | HashCacheHits
  | HashCacheMisses
  | LevelDBBatchPutOps
  | LevelDBDeleteKeyBytes
  | LevelDBDeleteOps
  | LevelDBGetHits
  | LevelDBGetKeyBytes
  | LevelDBGetMisses
  | LevelDBGetOps
  | LevelDBPutOps
  | LevelDBReadBytes
  | LevelDBWriteBatches
  | LevelDBWriteBytes
  | PendingMerkleFlushRequests
  | SerializedEventBytes
  | SerializedEventCount
  | StorageBlockCacheHits
  | StorageBlockCacheMisses
  | StorageDeleteOps
  | StorageReadCacheHits
  | StorageReadCacheMisses
  | StorageReadOps
  | StorageTxCacheHits
  | StorageTxCacheMisses
  | StorageWriteOps
  | TrieNodeCacheHits
  | TrieNodeCacheMisses
  | TrieNodeLevelDBReads
  | TrieNodePendingCacheHits
  | TrieNodesCreated
  | TrieNodesDeleted
  | TrieNodesRead
  | TrieNodesReused
  | TrieNodesWritten
  deriving (Bounded, Enum, Eq, Ord, Show)

emptyDBProfileState :: DBProfileState
emptyDBProfileState = DBProfileState S.empty S.empty

{-# NOINLINE dbProfileEnabled #-}
dbProfileEnabled :: Bool
dbProfileEnabled = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_DB_DETAIL"
  pure $ case value of
    Nothing -> False
    Just "" -> False
    Just "0" -> False
    Just "false" -> False
    Just "False" -> False
    Just _ -> True

{-# NOINLINE dbProfileState #-}
dbProfileState :: IORef DBProfileState
dbProfileState = unsafePerformIO $ newIORef emptyDBProfileState

-- Counter names are fixed so hot-path updates mutate one Word64 instead of
-- allocating a fresh String-keyed Map on every trie/cache/LevelDB operation.
counterNames :: [String]
counterNames =
  [ "account_block_cache_hits",
    "account_block_cache_misses",
    "account_delete_ops",
    "account_read_cache_hits",
    "account_read_cache_misses",
    "account_read_ops",
    "account_tx_cache_hits",
    "account_tx_cache_misses",
    "account_write_ops",
    "hash_cache_hits",
    "hash_cache_misses",
    "leveldb_batch_put_ops",
    "leveldb_delete_key_bytes",
    "leveldb_delete_ops",
    "leveldb_get_hits",
    "leveldb_get_key_bytes",
    "leveldb_get_misses",
    "leveldb_get_ops",
    "leveldb_put_ops",
    "leveldb_read_bytes",
    "leveldb_write_batches",
    "leveldb_write_bytes",
    "pending_merkle_flush_requests",
    "serialized_event_bytes",
    "serialized_event_count",
    "storage_block_cache_hits",
    "storage_block_cache_misses",
    "storage_delete_ops",
    "storage_read_cache_hits",
    "storage_read_cache_misses",
    "storage_read_ops",
    "storage_tx_cache_hits",
    "storage_tx_cache_misses",
    "storage_write_ops",
    "trie_node_cache_hits",
    "trie_node_cache_misses",
    "trie_node_leveldb_reads",
    "trie_node_pending_cache_hits",
    "trie_nodes_created",
    "trie_nodes_deleted",
    "trie_nodes_read",
    "trie_nodes_reused",
    "trie_nodes_written"
  ]

allCounters :: [DBProfileCounter]
allCounters = [minBound .. maxBound]

{-# NOINLINE dbProfileCounterRefs #-}
dbProfileCounterRefs :: IOUArray Int Word64
dbProfileCounterRefs = unsafePerformIO $ newArray (fromEnum (minBound :: DBProfileCounter), fromEnum (maxBound :: DBProfileCounter)) 0

bumpDBProfile :: DBProfileCounter -> Word64 -> IO ()
bumpDBProfile counter amount = when dbProfileEnabled $ do
  let !index = fromEnum counter
  current <- readArray dbProfileCounterRefs index
  writeArray dbProfileCounterRefs index $! current + amount

noteProfileAccount :: String -> IO ()
noteProfileAccount account = when dbProfileEnabled $
  modifyIORef' dbProfileState $ \s ->
    let !accounts' = S.insert account (profileAccounts s)
     in s {profileAccounts = accounts'}

noteProfileStorageKey :: String -> IO ()
noteProfileStorageKey storageKey = when dbProfileEnabled $
  modifyIORef' dbProfileState $ \s ->
    let !storageKeys' = S.insert storageKey (profileStorageKeys s)
     in s {profileStorageKeys = storageKeys'}

resetDBProfile :: IO ()
resetDBProfile = when dbProfileEnabled $ do
  forM_ allCounters $ \counter -> writeArray dbProfileCounterRefs (fromEnum counter) 0
  writeIORef dbProfileState emptyDBProfileState

snapshotDBProfile :: IO DBProfileSnapshot
snapshotDBProfile = do
  s <- readIORef dbProfileState
  counterValues <- traverse (readArray dbProfileCounterRefs . fromEnum) allCounters
  let counters = M.fromList $ zip counterNames counterValues
  pure $
    DBProfileSnapshot
      counters
      (S.size $ profileAccounts s)
      (S.size $ profileStorageKeys s)
