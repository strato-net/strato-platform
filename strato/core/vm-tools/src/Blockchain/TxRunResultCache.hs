{-# LANGUAGE OverloadedStrings #-}

module Blockchain.TxRunResultCache
  ( Cache,
    new,
    insert,
    lookup,
  )
where

import Blockchain.Bagger.Transactions
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.StateRoot
import Control.DeepSeq
import qualified Data.Cache.LRU as LRU
import Data.IORef
import qualified Data.Text as T
import Prometheus
import Prelude hiding (lookup)

type CacheValue = (StateRoot, Integer, [TxRunResult])

newtype Cache = Cache (IORef (LRU.LRU Keccak256 CacheValue))

-- The IORef is modified only with strict writes and
-- the LRU is strict in its map.
instance NFData Cache where
  rnf = rwhnf

{-# NOINLINE resultsCacheSize #-}
resultsCacheSize :: Vector T.Text Gauge
resultsCacheSize =
  unsafeRegister
    . vector "kind"
    . gauge
    $ Info "vm_results_cache_size" "Sizes of the results cache"

{-# NOINLINE resultsCacheStats #-}
resultsCacheStats :: Vector T.Text Counter
resultsCacheStats =
  unsafeRegister
    . vector "event"
    . counter
    $ Info "vm_results_cache_stats" "Statistics about cache access"

recomputeCacheSize :: Cache -> IO ()
recomputeCacheSize (Cache ioref) = do
  lru <- readIORef ioref
  withLabel resultsCacheSize "blocks" $
    \g -> setGauge g (fromIntegral $ LRU.size lru)
  withLabel resultsCacheSize "trrs" $ do
    \g -> setGauge g (fromIntegral . sum . map (length . (\(_, _, ts) -> ts) . snd) $ LRU.toList lru)
  withLabel resultsCacheSize "max_blocks" $
    \g -> setGauge g (maybe (-1) fromIntegral $ LRU.maxSize lru)

new :: Integer -> IO Cache
new = fmap Cache . newIORef . LRU.newLRU . Just

insert :: Cache -> Keccak256 -> CacheValue -> IO ()
insert trrc@(Cache ioref) hsh trrs = do
  modifyIORef' ioref (LRU.insert hsh trrs)
  recomputeCacheSize trrc
  withLabel resultsCacheStats "inserts" incCounter

lookup :: Cache -> Keccak256 -> IO (Maybe CacheValue)
lookup (Cache ioref) hsh = do
  withLabel resultsCacheStats "lookups" incCounter
  -- The new LRU is thrown away, because the expected access pattern will
  -- see a trr list twice: during mining and during block commit. There's
  -- no point in increasing its priority if we'll never touch it again.
  res <- snd . LRU.lookup hsh <$> readIORef ioref
  case res of
    Nothing -> withLabel resultsCacheStats "misses" incCounter
    Just {} -> withLabel resultsCacheStats "hits" incCounter
  return res
