{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Peers
  ( API,
    server,
  )
where

import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Control.Monad.IO.Class
import Data.Aeson
import qualified Data.Aeson.Key as DAK
import SQLM
import Servant hiding (ServerError)
import UnliftIO

type API = "peers" :> Get '[JSON] Value

server :: MonadIO m => ServerT API m
server = getPeers

---------------------

getPeers :: MonadIO m => m Value
getPeers = do
  eActivePeers <- liftIO getActivePeers
  case eActivePeers of
    Left err -> throwIO . ServerError $ show err
    Right ps -> return . object . map (\p -> DAK.fromText (pPeerIp p) .= pPeerTcpPort p) $ ps
