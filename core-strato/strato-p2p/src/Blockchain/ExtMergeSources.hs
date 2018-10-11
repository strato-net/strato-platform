{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE KindSignatures    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes        #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.ExtMergeSources (
  mergeSourcesCloseForAny
  ) where

import           ClassyPrelude                (atomically)
import           Control.Concurrent
import           Control.Concurrent.STM       hiding (atomically)
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Resource
import qualified Data.Conduit.List            as CL
import           Data.Conduit.TMChan          hiding (mergeSources)

import           Data.Conduit
import           Data.Void

chanSink
    :: MonadIO m
    => chan                     -- ^ The channel.
    -> (chan -> a -> STM ())    -- ^ The 'write' function.
    -> ConduitT a Void m ()
chanSink ch writer = CL.mapM_ $ atomically . writer ch
{-# INLINE chanSink #-}

mergeSourcesCloseForAny :: (MonadLogger mi, MonadResource mi, MonadIO mo, MonadBaseControl IO mi)
             => [ConduitT () a mi ()] -- ^ The sources to merge.
             -> Int -- ^ The bound of the intermediate channel.
             -> mi (ConduitT () a mo ())
mergeSourcesCloseForAny sx bound = do
    c <- atomically $ newTBMChan bound
    threadIdsVar <- atomically newEmptyTMVar
    result <- mapM (runFork c threadIdsVar . transPipe lift) sx
    atomically $ putTMVar threadIdsVar result
    return $ sourceTBMChan c

    where runFork chan threadIdsVar s = runResourceT . resourceForkIO $ do
            x <- try . runConduit $ s .| chanSink chan writeTBMChan
            atomically $ closeTBMChan chan
            threadIds <- atomically $ takeTMVar threadIdsVar
            myTh <- liftIO myThreadId
            _ <- liftIO $ forM (filter (/= myTh) threadIds) killThread
            case x of
                Left e  -> throw (e::SomeException)
                Right _ -> $logInfoS "mergeSourcesCloseForAny" "Closing conduit"
