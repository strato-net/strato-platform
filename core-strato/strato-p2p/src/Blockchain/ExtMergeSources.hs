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
import           Data.Conduit
import           Data.Conduit.TMChan          hiding (mergeSources)
import           Data.Foldable
import qualified Data.Text                    as T
import           Prometheus                   hiding (register)
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
    tid <- myThreadId
    rkey <- register . killThread =<< do
      liftIO . forkIO . forever $ do
        threadDelay 15000000
        recordChannelLength bound tid c
    resetKey <- register $ removeChannelLength tid
    sourceTBMChan c
    release chkey
    release rkey
    release resetKey
    traverse_ release regs


{-# NOINLINE channelLengths #-}
channelLengths :: Vector T.Text Gauge
channelLengths = unsafeRegister
               . vector "thread_id"
               . gauge
               $ Info "p2p_channel_lengths" "Number of elements queued in the merged sources for this peer thread"

recordChannelLength :: Int -> ThreadId -> TBMChan a -> IO ()
recordChannelLength total tid ch = do
  free <- atomically $ freeSlotsTBMChan ch
  withLabel channelLengths (T.pack $! show tid) $
    \t -> setGauge t (fromIntegral $ total - free)

removeChannelLength :: ThreadId -> IO ()
removeChannelLength = removeLabel channelLengths . T.pack . show
