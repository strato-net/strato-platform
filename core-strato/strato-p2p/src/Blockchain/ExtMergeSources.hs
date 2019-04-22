{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE KindSignatures    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes        #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.ExtMergeSources (
  mergeSourcesByForce
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Resource
import           Data.Conduit.TMChan          hiding (mergeSources)
import           Data.Foldable

import           Data.Conduit
import           UnliftIO.Concurrent
import           UnliftIO.Exception
import           UnliftIO.STM

import           Blockchain.Output

mergeSourcesByForce :: (MonadLogger mi, MonadResource mi, MonadUnliftIO mi, MonadIO mo)
                    => [ConduitM () a mi ()] -- sources to merge
                    -> Int -- ^ bound of the intermediate channel
                    -> mo (ConduitM () a mi ())
mergeSourcesByForce sx bound = do
  return $ do
    (chkey, c) <- allocate (atomically $ newTBMChan bound) (atomically . closeTBMChan)
    st <- lift $ askUnliftIO
    regs <- forM sx $ \s -> do
      register . killThread =<< do
        (liftIO $ forkWithUnmask $ \unmask ->
          (unmask $ unliftIO st $
            runConduit $ s .| sinkTBMChan c)
          `finally` atomically (closeTBMChan c))
    sourceTBMChan c
    release chkey
    traverse_ release regs
