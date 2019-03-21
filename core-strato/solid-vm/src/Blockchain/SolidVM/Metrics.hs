{-# LANGUAGE OverloadedStrings #-}
module Blockchain.SolidVM.Metrics (CacheEvent(..), recordCacheEvent) where

import Control.Monad.IO.Class
import Prometheus

import qualified Data.Text as T

data CacheEvent = CacheHit | CacheMiss | StorageWrite | StorageRead deriving (Show, Eq)

{-# NOINLINE codeCacheEvents #-}
codeCacheEvents :: Vector T.Text Counter
codeCacheEvents = unsafeRegister
                . vector "event_type"
                . counter
                $ Info "solidvm_code_cache_events"
                       "Number of cache events by type for the CodeCollectionDB"


recordCacheEvent :: MonadIO m => CacheEvent ->m ()
recordCacheEvent ce = liftIO $ do
  withLabel codeCacheEvents (T.pack $ show ce) incCounter
