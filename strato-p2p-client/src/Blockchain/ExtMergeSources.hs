{-# LANGUAGE FlexibleContexts, KindSignatures, RankNTypes #-}

module Blockchain.ExtMergeSources (
  mergeSourcesCloseForAny
  ) where


import Control.Concurrent
import Control.Concurrent.STM
import Control.Exception.Lifted
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.Resource
import qualified Data.Conduit.List as CL
import Data.Conduit.TMChan hiding (mergeSources)

import Data.Conduit

liftSTM :: forall (m :: * -> *) a. MonadIO m => STM a -> m a
liftSTM = liftIO . atomically

chanSink
    :: MonadIO m
    => chan                     -- ^ The channel.
    -> (chan -> a -> STM ())    -- ^ The 'write' function.
    -> Sink a m ()
chanSink ch writer = do
    CL.mapM_ $ liftIO . atomically . writer ch
{-# INLINE chanSink #-}
    
mergeSourcesCloseForAny :: (MonadResource mi, MonadIO mo, MonadBaseControl IO mi)
             => [Source mi a] -- ^ The sources to merge.
             -> Int -- ^ The bound of the intermediate channel.
             -> mi (Source mo a)
mergeSourcesCloseForAny sx bound = do
  c <- liftSTM $ newTBMChan bound
  threadIdsVar <- liftSTM newEmptyTMVar
  result <-
    mapM (\s -> runResourceT $ resourceForkIO $ do
             x <- try $ s $$ chanSink c writeTBMChan
             liftSTM $ closeTBMChan c
             threadIds <- liftSTM $ takeTMVar threadIdsVar
             myTh <- liftIO myThreadId
             _ <- liftIO $ forM (filter (/= myTh) threadIds) killThread 
             case x of
              Left e -> throw (e::SomeException)
              Right _ -> liftIO $ putStrLn "Closing conduit"
         ) (map (transPipe lift) sx)
  liftSTM $ putTMVar threadIdsVar result
  return $ sourceTBMChan c
