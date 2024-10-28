{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.StratoP2PServer
  ( stratoP2PServer,
    runEthServerConduit,
  )
where

import BlockApps.Logging
import Blockchain.CommunicationConduit
import Blockchain.Context hiding (Inbound, Outbound)
import Blockchain.Data.PubKey (secPubKeyToPoint)
import Blockchain.Display (displayMessage, MsgDirection(..))
import Blockchain.EthEncryptionException
import Blockchain.Event
import Blockchain.EventException
import Blockchain.ExtMergeSources
import Blockchain.Frame
import Blockchain.Metrics
import Blockchain.Options
import Blockchain.RLPx
import Blockchain.Sequencer.Event
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Threads
import Blockchain.TimerSource
import Conduit
import Control.Lens ((^.))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.Conduit.List as CL
import Data.Either.Combinators
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import GHC.IO.Exception
import qualified Text.Colors as C
import UnliftIO

runEthServer ::
  (RunsServer n m, MonadP2P n) =>
  Int ->
  PeerRunner n m () ->
  m ()
runEthServer listenPort runner =
  runServer (TCPPort listenPort) runner $ \c a ->
    ethServerHandler (c ^. peerSource) (c ^. peerSink) (c ^. seqSource) a

ethServerHandler ::
  MonadP2P m =>
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  IPAsText ->
  m ()
ethServerHandler pSource pSink seqSrc ipAsText@(IPAsText i) = do
  let peerStr = "<" ++ T.unpack i
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow peerStr
  void $ register ender
  getPeerByIP ipAsText >>= \case
    Nothing -> do
      $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ peerStr ++ ". rejecting violently."
    Just p -> do
      case pPeerPubkey p of
        Nothing -> do
          $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ peerStr ++ ". rejecting violently."
        Just pubkey -> do
            attempt <- withCertifiedPeer p . withActivePeer p $
                         runEthServerConduit p pSource pSink seqSrc peerStr
            case attempt of
              Nothing  -> $logDebugS "runEthServer" "Peer ran successfully!"
              Just err -> do
                $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err
                _ <- case err of
                  e' | Just WrongGenesisBlock <- fromException e' -> do
                    udpErr <- disableUDPPeerForSeconds p 86400
                    whenLeft udpErr $ \theUDPErr -> do
                      $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
                    disErr <- storeDisableException p (T.pack "WrongGenesisBlock")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                    A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp p, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
                    lengthenPeerDisable p
                  e' | Just HeadMacIncorrect <- fromException e' -> do
                    disErr <- storeDisableException p (T.pack "HeadMacIncorrect")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                    lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) p
                  e' | Just NetworkIDMismatch <- fromException e' -> do
                    udpErr <- disableUDPPeerForSeconds p 86400
                    whenLeft udpErr $ \theUDPErr -> do
                      $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
                    disErr <- storeDisableException p (T.pack "NetworkIDMismatch")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                    A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp p, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
                    lengthenPeerDisable p
                  e' | Just PeerDisconnected <- fromException e' -> do
                    disErr <- storeDisableException p (T.pack "PeerDisconnected")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                    lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) p
                  e' | Just CurrentlyTooManyPeers <- fromException e' -> do
                    disErr <- storeDisableException p (T.pack "CurrentlyTooManyPeers")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                    lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) p
                  e' | Just NoPeerCertificate <- fromException e' -> do
                    disErr <- storeDisableException p (T.pack "NoPeerCertificate")
                    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
                    udpErr <- disableUDPPeerForSeconds p 86400
                    whenLeft udpErr $ \theUDPErr -> do
                      $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
                    lengthenPeerDisable p
                  e' | Just (IOError _ ioErrType _ _ _ _) <- fromException e' -> do
                    case ioErrType of
                      NoSuchThing -> do
                        udpErr <- disableUDPPeerForSeconds p 86400
                        whenLeft udpErr $ \theUDPErr -> do
                          $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
                        disErr <- storeDisableException p (T.pack "TimeoutException")
                        whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
                        lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) p
                      _ -> return $ Right ()
                  _ -> return $ Right ()
                throwIO err

runEthServerConduit ::
  MonadP2P m =>
  PPeer ->
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  String ->
  m (Maybe SomeException)
runEthServerConduit p pSource pSink seqSrc peerStr = labelPeerThread peerStr "Peer Manager" (Just "CONNECTED") $ do
  myPubKey' <- getPub
  let myPubkey = secPubKeyToPoint myPubKey'
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptAccept otherPubKey `fuseUpstream` pSink
  case mConnectionResult of
    Nothing -> pure $ Just $ toException $ HandshakeException "handshake timed out"
    Just (_, (outCtx, inCtx)) -> do
      ret <-
        fmap (either Just (const Nothing)) . try $
        [ labelPeerThread peerStr "Peer Source" Nothing $
          pSource
          .| ethDecrypt inCtx
          .| CL.iterM (recordTraffic Inbound)
          .| bytesToMessages
          .| CL.iterM (displayMessage Inbound peerStr)
          .| CL.map MsgEvt
        , labelPeerThread peerStr "Sequencer Source" Nothing $
          seqSrc
          .| CL.map NewSeqEvent
        , labelPeerThread peerStr "Timer Source" Nothing $
          timerSource
        ] `mergeConnect` (
        CL.iterM recordEvent
          .| labelPeerThread peerStr "P2P Handler" Nothing (handleMsgServerConduit myPubkey p)
          .| debounceTxSendsAndUnseq
          .| CL.iterM recordMessage
          .| CL.iterM (displayMessage Outbound peerStr)
          .| messageToBytes
          .| CL.iterM (recordTraffic Outbound)
          .| ethEncrypt outCtx
          .| pSink
        )

      case ret of
        Nothing -> changeLabelStatusM $ "DISCONNECTING"
        Just e -> changeLabelStatusM $ "DISCONNECTING: " ++ show e

      return ret

stratoP2PServer ::
  (MonadP2P n, RunsServer n (LoggingT IO)) =>
  PeerRunner n (LoggingT IO) () ->
  LoggingT IO ()
stratoP2PServer runner = labelTheThread "stratoP2PServer" $ do
  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen
  runEthServer flags_listen runner

