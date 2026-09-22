-- | Writes held back in memory and handed over as one batch.
--
-- Reads must consult the batch before the store it fronts. 'tick' counts units
-- of work (blocks) and says when the configured interval is up; the owner then
-- 'drain's the batch into the store.
module KV.Cache.WriteBatch
  ( WriteBatch,
    new,
    add,
    lookup,
    delete,
    tick,
    drain,
  )
where

import Data.Hashable (Hashable)
import qualified Data.HashMap.Strict as HM
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.IORef
import Prelude hiding (lookup)

data WriteBatch k v = WriteBatch !Int !(IORef Int) !(IORef (HM.HashMap k v))

new :: MonadIO m => Int -> m (WriteBatch k v)
new interval = liftIO $ WriteBatch interval <$> newIORef 0 <*> newIORef HM.empty

add :: (MonadIO m, Hashable k) => WriteBatch k v -> k -> v -> m ()
add (WriteBatch _ _ ref) k v = liftIO $ modifyIORef' ref (HM.insert k v)

lookup :: (MonadIO m, Hashable k) => WriteBatch k v -> k -> m (Maybe v)
lookup (WriteBatch _ _ ref) k = liftIO $ HM.lookup k <$> readIORef ref

delete :: (MonadIO m, Hashable k) => WriteBatch k v -> k -> m ()
delete (WriteBatch _ _ ref) k = liftIO $ modifyIORef' ref (HM.delete k)

-- | Count one unit of work; True when the interval has been reached.
tick :: MonadIO m => WriteBatch k v -> m Bool
tick (WriteBatch interval count _) = liftIO $ do
  n <- atomicModifyIORef' count $ \c -> let c' = c + 1 in (c', c')
  pure (n >= interval)

-- | Take everything pending and start a fresh interval.
drain :: MonadIO m => WriteBatch k v -> m [(k, v)]
drain (WriteBatch _ count ref) = liftIO $ do
  pending <- readIORef ref
  writeIORef ref HM.empty
  writeIORef count 0
  pure (HM.toList pending)
