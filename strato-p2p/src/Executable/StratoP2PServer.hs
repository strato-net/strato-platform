{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Executable.StratoP2PServer (
  stratoP2PServer
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.ContextLite
import           Blockchain.RLPx
import           Conduit
import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.STM.MonadIO
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.Logger
import           Crypto.PubKey.ECC.DH
import           Data.Conduit.Network
import           Data.Maybe
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL
import           Prelude

import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.P2PRPC
import           Blockchain.P2PUtil
import           Blockchain.ServOptions
import           Blockchain.Strato.Discovery.Data.Peer
import           Data.Streaming.Network                (appCloseConnection)

runEthServer :: (MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m)
             => TVar (S.Set ConnectedPeer)
             -> PrivateNumber
             -> Int
             -> m ()
runEthServer connectedPeers myPriv listenPort = do
  ctx <- initContextLite
  let myPubkey = calculatePublic theCurve myPriv
  void . runEthCryptMLite ctx . runGeneralTCPServer (serverSettings listenPort "*") $ \app -> do
    let theSockAddr = sockAddrToIP (appSockAddr app)
    getPeerByIP theSockAddr >>= \case
      Nothing -> do
        $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ show theSockAddr ++ ". rejecting violently."
        liftIO (appCloseConnection app)
      Just peer -> do
        let unwrappedPeer  = SQL.entityVal peer
            cp             = ConnectedPeer unwrappedPeer
        case pPeerPubkey unwrappedPeer of
          Nothing -> do
            $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ show theSockAddr  ++ ". rejecting violently."
            liftIO (appCloseConnection app)
          Just otherPubKey -> do
            void $ modifyTVar connectedPeers (S.insert cp)
            (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptAccept myPriv otherPubKey `fuseUpstream` appSink app
            eventSource <- mkEthP2PEventSource app inCtx
            (_ :: Either SomeException ()) <- try $ eventSource
                           =$= handleMsgServerConduit myPubkey unwrappedPeer
                           =$= mkEthP2PEventConduit app outCtx
                            $$ appSink app

            void $ modifyTVar connectedPeers (S.delete cp)

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf
  connectedPeers <- newTVar S.empty

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ (flags_address)
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ (show flags_listen)
  $logInfoS "stratoP2PClient" $ T.pack $ "serverCommPort: " ++ show serverCommPort

  void . liftIO . forkIO $ runStratoP2PComm serverCommPort connectedPeers
  void . runResourceT $ runEthServer connectedPeers myPriv flags_listen

