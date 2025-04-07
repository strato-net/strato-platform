{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Base.Filesystem where

import BlockApps.Logging
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.P2PUtil (sockAddrToIP)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Secp256k1
import Conduit
import Control.Lens hiding (Context, view)
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Reader
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.Network
import qualified Data.Text as T
import Network.Socket
import qualified Network.Socket.ByteString as NB
import Network.Wai.Handler.Warp.Internal
import Strato.Lite.Base
import UnliftIO
import Prelude hiding (round)

data FilesystemPeer = FilesystemPeer
  { _filesystemPeerPrivKey     :: PrivateKey
  , _filesystemPeerTCPPort     :: TCPPort
  , _filesystemPeerUDPPort     :: UDPPort
  , _filesystemPeerUDPSocket   :: Socket
  }

makeLenses ''FilesystemPeer

type FilesystemM = ReaderT FilesystemPeer BaseM

type MonadFS m = ReaderT FilesystemPeer m

instance {-# OVERLAPPING #-} MonadIO m => HasVault (MonadFS m) where
  sign bs = do
    pk <- asks _filesystemPeerPrivKey
    return $ signMsg pk bs

  getPub = do
    pk <- asks _filesystemPeerPrivKey
    return $ derivePublicKey pk

  getShared pub = do
    pk <- asks _filesystemPeerPrivKey
    return $ deriveSharedKey pk pub

instance {-# OVERLAPPING #-} RunsClient FilesystemM where
  runClientConnection (Host ip) (TCPPort p) sSource handler = do
    let peerAddress = BC.pack $ T.unpack ip
    runGeneralTCPClient (clientSettings p peerAddress) $ \app -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
      handler conduits

instance {-# OVERLAPPING #-} RunsServer FilesystemM (LoggingT IO) where
  runServer (TCPPort listenPort) runner handler = do
    let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
    runGeneralTCPServer settings $ \app -> runner $ \sSource -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
          ip = Host . T.pack . sockAddrToIP $ appSockAddr app
      handler conduits ip

instance {-# OVERLAPPING #-} A.Replaceable SockAddr B.ByteString FilesystemM where
  replace _ addr packet = do
    sock' <- asks _filesystemPeerUDPSocket
    liftIO $ catch 
      (void $ NB.sendTo sock' packet addr) 
      (\(err :: IOError) -> runLoggingT . $logErrorS "NB.sendTo" . T.pack $ "Could not send data to " <> show addr <> "; got error: " <> show err)

instance {-# OVERLAPPING #-} A.Selectable () (B.ByteString, SockAddr) FilesystemM where
  select _ _ = do
    s <- asks _filesystemPeerUDPSocket
    liftIO . timeout 10000000 $ NB.recvFrom s 80000

instance {-# OVERLAPPING #-} A.Selectable (Host, UDPPort, B.ByteString) Point FilesystemM where
  select p = liftIO . A.select p

createFilesystemPeer ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  FilesystemPeer
createFilesystemPeer = FilesystemPeer