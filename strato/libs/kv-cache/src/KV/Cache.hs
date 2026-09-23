{-# LANGUAGE LambdaCase #-}

-- | A write-behind cache of parsed values in front of a byte-keyed store.
--
-- The store is whatever the caller passes in: 'lookup' takes the miss action,
-- 'tick' / 'flush' take the batch writer. The cache itself holds
--
--   * parsed values for hot reads, in a map that empties at capacity,
--   * bytes for both keys and values copied into arena slabs on the C heap,
--     so a cached entry never pins the store's read buffer,
--   * writes not yet handed to the store, visible to 'lookup' meanwhile.
module KV.Cache
  ( Cache,
    Config (..),
    new,
    lookup,
    insert,
    delete,
    tick,
    flush,
  )
where

import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Data.ByteString as B
import Data.Maybe (isJust)
import qualified KV.Cache.Arena as Arena
import qualified KV.Cache.BoundedMap as BoundedMap
import qualified KV.Cache.WriteBatch as WriteBatch
import Prelude hiding (lookup)

data Config v = Config
  { -- | Parsed entries kept before the read map is emptied.
    capacity :: Int,
    -- | Bytes per arena slab.
    slabBytes :: Int,
    -- | 'tick's between flushes.
    flushEvery :: Int,
    encode :: v -> B.ByteString,
    decode :: B.ByteString -> v
  }

data Cache v = Cache
  { config :: Config v,
    parsed :: BoundedMap.BoundedMap B.ByteString v,
    arena :: Arena.Arena,
    pending :: WriteBatch.WriteBatch B.ByteString B.ByteString
  }

new :: MonadIO m => Config v -> m (Cache v)
new cfg =
  Cache cfg
    <$> BoundedMap.new (capacity cfg)
    <*> Arena.new (slabBytes cfg)
    <*> WriteBatch.new (flushEvery cfg)

-- | Pending writes first, then parsed entries, then the store; a store hit is cached.
lookup :: MonadIO m => Cache v -> B.ByteString -> m (Maybe B.ByteString) -> m (Maybe v)
lookup c key fromStore =
  BoundedMap.lookup (parsed c) key >>= \case
    Just v -> pure (Just v)
    Nothing ->
      WriteBatch.lookup (pending c) key >>= \case
        Just bs -> pure (Just (decode (config c) bs))
        Nothing ->
          fromStore >>= \case
            Nothing -> pure Nothing
            Just bs -> Just <$> cacheBytes c key bs

-- | Queue a write. A key already cached or pending is left alone; the caller's
-- keys are content-addressed, so it carries the same value.
insert :: MonadIO m => Cache v -> B.ByteString -> v -> m ()
insert c key v = do
  cached <- BoundedMap.lookup (parsed c) key
  queued <- WriteBatch.lookup (pending c) key
  unless (isJust cached || isJust queued) $ do
    key' <- Arena.copy (arena c) key
    bs' <- Arena.copy (arena c) (encode (config c) v)
    WriteBatch.add (pending c) key' bs'

-- | Forget a key; the caller deletes it from the store.
delete :: MonadIO m => Cache v -> B.ByteString -> m ()
delete c key = BoundedMap.delete (parsed c) key >> WriteBatch.delete (pending c) key

-- | Count one unit of work; 'flush' through @write@ when the interval is up.
tick :: MonadIO m => Cache v -> ([(B.ByteString, B.ByteString)] -> m ()) -> m ()
tick c write = WriteBatch.tick (pending c) >>= \due -> when due (flush c write)

-- | Hand every pending write to @write@ and keep the values cached.
flush :: MonadIO m => Cache v -> ([(B.ByteString, B.ByteString)] -> m ()) -> m ()
flush c write = do
  kvs <- WriteBatch.drain (pending c)
  write kvs
  -- Already arena-resident; decode lazily, most written values are never read back.
  BoundedMap.insertMany (parsed c) [(k, decode (config c) bs) | (k, bs) <- kvs]

cacheBytes :: MonadIO m => Cache v -> B.ByteString -> B.ByteString -> m v
cacheBytes c key bs = liftIO $ do
  key' <- Arena.copy (arena c) key
  bs' <- Arena.copy (arena c) bs
  let v = decode (config c) bs'
  BoundedMap.insert (parsed c) key' v
  pure v
