{-# LANGUAGE DataKinds        #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds   #-}
{-# LANGUAGE TypeOperators    #-}

module Handlers.Peers
  ( API,
    server,
  )
where

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import           Blockchain.Strato.Model.Host
import qualified Control.Monad.Change.Modify                   as Mod
import           Data.Aeson
import qualified Data.Aeson.Key                                as DAK
import qualified Data.Text                                     as T
import           Servant                                       hiding
                                                               (ServerError)
import           SQLM
import           UnliftIO

type API = "peers" :> Get '[JSON] Value

server :: (MonadUnliftIO m, Mod.Accessible ActivePeers m) => ServerT API m
server = getPeers

---------------------

getPeers :: (MonadUnliftIO m, Mod.Accessible ActivePeers m) => m Value
getPeers = do
  eActivePeers <- getActivePeers
  case eActivePeers of
    Left err -> throwIO . ServerError $ show err
    Right ps -> return . object . map (\p -> DAK.fromText (T.pack $ hostToString $ pPeerHost p) .= pPeerTcpPort p) $ ps
