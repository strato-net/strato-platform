{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Peers (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8               as BLC
import           Servant

import           Blockchain.Strato.Discovery.Data.Peer




type API = "peers" :> Get '[JSON] Value

server :: Server API
server = getPeers

---------------------

getPeers :: Handler Value
getPeers = do
  eActivePeers <- liftIO getActivePeers
  case eActivePeers of
    Left err -> throwError err500 { errBody = BLC.pack $ show err }
    Right ps -> return . object . map (\p -> pPeerIp p .= pPeerTcpPort p) $ ps
