{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE UndecidableInstances #-}
module Blockchain.HashLocks
  ( HasClock(..)
  , HashLocks
  , newHashLocks
  , totalSize
  , tryGrabLock
  , grabManyLocks
  , prunePast
  ) where

import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Data.Time.Clock
import Data.Time.Clock.POSIX
import Data.Hashable
import Data.HashMap.Strict as M
import Data.Maybe
import MonadUtils
import UnliftIO.STM

-- A module to limit the number of times a blockhash is requested
-- at once. The only method for clearing a lock on a hash is for
-- time to pass: a response may never be returned for a misbehaving
-- peer, and even if a response is returned its expensive to hash
-- all the blocks returned.

class HasClock m where
  getNow :: m POSIXTime

instance HasClock IO where
  getNow = getPOSIXTime

instance (Monad m) => HasClock (ReaderT POSIXTime m) where
  getNow = ask

data HashLocks a = HashLocks
  { timeout :: NominalDiffTime
  , deadlines :: TVar (M.HashMap a POSIXTime)
  }

newHashLocks :: (Monad m, MonadIO m, Eq a) => NominalDiffTime -> m (HashLocks a)
newHashLocks dt = HashLocks dt <$> atomically (newTVar M.empty)

-- TotalSize does not take into account expiration of entries
totalSize :: (MonadIO m) => HashLocks a -> m Int
totalSize = fmap M.size . atomically . readTVar . deadlines

-- Returns true if we were able to replace the time for this key
tryGrabLock :: (Eq a, Hashable a, MonadIO m, HasClock m) => HashLocks a -> a -> m Bool
tryGrabLock h@HashLocks{..} a = do
  now <- getNow
  -- In the common case of an existing key, readTVarIO is much faster because
  -- it doesn't require a transaction.
  staleMap <- readTVarIO deadlines
  case M.lookup a staleMap of
    Just t | t > now -> return False
    _ -> isJust <$> atomically (attemptSwapSTM h now a)

grabManyLocks :: (Eq a, Hashable a, MonadIO m, HasClock m) => HashLocks a -> [a] -> m [a]
grabManyLocks h as = do
  now <- getNow
  atomically $ grabManySTM h now as

-- Garbage collect entries that have expired
-- TODO(tim): This would be a good application for Control.Reaper
prunePast :: (MonadIO m, HasClock m) => HashLocks a -> m ()
prunePast HashLocks{..} = do
  now <- getNow
  atomically . modifyTVar' deadlines $ M.filter (>now)

grabManySTM :: (Eq a, Hashable a) => HashLocks a -> POSIXTime -> [a] -> STM [a]
grabManySTM h now = mapMaybeM (attemptSwapSTM h now)

attemptSwapSTM :: (Eq a, Hashable a) => HashLocks a -> POSIXTime -> a -> STM (Maybe a)
attemptSwapSTM HashLocks{..} now a = do
  kvs <- readTVar deadlines
  case M.lookup a kvs of
    Just t | t > now -> return Nothing
    _ -> do
      modifyTVar deadlines $ M.insert a (now + timeout)
      return $ Just a
