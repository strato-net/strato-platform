{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE TypeOperators              #-}

module Blockchain.P2PRPC
  ( runStratoP2PComm
  , CommPort(..)
  , ConnectedPeer(..)
  , RPCPeer(..)
  , clientCommPort
  , serverCommPort
  , getPeersSignature
  , getNumPeersSignature
  , getPeersIO
  , getNumPeersIO
  , mkConn
  ) where

import           Blockchain.Data.PubKey
import           Blockchain.Strato.Discovery.Data.Peer
import           Control.Concurrent.STM.MonadIO
import           Control.Monad.Trans                   (liftIO)
import           Control.Monad.Trans.Except            (runExceptT)
import           Crypto.Types.PubKey.ECC
import           Data.Aeson
import qualified Data.ByteString                       as BS
import qualified Data.ByteString.Lazy                  as BL
import qualified Data.ByteString.Lazy.Char8            as BLC
import           Data.Conduit
import           Data.Conduit.Network
import qualified Data.Set                              as S
import qualified Data.Text                             as Text

import           Network.JsonRpc.Client
import           Network.JsonRpc.Server
import           Network.JsonRpc.ServerAdapter

import           GHC.Generics

newtype ConnectedPeer = ConnectedPeer { unConnectedPeer :: PPeer }

instance Eq ConnectedPeer where
  a == b = pPeerPubkey (unConnectedPeer a) == pPeerPubkey (unConnectedPeer b)

instance Ord ConnectedPeer where
  a `compare` b = unMaybePoint (pPeerPubkey $ unConnectedPeer a) `compare` unMaybePoint (pPeerPubkey $ unConnectedPeer b)
    where unPoint (Point a'''STFUGHC''' b'''STFUGHC''') = (a'''STFUGHC''', b'''STFUGHC''')
          unPoint PointO                                = (0, 0)
          unMaybePoint = fmap unPoint

newtype CommPort = CommPort { unCommPort :: Int }
        deriving (Eq, Ord, Read, Show)

data RPCPeer = RPCPeer { rpcPeerIP     :: String
                       , rpcPeerPort   :: Int
                       , rpcPeerPubKey :: Maybe String
                       } deriving (Eq, Read, Show, Generic)


instance ToJSON RPCPeer
instance FromJSON RPCPeer

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
    runConduit $ appSource app
              .| serve addresses
              .|appSink app

serve :: TVar (S.Set ConnectedPeer) -> ConduitM BS.ByteString BS.ByteString IO ()
serve addresses = do
  Just request <- await
  Just response <- liftIO $ call [getPeers addresses, getNumPeers addresses] $ BLC.fromStrict request
  yield $ BLC.toStrict response


mkConn :: BS.ByteString -> CommPort -> Connection IO
mkConn host (CommPort port) input = liftIO $ (fmap BL.fromStrict) <$> runTCPClient (clientSettings port host) c
  where runRPCInput = yield (BL.toStrict input) >> await
        c app = runConduit $ appSource app .| (runRPCInput `fuseUpstream` appSink app)

-- makeRPC :: (ToJSON t) => Signature ps t -> BS.ByteString -> CommPort -> IO (Either RpcError t)
-- makeRPC sig host port = runExceptT $ toFunction (mkConn host port) sig

-----------------
-- concat :: String -> String -> String
-- concat x y = x ++ y
-- concatSignature :: Signature (String ::: String ::: ()) String
-- concatSignature = Signature "concat" ("x" ::: "y" ::: ())

getPeersSignature :: Signature () [RPCPeer]
getPeersSignature =  Signature "getPeers" ()

getPeers :: TVar (S.Set ConnectedPeer) -> Method IO
getPeers theSet = toServerMethod getPeersSignature f
  where f :: RpcResult IO [RPCPeer]
        f = do
          val <- readTVar theSet
          return $ connectedPeerToRPCPeer <$> S.toList val

-- getPeersIO :: BS.ByteString -> CommPort -> IO (Either RpcError [RPCPeer])
-- getPeersIO = makeRPC getPeersSignature

getPeersIO :: BS.ByteString -> CommPort -> IO (Either RpcError [RPCPeer])
getPeersIO host port = runExceptT $ toFunction (mkConn host port) getPeersSignature

--------------

getNumPeersSignature :: Signature () Int
getNumPeersSignature =  Signature "getNumPeers" ()

getNumPeers :: TVar (S.Set ConnectedPeer) -> Method IO
getNumPeers theSet = toServerMethod getNumPeersSignature f
  where f :: RpcResult IO Int
        f = do
          val <- readTVar theSet
          return $ S.size val

getNumPeersIO :: BS.ByteString -> CommPort -> IO (Either RpcError Int)
getNumPeersIO host port = runExceptT $ toFunction (mkConn host port) getNumPeersSignature
