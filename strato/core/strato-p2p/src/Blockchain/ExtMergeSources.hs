{-# LANGUAGE BangPatterns              #-}
{-# LANGUAGE FlexibleContexts          #-}
{-# LANGUAGE KindSignatures            #-}
{-# LANGUAGE MultiWayIf                #-}
{-# LANGUAGE OverloadedStrings         #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE RankNTypes                #-}
{-# LANGUAGE TemplateHaskell           #-}
{-# LANGUAGE TypeFamilies              #-}

module Blockchain.ExtMergeSources
  ( mergeSourcesByForceServer,
    mergeSourcesByForceClient
  )
where

import           Control.Concurrent.Hierarchy
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Resource
import           Data.Conduit                 as DC
import           Data.Conduit.TMChan          hiding (mergeSources)
import qualified Data.Conduit.List            as CL
import           Data.Foldable
import           Data.Kind
import           UnliftIO.Concurrent
import           UnliftIO.Exception
import           UnliftIO.STM

-- | Modifies a TVar, returning its new value.
modifyTVar'' :: TVar a
             -> (a -> a)
             -> STM a
modifyTVar'' tv f = do
  !x <- f <$> readTVar tv
  writeTVar tv x
  return x

liftSTM :: forall (m :: Type -> Type) a. MonadIO m
        => STM a
        -> m a
liftSTM = liftIO . atomically

decRefcount :: TVar Int
            -> TBMChan a
            -> STM ()
decRefcount tv chan = do
  n <- modifyTVar'' tv (subtract 1)
  when (n == 0) $
    closeTBMChan chan

-- | Convert channel into the source.
--
-- *N.B* Since version 4.0 this function does not close the
-- channel if downstream is closed.
chanSource :: MonadIO m
           => chan                    -- ^ The channel.
           -> (chan -> STM (Maybe a)) -- ^ The 'read' function.
           -> ConduitT z a m ()
chanSource ch reader =
  loop
    where
      loop = do
          a <- liftSTM $ reader ch
          case a of
              Just x  -> DC.yield x >> loop
              Nothing -> return ()
{-# INLINE chanSource #-}

-- | Convert channel into the consumer.
--
-- *N.B*
chanSink :: MonadIO m
         => chan                  -- ^ The channel.
         -> (chan -> a -> STM ()) -- ^ The 'write' function.
         -> ConduitT a z m ()
chanSink ch writer = CL.mapM_ $ liftIO . atomically . writer ch
{-# INLINE chanSink #-}

mergeSourcesByForceServer :: (MonadLogger mi, MonadResource mi, MonadUnliftIO mi, MonadUnliftIO mo)
                          => [ConduitM () a mi ()] -- sources to merge
                          -> Int -- ^ bound of the intermediate channel
                          -> mo (ConduitM () a mi ())
mergeSourcesByForceServer sx bound =
  return $ do
    (chkey, c) <- allocate (liftSTM $ newTBMChan bound)
                           (liftSTM . closeTBMChan)
    refcount <- liftSTM . newTVar $ length sx
    st <- lift $ askUnliftIO
    regs <- forM sx $ \s ->
              register . killThread =<<
                (liftIO $ forkIOWithUnmask $ \unmask ->
                  (unmask $ unliftIO st $
                    runConduit $ s .| chanSink c writeTBMChan)
                  `finally` (liftSTM $ decRefcount refcount c))
    chanSource c readTBMChan
    release chkey
    traverse_ release regs 

mergeSourcesByForceClient :: (MonadResource mi, Monad mo, MonadUnliftIO mi)
                          => [ConduitM () a mi ()]
                          -> Int
                          -> ThreadMap
                          -> mo (ConduitM z a mi ())
mergeSourcesByForceClient sx bound tm =
  return $ do
    (chkey,c) <- allocate (liftSTM $ newTBMChan bound)
                          (liftSTM . closeTBMChan)
    refcount <- liftSTM . newTVar $ length sx
    st <- lift $ askUnliftIO
    regs <- forM sx $ \s -> do
              register . killThread =<<
                (liftIO $ newChild tm $ \_ ->
                  (unliftIO st $
                    runConduit $ s .| chanSink c writeTBMChan)
                  `finally` (liftSTM $ decRefcount refcount c))
    chanSource c readTBMChan
    release chkey
    traverse_ release regs
