{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Executable.StratoP2PServer
  ( stratoP2PServer
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.RLPx
import           Conduit
import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.STM.MonadIO
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.Logger
import           Crypto.PubKey.ECC.DH
import           Data.Conduit.Network
import qualified Data.Set                              as S
import           Data.Streaming.Network                (appCloseConnection)
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL

import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.P2PRPC
import           Blockchain.P2PUtil
import           Blockchain.ServOptions
import           Blockchain.Strato.Discovery.Data.Peer

runEthServer :: (MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m)
             => TVar (S.Set ConnectedPeer)
             -> PrivateNumber
             -> Int
             -> m ()
runEthServer connectedPeers myPriv listenPort = do
  ctx <- initContext
  let myPubkey = calculatePublic theCurve myPriv
  void . runContextM ctx . runGeneralTCPServer (serverSettings listenPort "*") $ \app -> do
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
            !eventSource <- mkEthP2PEventSource app inCtx []
            let !eventSink = mkEthP2PEventConduit (show $ appSockAddr app) outCtx
            (attempt :: Either SomeException ()) <- try $
                        eventSource
                          =$= handleMsgServerConduit myPubkey unwrappedPeer
                          =$= eventSink
                           $$ appSink app

            void $ modifyTVar connectedPeers (S.delete cp)
            case attempt of
              Right () -> $logInfoS "runEthServer" "Peer ran successfully!"
              Left err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf
  connectedPeers <- newTVar S.empty

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ (flags_address)
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ (show flags_listen)
  $logInfoS "stratoP2PClient" $ T.pack $ "serverCommPort: " ++ show serverCommPort

  void . liftIO . forkIO $ runStratoP2PComm serverCommPort connectedPeers
  void . runResourceT $ runEthServer connectedPeers myPriv flags_listen

