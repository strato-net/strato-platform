-- | Bounded read caches with generational eviction.
--
-- The VM's read caches (accounts, contract storage, MP nodes, hash
-- preimages, compiled code) are keyed by values that go stale as the chain
-- advances — most entries are keyed by a state root, and a contract that is
-- written every block gets a new storage root every block, so yesterday's
-- entries can never hit again. A plain @Map@ therefore grows without bound
-- (or, with a wipe-at-N guard, throws away the hot working set along with
-- the garbage).
--
-- A generational cache keeps two maps: inserts go to the current
-- generation; lookups consult both. When the current generation reaches
-- half the entry limit, it becomes the previous generation and the old
-- previous generation — everything that hasn't been re-read or re-written
-- for a full generation — is dropped in one O(1) pointer swap. Total
-- entries never exceed the limit, hits on the current generation cost
-- exactly what a plain map lookup costs (no per-hit reordering like an
-- LRU), and stale-root entries age out continuously instead of
-- accumulating until a wipe.
--
-- Two flavors: 'GenCache' over "Data.Map.Strict" for 'Ord' keys, and
-- 'GenCacheHM' over "Data.HashMap.Strict" for 'Hashable' keys (with an
-- explicit entry counter, since @HashMap.size@ is O(n)).
--
-- Values are inserted as given; callers are responsible for forcing values
-- and copying ByteString keys at the cache boundary so an entry doesn't
-- retain decoder thunks or pin the buffer it was sliced from.
module Blockchain.Cache.Generational
  ( GenCache,
    gcEmpty,
    gcLookup,
    gcInsert,
    gcDelete,
    gcSetLimit,
    gcSize,
    GenCacheHM,
    ghEmpty,
    ghLookup,
    ghInsert,
    ghDelete,
    ghSetLimit,
    ghSize,
  )
where

import Data.Hashable (Hashable)
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict as M

-- | Entry limit, current generation, previous generation.
data GenCache k v = GenCache !Int !(M.Map k v) !(M.Map k v)

gcEmpty :: Int -> GenCache k v
gcEmpty limit = GenCache (max 2 limit) M.empty M.empty

gcLookup :: Ord k => k -> GenCache k v -> Maybe v
gcLookup k (GenCache _ cur prev) = case M.lookup k cur of
  Just v -> Just v
  Nothing -> M.lookup k prev

gcInsert :: Ord k => k -> v -> GenCache k v -> GenCache k v
gcInsert k v (GenCache limit cur prev)
  | M.size cur' >= limit `div` 2 = GenCache limit M.empty cur'
  | otherwise = GenCache limit cur' prev
  where
    cur' = M.insert k v cur

gcDelete :: Ord k => k -> GenCache k v -> GenCache k v
gcDelete k (GenCache limit cur prev) = GenCache limit (M.delete k cur) (M.delete k prev)

-- | Takes effect on subsequent inserts; the next rotations shrink the
-- cache to the new limit.
gcSetLimit :: Int -> GenCache k v -> GenCache k v
gcSetLimit limit (GenCache _ cur prev) = GenCache (max 2 limit) cur prev

gcSize :: GenCache k v -> Int
gcSize (GenCache _ cur prev) = M.size cur + M.size prev

-- | Entry limit, entry count of the current generation (@HashMap.size@ is
-- O(n) so it can't be consulted on every insert), current generation,
-- previous generation.
data GenCacheHM k v = GenCacheHM !Int !Int !(HM.HashMap k v) !(HM.HashMap k v)

ghEmpty :: Int -> GenCacheHM k v
ghEmpty limit = GenCacheHM (max 2 limit) 0 HM.empty HM.empty

ghLookup :: Hashable k => k -> GenCacheHM k v -> Maybe v
ghLookup k (GenCacheHM _ _ cur prev) = case HM.lookup k cur of
  Just v -> Just v
  Nothing -> HM.lookup k prev

ghInsert :: Hashable k => k -> v -> GenCacheHM k v -> GenCacheHM k v
ghInsert k v (GenCacheHM limit count cur prev)
  | count' >= limit `div` 2 = GenCacheHM limit 0 HM.empty cur'
  | otherwise = GenCacheHM limit count' cur' prev
  where
    cur' = HM.insert k v cur
    count' = if HM.member k cur then count else count + 1

ghDelete :: Hashable k => k -> GenCacheHM k v -> GenCacheHM k v
ghDelete k (GenCacheHM limit count cur prev) =
  GenCacheHM limit count' (HM.delete k cur) (HM.delete k prev)
  where
    count' = if HM.member k cur then count - 1 else count

-- | Takes effect on subsequent inserts; the next rotations shrink the
-- cache to the new limit.
ghSetLimit :: Int -> GenCacheHM k v -> GenCacheHM k v
ghSetLimit limit (GenCacheHM _ count cur prev) = GenCacheHM (max 2 limit) count cur prev

ghSize :: GenCacheHM k v -> Int
ghSize (GenCacheHM _ _ cur prev) = HM.size cur + HM.size prev
