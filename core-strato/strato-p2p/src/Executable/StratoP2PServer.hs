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
  , runEthServerConduit
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.RLPx
import           Conduit
import           Control.Monad
import qualified Control.Monad.Change.Alter            as A
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
  cfg <- initConfig flags_maxReturnedHeaders
  void . runContextM cfg $ do
    uSink <- asks configUnseqSink
    ethServer myPriv listenPort uSink

ethServer :: ( MonadP2P m
             , MonadReader Config m
             , A.Selectable String PPeer m
             , ((T.Text, Int) `A.Alters` ActivityState) m
             )
          => PrivateNumber -> Int -> ([IngestEvent] -> m ()) -> m ()
ethServer myPriv listenPort uSink = do
  let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
  runGeneralTCPServer settings $ \app ->
    let pSource = appSource app
        pSink = appSink app
        sSource = seqEventNotificationSource $ contextKafkaState initContext
        sAddr = appSockAddr app
     in ethServerHandler myPriv pSource pSink sSource uSink sAddr

ethServerHandler :: ( MonadP2P m
                    , MonadReader Config m
                    , A.Selectable String PPeer m
                    , ((T.Text, Int) `A.Alters` ActivityState) m
                    )
                 => PrivateNumber
                 -> ConduitM () B.ByteString m ()
                 -> ConduitM B.ByteString Void m ()
                 -> ConduitM () P2pEvent m ()
                 -> ([IngestEvent] -> m ())
                 -> SockAddr
                 -> m ()
ethServerHandler myPriv peerSource peerSink seqSource unseqSink sockAddr = do
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
          (attempt :: Either SomeException ()) <- withActivePeer p $ do
            initState <- newIORef initContext
            local (\c -> c{configContext = initState}) $
              runEthServerConduit myPriv p peerSource peerSink seqSource unseqSink peerStr
          case attempt of
            Right () -> $logDebugS "runEthServer" "Peer ran successfully!"
            Left err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthServerConduit :: MonadP2P m
                    => PrivateNumber
                    -> PPeer
                    -> ConduitM () B.ByteString m ()
                    -> ConduitM B.ByteString Void m ()
                    -> ConduitM () P2pEvent m ()
                    -> ([IngestEvent] -> m ())
                    -> String
                    -> m (Either SomeException ())
runEthServerConduit myPriv p peerSource peerSink seqSource unseqSink peerStr = do
  let myPubkey = calculatePublic theCurve myPriv
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  (_, (outCtx, inCtx)) <- peerSource $$+ ethCryptAccept myPriv otherPubKey `fuseUpstream` peerSink
  !eventSource <- mkEthP2PEventSource peerSource seqSource peerStr inCtx
  !eventSink <- mkEthP2PEventConduit peerStr outCtx unseqSink
  try . runConduit $ eventSource
                  .| handleMsgServerConduit myPubkey p
                  .| eventSink
                  .| peerSink

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen

  void $ runEthServer myPriv flags_listen
