{-# LANGUAGE OverloadedStrings #-}

module Executable.StratoP2PServer (
  stratoP2PServer
  ) where

import Control.Concurrent
import Control.Concurrent.STM.MonadIO
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans.Resource
import qualified Data.Set as S
import qualified Data.Text as T

import Blockchain.EthConf
import Blockchain.ServOptions
import Blockchain.TCPServer
import Executable.StratoP2PServerComm

stratoP2PServer:: LoggingT IO ()
stratoP2PServer = do
  logInfoN $ T.pack $ "connect address: " ++ (flags_address)
  logInfoN $ T.pack $ "listen port:     " ++ (show flags_listen)

  let PrivKey myPriv = privKey ethConf

  connectedPeers <- newTVar S.empty

  _ <- liftIO $ forkIO $ runStratoP2PServerComm connectedPeers

  _ <- runResourceT $ do
          runEthServer connectedPeers connStr' myPriv flags_listen
  return ()
