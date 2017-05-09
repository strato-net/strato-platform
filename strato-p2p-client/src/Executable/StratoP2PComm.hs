{-# LANGUAGE OverloadedStrings #-}

module Executable.StratoP2PComm
  ( runStratoP2PComm
  , ConnectedPeer(..)
  , clientCommPort
  , serverCommPort
  ) where

import Crypto.Types.PubKey.ECC
import Control.Monad.Trans (liftIO)
import Control.Concurrent.STM.MonadIO
import Blockchain.Strato.Discovery.Data.Peer
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Conduit
import Data.Conduit.Network
import qualified Data.Set as S

import Network.JsonRpc.Server

newtype ConnectedPeer = ConnectedPeer { unConnectedPeer :: PPeer }

instance Eq ConnectedPeer where
  a == b = pPeerPubkey (unConnectedPeer a) == pPeerPubkey (unConnectedPeer b)

instance Ord ConnectedPeer where
  a `compare` b = unMaybePoint (pPeerPubkey $ unConnectedPeer a) `compare` unMaybePoint (pPeerPubkey $ unConnectedPeer b)
    where unPoint (Point a'''STFUGHC''' b'''STFUGHC''') = (a'''STFUGHC''', b'''STFUGHC''')
          unPoint PointO      = (99999999999999999999999999999999999999, 99999999999999999999999999999999999999)
          unMaybePoint = fmap unPoint

newtype CommPort = CommPort { unCommPort :: Int }
        deriving (Eq, Ord, Read, Show)

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
  Just response <- liftIO $ call [getPeers addresses] $ BLC.fromStrict request
  yield $ BLC.toStrict response


getPeers :: TVar (S.Set ConnectedPeer) -> Method IO
getPeers theSet = toMethod "getPeers" f ()
  where f :: RpcResult IO [String]
        f = do
          val <- readTVar theSet
          return $ pPeerString . unConnectedPeer <$> S.toList val

