-- | A hash map that empties itself when it reaches its capacity.
--
-- For hot, content-addressed lookups an ordered LRU is too slow: every hit
-- costs several O(log n) map updates to record recency. Here a hit is a plain
-- 'HM.lookup' and the bound is kept by dropping everything once it is reached;
-- the working set refills within a few blocks.
module KV.Cache.BoundedMap
  ( BoundedMap,
    new,
    lookup,
    insert,
    insertMany,
    delete,
  )
where

import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Foldable (foldl')
import Data.Hashable (Hashable)
import qualified Data.HashMap.Strict as HM
import Data.IORef
import Prelude hiding (lookup)

-- | Capacity, number of inserts since the last wipe (HM.size is O(n)), entries.
data BoundedMap k v = BoundedMap !Int !(IORef Int) !(IORef (HM.HashMap k v))

new :: MonadIO m => Int -> m (BoundedMap k v)
new capacity = liftIO $ BoundedMap capacity <$> newIORef 0 <*> newIORef HM.empty

lookup :: (MonadIO m, Hashable k) => BoundedMap k v -> k -> m (Maybe v)
lookup (BoundedMap _ _ ref) k = liftIO $ HM.lookup k <$> readIORef ref

insert :: (MonadIO m, Hashable k) => BoundedMap k v -> k -> v -> m ()
insert bm k v = insertMany bm [(k, v)]

insertMany :: (MonadIO m, Hashable k) => BoundedMap k v -> [(k, v)] -> m ()
insertMany (BoundedMap capacity count ref) kvs = liftIO $ do
  n <- atomicModifyIORef' count $ \c -> let c' = c + length kvs in (c', c')
  if n > capacity
    then writeIORef count (length kvs) >> writeIORef ref (HM.fromList kvs)
    else modifyIORef' ref $ \m -> foldl' (\acc (k, v) -> HM.insert k v acc) m kvs

delete :: (MonadIO m, Hashable k) => BoundedMap k v -> k -> m ()
delete (BoundedMap _ _ ref) k = liftIO $ modifyIORef' ref (HM.delete k)
