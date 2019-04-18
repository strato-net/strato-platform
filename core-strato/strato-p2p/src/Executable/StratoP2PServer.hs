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
import           Control.Monad
import           Control.Monad.Trans.Identity
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import           Control.Monad.Logger
import           Crypto.PubKey.ECC.DH
import           Data.Conduit.Network
import           Data.Streaming.Network                (appCloseConnection)
import qualified Data.Text                             as T
import qualified Database.Persist.Types                as SQL
import           UnliftIO

import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.P2PUtil
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Text.Colors                           as C

runEthServer :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
             => PrivateNumber
             -> Int
             -> m ()
runEthServer myPriv listenPort = do
  ctx <- initContext flags_maxReturnedHeaders
  let myPubkey = calculatePublic theCurve myPriv
  void . runContextM ctx $ do
    initState <- get
    lift . runGeneralTCPServer (serverSettings listenPort "*") $ \app -> runResourceT $ do
      let theSockAddr = sockAddrToIP (appSockAddr app)
      ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow theSockAddr
      void $ register ender
      runIdentityT (getPeerByIP theSockAddr) >>= \case
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
              !eventSource <- mkEthP2PEventSource app inCtx (contextKafkaState initState) []
              let !eventSink = mkEthP2PEventConduit (show $ appSockAddr app) outCtx
              (attempt :: Either SomeException ()) <- try . runConduit . evalStateLC initState $
                     transPipe lift eventSource
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

  void $ runEthServer myPriv flags_listen
