{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Metrics
  ( CacheEvent (..),
    recordCacheEvent,
    recordCacheSize,
    recordCall,
    recordCreate,
  )
where

import Control.Monad.IO.Class
import qualified Data.Text as T
import Prometheus

data CacheEvent = CacheHit | CacheMiss | StorageWrite | StorageRead deriving (Show, Eq)

{-# NOINLINE codeCacheEvents #-}
codeCacheEvents :: Vector T.Text Counter
codeCacheEvents =
  unsafeRegister
    . vector "event_type"
    . counter
    $ Info
      "solidvm_code_cache_events"
      "Number of cache events by type for the CodeCollectionDB"

recordCacheEvent :: MonadIO m => CacheEvent -> m ()
recordCacheEvent ce = liftIO $ do
  withLabel codeCacheEvents (T.pack $ show ce) incCounter

{-# NOINLINE txKinds #-}
txKinds :: Vector T.Text Counter
txKinds =
  unsafeRegister
    . vector "kind"
    . counter
    $ Info "solidvm_tx_kind" "Number of calls and creates in SolidVM"

recordCreate :: MonadIO m => m ()
recordCreate = liftIO $ withLabel txKinds "create" incCounter

recordCall :: MonadIO m => m ()
recordCall = liftIO $ withLabel txKinds "call" incCounter

{-# NOINLINE cacheSize #-}
cacheSize :: Gauge
cacheSize =
  unsafeRegister
    . gauge
    $ Info "solidvm_cache_size" "Number of entries in the CodeCollectionDB cache"

recordCacheSize :: MonadIO m => Int -> m ()
recordCacheSize = liftIO . setGauge cacheSize . fromIntegral
