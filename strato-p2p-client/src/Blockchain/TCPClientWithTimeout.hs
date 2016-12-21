{-# LANGUAGE FlexibleContexts #-}

--see http://stackoverflow.com/questions/35022378/how-do-i-change-runtcpclient-timeout-duration

module Blockchain.TCPClientWithTimeout (
  runTCPClientWithConnectTimeout,
  TCPClientWithTimeoutException(..)
  ) where

import Control.Concurrent.Lifted
import Control.Exception.Lifted
import Control.Monad.IO.Class
import Control.Monad.Trans.Control
import Data.Conduit.Network

data TCPClientWithTimeoutException = TimeoutException deriving (Show)

instance Exception TCPClientWithTimeoutException

threadDelaySeconds :: Double -> IO ()
threadDelaySeconds secs =
  threadDelay (ceiling $ secs * 1e6)

runTCPClientWithConnectTimeout::(MonadIO m, MonadBaseControl IO m)=>
                                ClientSettings->Double->(AppData->m ())->m ()
runTCPClientWithConnectTimeout settings secs cont = do
  race <- liftIO newChan
  resultMVar <- liftIO newEmptyMVar
  
  timerThreadID <- fork $ liftIO $ do
    threadDelaySeconds secs
    writeChan race False
    
  clientThreadID <- fork $ do
    result <-
      try $
      runGeneralTCPClient settings $ \appData -> do
        liftIO $ writeChan race True
        cont appData
    liftIO $ writeChan race True --second call needed because first call won't be hit in the case of an error caught by try
    liftIO $ putMVar resultMVar result
      
  timedOut <- liftIO $ readChan race
  
  if timedOut
    then do
      liftIO $ killThread timerThreadID --don't want a buildup of timer threads....
      result' <- liftIO $ readMVar resultMVar
      case result' of
       Left e -> throw (e::SomeException)
       Right x -> return x
    else do
      _ <- throwIO $ TimeoutException
      liftIO $ killThread clientThreadID
