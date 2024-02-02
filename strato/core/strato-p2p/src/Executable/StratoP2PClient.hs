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
import           Blockchain.Context
import           Blockchain.Data.PubKey (secPubKeyToPoint)
import           Blockchain.EthEncryptionException
import           Blockchain.EventException
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.RLPx
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.TCPClientWithTimeout
import           Control.Concurrent hiding (yield)
import           Control.Concurrent.SSem (SSem)
import qualified Control.Concurrent.SSem as SSem
import           Control.Exception.Base (ErrorCall (..))
import           Control.Lens ((^.))
import           Control.Monad (forever, unless, void)
import qualified Control.Monad.Change.Alter as A
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import           Data.Conduit
import           Data.Either.Combinators
import           Data.Maybe
import qualified Data.Text as T
import           GHC.IO.Exception
import           Ki.Unlifted as KIU
import qualified Text.Colors as C
import           Text.Format
import           UnliftIO

runPeer ::
  (RunsClient m, MonadP2P m) =>
  PPeer ->
  ConduitM () P2pEvent m () ->
  m ()
runPeer peer sSource = do
  ender <- toIO . $logInfoS "runPeer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  reg   <- register ender
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
          release reg
          throwIO NoPeerPubKey
    Just pub -> return pub

  $logInfoS "runPeer" . T.pack . C.blue $ "Welcome to strato-p2p-client"
  $logInfoS "runPeer" . T.pack . C.blue $ "============================"
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey 
  runClientConnection (IPAsText $ pPeerIp peer) (TCPPort . fromIntegral $ pPeerTcpPort peer) sSource $ \c -> do
      let pStr = pPeerString peer -- display string will show up as dns name
      attempt :: (Maybe SomeException) <- 
        withCertifiedPeer peer . withActivePeer peer . scoped $
          runEthClientConduit
            peer {pPeerPubkey = Just otherPubKey}
            (c ^. peerSource)
            (c ^. peerSink)
            (c ^. seqSource)
            pStr
      case attempt of
        Nothing  -> do $logDebugS "runPeer" "Peer ran successfully!"
                       release reg
        Just err -> do $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err
                       release reg
                       throwIO err

runEthClientConduit ::
  MonadP2P m =>
  PPeer ->
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  String ->
  Scope ->
  m (Maybe SomeException)
runEthClientConduit peer pSource pSink seqSrc peerStr scp = do
  myPublic' <- getPub
  let myPublic = secPubKeyToPoint myPublic'
      otherPubKey = fromMaybe (error "programmer error: runEthClientConduit was called without a pubkey") $ pPeerPubkey peer
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptConnect otherPubKey `fuseUpstream` pSink
  case mConnectionResult of
    Nothing                   -> pure $ Just $ toException $ HandshakeException "handshake timed out"
    Just (_, (outCtx, inCtx)) -> do
      !eventSource <- mkEthP2PEventSource pSource seqSrc peerStr inCtx scp
      !eventSink   <- mkEthP2PEventConduit peerStr outCtx
      fmap (either Just (const Nothing)) . try . runConduit $
        eventSource
           .| handleMsgClientConduit myPublic peer
           .| eventSink
           .| pSink

runPeerInList ::
  ( MonadP2P m,
    RunsClient m
  ) =>
  PPeer ->
  ConduitM () P2pEvent m () ->
  m (Either SomeException ())
runPeerInList thePeer sSource = do 
  eErr <- nonviolentDisable thePeer --don't connect to a peer too frequently, out of politeness
  case eErr of
    Left err -> do
      $logErrorS "runPeerInList" . T.pack $ "Unable to disable peer:" ++ show err
      $logErrorS "runPeerInList" "Simulating disable..."
      liftIO $ threadDelay $ 10 * 1000 * 1000
    Right () -> pure ()
  try $ runPeer thePeer sSource

stratoP2PClient :: (MonadP2P m, RunsClient m) => PeerRunner m (LoggingT IO) () -> LoggingT IO ()
stratoP2PClient runner = runner $ \sSource -> do
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn
  activePeersSem <- liftIO (SSem.new flags_maxConn)
  forever $ do
    $logDebugS "stratoP2PClient" "About to fetch available peers and loop over them"
    ePeers <- getBondedPeers
    case ePeers of
      Left err -> do
        $logErrorS "stratoP2PClient" . T.pack $ "Could not fetch peers: " ++ show err
        liftIO $ threadDelay 1000000
      Right peers -> do
        _ <- async (multiThreadedClient peers activePeersSem sSource)
        $logInfoS "stratoP2PClient" "Waiting 5 seconds before looping over peers again"
        liftIO $ threadDelay 5000000
  where
    multiThreadedClient :: (MonadP2P m, RunsClient m) => [PPeer] -> SSem -> ConduitM () P2pEvent m () -> m ()
    multiThreadedClient [] _ _ = do
      $logInfoS "stratoP2PClient/multiThreadedClient" "No available peers, will try again in 10 seconds"
      liftIO $ threadDelay 10000000
    multiThreadedClient peers sem sSource = do
      let notRunningPeers = filter ((== 0) . pPeerActiveState) peers
      unless (null notRunningPeers) . void . forConcurrently notRunningPeers $ \p -> do
        liftIO (SSem.tryWait sem) >>= \case
          Nothing -> return ()
          Just _ -> do
            result <- runPeerInList p sSource
            _ <- handleRunPeerResult p result
            liftIO $ SSem.signal sem
    handleRunPeerResult :: MonadP2P m => PPeer -> Either SomeException () -> m ()
    handleRunPeerResult thePeer = \case
      Left e | Just (ErrorCall x) <- fromException e -> error x
      Left e -> do
        $logInfoS "stratoP2PClient/handleRunPeerResult" $ T.pack $ "Connection ended: " ++ show (e :: SomeException)
        recordException thePeer e
        eErr <- case e of
          e' | Just WrongGenesisBlock <- fromException e' -> do
            udpErr <- disableUDPPeerForSeconds thePeer 86400
            whenLeft udpErr $ \theUDPErr -> do
              $logErrorLS "stratoP2PClient/handleRunPeerResult" theUDPErr
            disErr <- storeDisableException thePeer (T.pack "WrongGenesisBlock")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            case pPeerPubkey thePeer of 
              Just pubkey -> A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp thePeer, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
              Nothing -> return ()
            lengthenPeerDisable thePeer
          e' | Just HeadMacIncorrect <- fromException e' -> do
            disErr <- storeDisableException thePeer (T.pack "HeadMacIncorrect")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) thePeer
          e' | Just NetworkIDMismatch <- fromException e' -> do
            udpErr <- disableUDPPeerForSeconds thePeer 86400
            whenLeft udpErr $ \theUDPErr -> do
              $logErrorLS "stratoP2PClient/handleRunPeerResult" theUDPErr
            disErr <- storeDisableException thePeer (T.pack "NetworkIDMismatch")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            case pPeerPubkey thePeer of 
              Just pubkey -> A.replace (A.Proxy @PeerBondingState) (IPAsText $ pPeerIp thePeer, pubkey) (PeerBondingState 3) -- 3 indicates wrong genesis block/networkID
              Nothing -> return ()
            lengthenPeerDisable thePeer
          e' | Just PeerDisconnected <- fromException e' -> do
            disErr <- storeDisableException thePeer (T.pack "PeerDisconnected")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) thePeer
          e' | Just PeerNonResponsive <- fromException e' -> do
            disErr <- storeDisableException thePeer (T.pack "PeerNonResponsive")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) thePeer
          e' | Just TimeoutException <- fromException e' -> do
            disErr <- storeDisableException thePeer (T.pack "TimeoutException")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) thePeer
          e' | Just NoPeerCertificate <- fromException e' -> do
            disErr <- storeDisableException thePeer (T.pack "NoPeerCertificate")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
            udpErr <- disableUDPPeerForSeconds thePeer 86400
            whenLeft udpErr $ \theUDPErr -> do
              $logErrorLS "stratoP2PClient/handleRunPeerResult" theUDPErr
            lengthenPeerDisable thePeer
          e' | Just (IOError _ ioErrType _ _ _ _) <- fromException e' -> do
            case ioErrType of
              NoSuchThing -> do
                udpErr <- disableUDPPeerForSeconds thePeer 86400
                whenLeft udpErr $ \theUDPErr -> do
                  $logErrorLS "stratoP2PClient/handleRunPeerResult" theUDPErr
                disErr <- storeDisableException thePeer (T.pack "ioErrType: NoSuchThing")
                whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
                lengthenPeerDisableBy (fromIntegral $ 2 * flags_connectionTimeout) thePeer
              _ -> return $ Right ()
          _ -> return $ Right ()
        whenLeft eErr $ \err -> do
          $logErrorLS "stratoP2PClient/handleRunPeerResult" err
      Right _ -> return ()
