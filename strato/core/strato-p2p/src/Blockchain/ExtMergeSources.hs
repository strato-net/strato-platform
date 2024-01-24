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
import           Data.Conduit                 as DC
import           Data.Conduit.TMChan          hiding (mergeSources)
import qualified Data.Conduit.List            as CL
import           Data.Kind
import           Data.String
import           Ki.Unlifted as KIU
import           UnliftIO.Exception
import           UnliftIO.STM

liftSTM :: forall (m :: Type -> Type) a. MonadIO m
        => STM a
        -> m a
liftSTM = liftIO . atomically

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

-- | Custom mergeSourcesByForce function.
mergeSourcesByForce :: ( Monad m2
                       , MonadUnliftIO m1
                       , Eq a1
                       , IsString a1
                       , MonadLogger m1
                       , Traversable t
                       )
                    => t (a1, ConduitT () a2 m1 ())
                    -> Int
                    -> Scope
                    -> m2 (ConduitT z a2 m1 ())
mergeSourcesByForce sx bound scp =
  return $ do
    c   <- liftSTM $ newTBMChan bound
    st  <- lift $ askUnliftIO
    _   <- forM sx $ \(tag,s) ->
             liftIO $ fork scp 
               ( (unliftIO st $
                    runConduit $ s .| chanSink c writeTBMChan
                 )
                      `finally` ( case tag of
                                    "canarySource" -> do
                                      unliftIO st $ $logInfoS "canary/exit" "" >> killCanary
                                      liftSTM $ closeTBMChan c
                                    _              ->
                                      liftSTM $ closeTBMChan c                
                                )
               )
    chanSource c readTBMChan