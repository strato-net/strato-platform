{-# LANGUAGE FlexibleContexts #-}
module Blockchain.TCPClientWithTimeout (
  runTCPClientWithConnectTimeout,
  TCPClientWithTimeoutException(..)
  ) where

import           Control.Concurrent.Async.Lifted
import           Control.Concurrent.Lifted
import           Control.Exception.Lifted
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Control
import           Data.Conduit.Network

data TCPClientWithTimeoutException = TimeoutException deriving (Show)
instance Exception TCPClientWithTimeoutException

runTCPClientWithConnectTimeout::(MonadIO m, MonadBaseControl IO m)=>
                                ClientSettings->Double->(AppData->m ())->m ()
runTCPClientWithConnectTimeout settings secs cont = do
  res <- race
    (liftIO . threadDelay . ceiling $ secs * 1e6)
    (try $ runGeneralTCPClient settings cont)
  case res of
    Left _ -> throwIO $ TimeoutException
    Right (Left e) -> throwIO (e :: SomeException)
    Right (Right ()) -> return ()
