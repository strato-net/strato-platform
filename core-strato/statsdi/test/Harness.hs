{-# LANGUAGE LambdaCase #-}
module Harness
    ( runStatsTCapturingOutput
    ) where

import           Control.Concurrent
import           Control.Concurrent.STM
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Stats
import           Data.ByteString           (ByteString)
import qualified Data.ByteString           as ByteString
import           Data.Time.Clock.POSIX
import           Network.Socket            hiding (recv)
import           Network.Socket.ByteString (recv)

import           System.IO.Unsafe          (unsafePerformIO)

harnessLock :: TMVar Int
harnessLock = unsafePerformIO $ newTMVarIO 0
{-# NOINLINE harnessLock #-}

tQueueToList :: TQueue a -> IO [a]
tQueueToList = fmap reverse . loop []
    where loop read q = atomically (tryReadTQueue q) >>= \case
                Nothing -> return read
                Just x  -> loop (x:read) q

listenForUDP :: (MonadIO m) => StatsTConfig -> TMVar [ByteString] -> m ThreadId
listenForUDP cfg var = liftIO . withSocketsDo $ do
    sock <- getAddrInfo opts' host' port' >>= \case
          []    -> error $ "Unsupported address: " ++ host cfg ++ ":" ++ show (port cfg)
          (a:_) -> do
              socket' <- socket (addrFamily a) Datagram defaultProtocol
              setSocketOption socket' ReuseAddr 1
              setSocketOption socket' ReusePort 1
              bind socket' (addrAddress a)
              return socket'
    queue <- newTQueueIO
    forkFinally (udpLoop sock queue) . const $ do
        close sock
        atomically . putTMVar var =<< tQueueToList queue

    where udpLoop :: Socket -> TQueue ByteString -> IO ()
          udpLoop sock queue =
              recv sock 10240 >>= atomically . writeTQueue queue >> udpLoop sock queue

          opts' = Just $ defaultHints { addrFlags = [AI_PASSIVE] }
          host' = Just $ host cfg
          port' = Just . show $ port cfg

forkAndListen :: StatsTConfig -> IO (ThreadId, TMVar [ByteString])
forkAndListen cfg = do
    var <- newEmptyTMVarIO
    tid <- listenForUDP cfg var
    return (tid, var)

runStatsTCapturingOutput :: (MonadIO m) => StatsTConfig -> Int -> StatsT m a ->  m ([ByteString], a)
runStatsTCapturingOutput c lingerTime m = do
    (tid, var)  <- liftIO $ do
        atomically $ takeTMVar harnessLock
        forkAndListen c
    ret <- runStatsT m c
    liftIO $ do
        threadDelay $ lingerTime * 1000
        killThread tid
        val <- atomically (takeTMVar var)
        atomically (putTMVar harnessLock 0)
        return (val, ret)
