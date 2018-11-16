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
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Crypto.PubKey.ECC.DH
import           Data.Conduit.Network
import           Data.Streaming.Network                (appCloseConnection)
import qualified Data.Text                             as T
import qualified Database.Persist.Sql                  as SQL

import           Blockchain.DB.SQLDB
import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.P2PUtil
import           Blockchain.Strato.Discovery.Data.Peer

getPeerByIP :: (HasSQLDB m, MonadResource m, MonadThrow m)
            => String
            -> m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
    db <- getSQLDB
    SQL.runSqlPool actions db >>= \case
        [] -> return Nothing
        lst -> return . Just $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []


runEthServer :: (MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadUnliftIO m)
             => PrivateNumber
             -> Int
             -> m ()
runEthServer myPriv listenPort = runContextM flags_maxReturnedHeaders $ do
  let myPubkey = calculatePublic theCurve myPriv
  void . runGeneralTCPServer (serverSettings listenPort "*") $ \app ->
   runContextM flags_maxReturnedHeaders $ do
    let theSockAddr = sockAddrToIP (appSockAddr app)
    getPeerByIP theSockAddr >>= \case
      Nothing -> do
        $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ show theSockAddr ++ ". rejecting violently."
        liftIO (appCloseConnection app)
      Just peer -> do
        let p  = SQL.entityVal peer
        case pPeerPubkey p of
          Nothing -> do
            $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ show theSockAddr  ++ ". rejecting violently."
            liftIO (appCloseConnection app)
          Just otherPubKey -> do
            void . liftIO $ setPeerActiveState (pPeerIp p) (pPeerTcpPort p) Active
            (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptAccept myPriv otherPubKey `fuseUpstream` appSink app
            !eventSource <- mkEthP2PEventSource app inCtx []
            let !eventSink = mkEthP2PEventConduit (show $ appSockAddr app) outCtx
            (attempt :: Either SomeException ()) <- try . runConduit $
                   eventSource
                .| handleMsgServerConduit myPubkey p
                .| eventSink
                .| appSink app

            void . liftIO $ setPeerActiveState (pPeerIp p) (pPeerTcpPort p) Unactive
            case attempt of
              Right () -> $logDebugS "runEthServer" "Peer ran successfully!"
              Left err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen

  void . runResourceT $ runEthServer myPriv flags_listen
