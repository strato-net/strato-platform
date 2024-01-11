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
  ( mergeSourcesByForce,
  )
where

import           BlockApps.Logging
import           Blockchain.Metrics
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Resource
import           Data.Conduit                 as DC
import           Data.Conduit.TMChan          hiding (mergeSources)
import qualified Data.Conduit.List            as CL
import           Data.Kind
import           Data.String
import           Ki.Unlifted as KIU
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

--mergeSourcesByForce :: (MonadResource mi, Monad mo, MonadUnliftIO mi)
--                    => [(a1,ConduitM () a mi ())]
--                    -> Int
--                    -> Scope
--                    -> mo (ConduitM () a mi ())
mergeSourcesByForce :: ( MonadResource m1
                       , Monad m2
                       , MonadUnliftIO m1
                       , Eq a1
                       , Data.String.IsString a1
                       , MonadLogger m1
                       )
                    => [(a1,ConduitT () a2 m1 ())]
                    -> Int
                    -> Scope
                    -> m2 (ConduitT z a2 m1 ())
mergeSourcesByForce sx bound scp =
  return $ do
    (chkey,c) <- allocate (liftSTM $ newTBMChan bound)
                          (liftSTM . closeTBMChan)
    refcount <- liftSTM . newTVar $ length sx
    st <- lift $ askUnliftIO
    _  <- forM sx $ \(tag,s) ->
            liftIO $ fork scp 
                 ( (unliftIO st $
                      runConduit $ s .| chanSink c writeTBMChan)
                        `finally` ( case tag of
                                      "canarySource" -> do
                                        _ <- unliftIO st $ $logInfoS "canary/exit" "" >> killCanary
                                        liftSTM $ decRefcount refcount c
                                      _              ->
                                        liftSTM $ decRefcount refcount c
                                  )
                 )
    chanSource c readTBMChan
    release chkey
