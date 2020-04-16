{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Executable.StratoP2PServer
  ( stratoP2PServer
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.RLPx
import           Conduit
import           Control.Monad
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Crypto.PubKey.ECC.DH
import qualified Data.ByteString                       as B
import           Data.Conduit.Network
import           Data.Maybe                            (fromMaybe)
import qualified Data.Text                             as T
import           Network.Socket
import           Network.Wai.Handler.Warp.Internal     (setSocketCloseOnExec)
import           UnliftIO

import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Output
import           Blockchain.P2PUtil
import           Blockchain.SeqEventNotify
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Text.Colors                           as C

runEthServer :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
             => PrivateNumber
             -> Int
             -> m ()
runEthServer myPriv listenPort = do
  cfg <- initConfig myPriv flags_maxReturnedHeaders
  void . runContextM cfg $ ethServer listenPort

ethServer :: ( MonadP2P m
             , MonadUnliftIO m
             , MonadReader Config m
             , Mod.Accessible PrivateNumber m
             , A.Selectable String PPeer m
             , ((T.Text, Int) `A.Alters` ActivityState) m
             )
          => Int -> m ()
ethServer listenPort = do
  let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
  runGeneralTCPServer settings $ \app ->
    let pSource = appSource app
        pSink = appSink app
        sSource = seqEventNotificationSource $ contextKafkaState initContext
        sAddr = appSockAddr app
     in ethServerHandler pSource pSink sSource sAddr

ethServerHandler :: ( MonadP2P m
                    , MonadUnliftIO m
                    , MonadReader Config m
                    , Mod.Accessible PrivateNumber m
                    , A.Selectable String PPeer m
                    , ((T.Text, Int) `A.Alters` ActivityState) m
                    )
                 => ConduitM () B.ByteString m ()
                 -> ConduitM B.ByteString Void m ()
                 -> ConduitM () P2pEvent m ()
                 -> SockAddr
                 -> m ()
ethServerHandler peerSource peerSink seqSource sockAddr = do
  let theSockAddr = sockAddrToIP sockAddr
      peerStr = show theSockAddr
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow theSockAddr
  void $ register ender
  getPeerByIP theSockAddr >>= \case
    Nothing -> do
      $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ peerStr ++ ". rejecting violently."
    Just p -> do
      case pPeerPubkey p of
        Nothing -> do
          $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ peerStr  ++ ". rejecting violently."
        Just _ -> do
          (attempt :: Either SomeException ()) <- withActivePeer p $
            runEthServerConduit p peerSource peerSink seqSource peerStr
          case attempt of
            Right () -> $logDebugS "runEthServer" "Peer ran successfully!"
            Left err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthServerConduit :: ( MonadP2P m
                       , MonadUnliftIO m
                       , MonadReader Config m
                       , Mod.Accessible PrivateNumber m
                       )
                    => PPeer
                    -> ConduitM () B.ByteString m ()
                    -> ConduitM B.ByteString Void m ()
                    -> ConduitM () P2pEvent m ()
                    -> String
                    -> m (Either SomeException ())
runEthServerConduit p peerSource peerSink seqSource peerStr = do
  myPriv <- Mod.access (Mod.Proxy @PrivateNumber)
  let myPubkey = calculatePublic theCurve myPriv
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  (_, (outCtx, inCtx)) <- peerSource $$+ ethCryptAccept myPriv otherPubKey `fuseUpstream` peerSink
  !eventSource <- mkEthP2PEventSource peerSource seqSource peerStr inCtx
  !eventSink <- mkEthP2PEventConduit peerStr outCtx
  initState <- newIORef initContext
  try . local (\c -> c{configContext = initState})
      . runConduit $ eventSource
                  .| handleMsgServerConduit myPubkey p
                  .| eventSink
                  .| peerSink

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen

  void $ runEthServer myPriv flags_listen
