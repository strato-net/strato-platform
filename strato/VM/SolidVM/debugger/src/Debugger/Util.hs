{-# LANGUAGE RecordWildCards #-}

module Debugger.Util where

import Control.Monad
import Control.Monad.IO.Class
import UnliftIO
import UnliftIO.Concurrent

microsecondsPerSecond :: Int
microsecondsPerSecond = 1000000
{-# INLINE microsecondsPerSecond #-}

forcePutTMVar :: TMVar a -> a -> STM ()
forcePutTMVar tmvar a = do
  success <- tryPutTMVar tmvar a
  unless success . void $ swapTMVar tmvar a

waitIndefinitely :: MonadIO m => TMVar a -> m (Maybe a)
waitIndefinitely = fmap Just . atomically . takeTMVar

cancelRequest :: MonadIO m => TMVar a -> TMVar b -> m (Maybe b)
cancelRequest a b = atomically (tryTakeTMVar a >> tryTakeTMVar b)

getResponseSync :: MonadUnliftIO m => Int -> TMVar a -> TMVar b -> m (Maybe b)
getResponseSync t a b = either id id <$> race (threadDelay t >> cancelRequest a b) (waitIndefinitely b)

getResponsesSync :: MonadUnliftIO m => Int -> [(TMVar a, TMVar b)] -> m [Maybe b]
getResponsesSync t = mapConcurrently . uncurry $ getResponseSync t
