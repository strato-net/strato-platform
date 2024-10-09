{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PatternGuards #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.StratoP2PClient
  ( stratoP2PClient,
    runEthClientConduit
  )
where

import           BlockApps.Logging
import           Blockchain.CommunicationConduit
import           Blockchain.Context hiding (Inbound, Outbound)
import           Blockchain.Data.PubKey (secPubKeyToPoint)
import           Blockchain.Display (displayMessage, MsgDirection(..))
import           Blockchain.EthEncryptionException
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.RLPx
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Threads
import           Blockchain.TimerSource
import           Control.Concurrent hiding (yield)
import           Control.Exception.Base (ErrorCall (..))
import           Control.Lens ((^.))
import           Control.Monad (forever, forM_, when, void)
import qualified Control.Monad.Change.Alter as A
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import           Data.Conduit
import qualified Data.Conduit.List as CL
import           Data.Either.Combinators
import           Data.Maybe
import qualified Data.Text as T
import           Data.Time.Clock (NominalDiffTime)
import           GHC.IO.Exception
import qualified Text.Colors as C
import           Text.Format
import           UnliftIO

runPeer ::
  (RunsClient m, MonadP2P m) =>
  PPeer ->
  ConduitM () P2pEvent m () ->
  m ()
runPeer peer sSource = do
  let pStr = ">" ++ pPeerString peer -- display string will show up as dns name
  labelPeerThreadM pStr "Peer Manager" (Just "CONNECTING...")
  ender <- toIO . $logInfoS "runPeer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  void $ register ender
  myPublic <- getPub
  otherPubKey <- case (pPeerPubkey peer) of
    Nothing -> do
      $logInfoS "getPubKeyRunPeer" $ T.pack $ "Attempting to connect to " ++ pPeerString peer ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
      eitherOtherPubKey <- getServerPubKey peer
      case eitherOtherPubKey of
        Right pub -> do
          $logInfoS "getPubKeyRunPeer" $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format pub
          return pub
        Left e -> do
          $logErrorS "getPubKeyRunPeer" $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
          throwIO NoPeerPubKey
    Just pub -> return pub

  $logInfoS "runPeer" . T.pack . C.blue $ "Welcome to strato-p2p-client"
  $logInfoS "runPeer" . T.pack . C.blue $ "============================"
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey 
  withActivePeer peer $
    runClientConnection (IPAsText $ pPeerIp peer) (TCPPort . fromIntegral $ pPeerTcpPort peer) sSource $ \c -> do
      attempt :: (Maybe SomeException) <- 
        withCertifiedPeer peer $
          runEthClientConduit
            peer {pPeerPubkey = Just otherPubKey}
            (c ^. peerSource)
            (c ^. peerSink)
            (c ^. seqSource)
            pStr

      case attempt of
        Nothing  -> $logDebugS "runPeer" "Peer ran successfully!"
        Just err -> do $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err
                       throwIO err

runEthClientConduit ::
  MonadP2P m =>
  PPeer ->
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  String ->
  m (Maybe SomeException)
runEthClientConduit peer pSource pSink seqSrc peerStr = do
  changeLabelStatusM $ "CONNECTED"
  myPublic' <- getPub
  let myPublic = secPubKeyToPoint myPublic'
      otherPubKey = fromMaybe (error "programmer error: runEthClientConduit was called without a pubkey") $ pPeerPubkey peer
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptConnect otherPubKey `fuseUpstream` pSink
  case mConnectionResult of
    Nothing                   -> pure $ Just $ toException $ HandshakeException "handshake timed out"
    Just (_, (outCtx, inCtx)) -> do
      ret <-
        fmap (either Just (const Nothing)) . try $ 
        [
          labelPeerThread peerStr "Peer Source" Nothing $
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
           .| labelPeerThread peerStr "P2P Handler" Nothing
                           (handleMsgClientConduit myPublic peer)
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

runPeerInList ::
  ( MonadP2P m,
    RunsClient m
  ) =>
  PPeer ->
  ConduitM () P2pEvent m () ->
  m ()
runPeerInList thePeer sSource = do
  eErr <- nonviolentDisable thePeer --don't connect to a peer too frequently, out of politeness
  case eErr of
    Left err -> do
      $logErrorS "runPeerInList" . T.pack $ "Unable to disable peer:" ++ show err
      $logErrorS "runPeerInList" "Simulating disable..."
      liftIO $ threadDelay $ 10 * 1000 * 1000
    Right () -> pure ()
  runPeer thePeer sSource

stratoP2PClient :: (MonadP2P m, RunsClient m) => PeerRunner m (LoggingT IO) () -> LoggingT IO ()
stratoP2PClient runner = runner $ \_ -> labelTheThread "strato P2P Client main loop" $ do
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn
  forever $ do
    $logDebugS "stratoP2PClient" "About to fetch available peers and loop over them"
    ePeers <- getBondedPeers
    case ePeers of
      Left err -> do
        $logErrorS "stratoP2PClient" . T.pack $ "Could not fetch peers: " ++ show err
        liftIO $ threadDelay 1000000
      Right peers -> do
        numActivePeers <- liftIO $ fmap length getPeersByThreads
        forM_ (take (flags_maxConn - numActivePeers) $ filter ((== 0) . pPeerActiveState) peers) $ \peer -> do
          _ <- liftIO . forkIO . runLoggingT . runner $ \_ -> do
              result <- try . liftIO . runLoggingT . runner $ runPeerInList peer
              handleRunPeerResult peer result
          return ()
        $logInfoS "stratoP2PClient" "Waiting 5 seconds before looping over peers again"
        liftIO $ threadDelay 5000000
  where
    handleRunPeerResult :: MonadP2P m => PPeer -> Either SomeException () -> m ()
    handleRunPeerResult thePeer = \case
      Left e -> do
        $logInfoS "stratoP2PClient/handleRunPeerResult" $ T.pack $ "Connection ended: " ++ show (e :: SomeException)
        recordException thePeer e
        case e of
          e' | Just (ErrorCall x) <- fromException e' -> do 
            disableException thePeer x Nothing False 
            error x
          e' | Just (HandshakeException _) <- fromException e' -> do 
            disableException thePeer "HandshakeException" Nothing False 
          e' | Just WrongGenesisBlock <- fromException e' -> do
            disableException thePeer "WrongGenesisBlock" Nothing True
            case pPeerPubkey thePeer of 
              Just pubkey -> A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp thePeer, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
              Nothing -> return ()
          e' | Just HeadMacIncorrect <- fromException e' -> do
            disableException thePeer "HeadMacIncorrect" (Just . fromIntegral $ 2 * flags_connectionTimeout) False
          e' | Just NetworkIDMismatch <- fromException e' -> do
            disableException thePeer "NetworkIDMismatch" Nothing True
            case pPeerPubkey thePeer of 
              Just pubkey -> A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp thePeer, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
              Nothing -> return ()
          e' | Just PeerDisconnected <- fromException e' -> do
            disableException thePeer "PeerDisconnected" (Just . fromIntegral $ 2 * flags_connectionTimeout) True
          e' | Just PeerNonResponsive <- fromException e' -> do
            disableException thePeer "PeerNonResponsive" (Just . fromIntegral $ 2 * flags_connectionTimeout) False
          e' | Just NoPeerCertificate <- fromException e' -> do
            disableException thePeer "NoPeerCertificate" Nothing True
          e' | Just (IOError _ ioErrType _ _ _ _) <- fromException e' -> do
            case ioErrType of
              NoSuchThing -> disableException thePeer "ioErrType: NoSuchThing" (Just . fromIntegral $ 2 * flags_connectionTimeout) True
              i -> disableException thePeer ("ioErrType: " <> show i) Nothing True
          _ -> return ()
      Right _ -> return ()

  -- where 
    disableException :: MonadP2P m => PPeer -> String -> Maybe NominalDiffTime -> Bool -> m ()
    disableException p exception disableBy disableUDP = do
      disErr <- storeDisableException p (T.pack exception)
      whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
      _ <- case disableBy of 
        Just secs -> lengthenPeerDisableBy secs p
        Nothing -> lengthenPeerDisable p
      when disableUDP $ do 
        udpErr <- disableUDPPeerForSeconds p 86400
        whenLeft udpErr $ \theUDPErr -> do
          $logErrorLS "stratoP2PClient/handleRunPeerResult" theUDPErr