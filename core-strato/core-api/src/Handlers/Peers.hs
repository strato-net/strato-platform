{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Peers (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import           Servant                                 hiding (ServerError)

import           Blockchain.Strato.Discovery.Data.Peer

import           SQLM
import           UnliftIO

type API = "peers" :> Get '[JSON] Value

server :: ServerT API SQLM
server = getPeers

---------------------

getPeers :: MonadIO m => m Value
getPeers = do
  eActivePeers <- liftIO getActivePeers
  case eActivePeers of
    Left err -> throwIO . ServerError $ show err
    Right ps -> return . object . map (\p -> pPeerIp p .= pPeerTcpPort p) $ ps
