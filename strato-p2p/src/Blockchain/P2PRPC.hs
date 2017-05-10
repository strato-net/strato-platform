{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.P2PRPC
  ( runStratoP2PComm
  , CommPort(..)
  , ConnectedPeer(..)
  , RPCPeer(..)
  , clientCommPort
  , serverCommPort
  ) where

import Blockchain.Data.PubKey
import Crypto.Types.PubKey.ECC
import Control.Monad.Trans (liftIO)
import Control.Concurrent.STM.MonadIO
import Data.Aeson
import Blockchain.Strato.Discovery.Data.Peer
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Conduit
import Data.Conduit.Network
import qualified Data.Set as S
import Data.Text (Text)
import qualified Data.Text as Text

import Network.JsonRpc.Server
import GHC.Generics

newtype ConnectedPeer = ConnectedPeer { unConnectedPeer :: PPeer }

instance Eq ConnectedPeer where
  a == b = pPeerPubkey (unConnectedPeer a) == pPeerPubkey (unConnectedPeer b)

instance Ord ConnectedPeer where
  a `compare` b = unMaybePoint (pPeerPubkey $ unConnectedPeer a) `compare` unMaybePoint (pPeerPubkey $ unConnectedPeer b)
    where unPoint (Point a'''STFUGHC''' b'''STFUGHC''') = (a'''STFUGHC''', b'''STFUGHC''')
          unPoint PointO      = (0, 0) 
          unMaybePoint = fmap unPoint

newtype CommPort = CommPort { unCommPort :: Int }
        deriving (Eq, Ord, Read, Show)

data RPCPeer = RPCPeer { rpcPeerIP :: String
                       , rpcPeerPort :: Int
                       , rpcPeerPubKey :: Maybe String
                       } deriving (Eq, Read, Show, Generic)


instance ToJSON RPCPeer                       

connectedPeerToRPCPeer :: ConnectedPeer -> RPCPeer
connectedPeerToRPCPeer (ConnectedPeer PPeer{..}) = RPCPeer { rpcPeerIP = Text.unpack pPeerIp
                                                           , rpcPeerPort = pPeerTcpPort
                                                           , rpcPeerPubKey = pointToString <$> pPeerPubkey
                                                           }

serverCommPort :: CommPort
serverCommPort = CommPort 14000

clientCommPort :: CommPort
clientCommPort = CommPort 14001

runStratoP2PComm :: CommPort -> TVar (S.Set ConnectedPeer) -> IO ()
runStratoP2PComm cp addresses =
  runTCPServer (serverSettings (unCommPort cp) "*") $ \app ->
    appSource app =$= serve addresses $$ appSink app

serve :: TVar (S.Set ConnectedPeer) -> Conduit B.ByteString IO B.ByteString
serve addresses = do
  Just request <- await
  Just response <- liftIO $ call [getPeers addresses, getNumPeers addresses] $ BLC.fromStrict request
  yield $ BLC.toStrict response

getPeers :: TVar (S.Set ConnectedPeer) -> Method IO
getPeers theSet = toMethod "getPeers" f ()
  where f :: RpcResult IO [RPCPeer]
        f = do
          val <- readTVar theSet
          return $ connectedPeerToRPCPeer <$> S.toList val

getNumPeers :: TVar (S.Set ConnectedPeer) -> Method IO
getNumPeers theSet = toMethod "getNumPeers" f ()
  where f :: RpcResult IO Int
        f = do
          val <- readTVar theSet
          return $ S.size val
