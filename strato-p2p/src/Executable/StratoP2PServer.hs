{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Executable.StratoP2PServer (
  stratoP2PServer
  ) where

import           Control.Concurrent
import           Control.Concurrent.STM.MonadIO
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.Set                       as S
import qualified Data.Text                      as T

import           Blockchain.EthConf
import           Blockchain.P2PRPC
import           Blockchain.ServOptions
import           Blockchain.TCPServer

stratoP2PServer:: LoggingT IO ()
stratoP2PServer = do
  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ (flags_address)
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ (show flags_listen)

  let PrivKey myPriv = privKey ethConf

  connectedPeers <- newTVar S.empty

  _ <- liftIO $ forkIO $ runStratoP2PComm serverCommPort connectedPeers

  _ <- runResourceT $ do
          runEthServer connectedPeers myPriv flags_listen
  return ()
