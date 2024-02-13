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
--import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Messages
import Blockchain.CommunicationConduit
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
--import Blockchain.Data.Enode
import Blockchain.Data.PubKey (secPubKeyToPoint)
import Blockchain.EthEncryptionException
import Blockchain.EventException
import Blockchain.Options
import Blockchain.RLPx
import Blockchain.Sequencer.Event
import Blockchain.SeqEventNotify
import Blockchain.Strato.Discovery.Data.Peer
--import Blockchain.Strato.Model.Address
--import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.TCPClientWithTimeout
--import Network.Haskoin.Crypto.BigWord
import Conduit
import Control.Lens ((^.))
--import Control.Monad
import Control.Monad.Change.Modify
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import Data.Either.Combinators
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import GHC.IO.Exception
import Ki.Unlifted as KIU
import qualified Text.Colors as C
import UnliftIO
--import Data.Set.Ordered (empty)

{-
runEthServer :: ( MonadLogger m
                , MonadUnliftIO m
                , RunsServer (ReaderT Config (ResourceT m)) m
                , Accessible AvailablePeers (ReaderT Config (ResourceT m))
                , Accessible BondedPeers (ReaderT Config (ResourceT m))
                , A.Replaceable (IPAsText,Point) PeerBondingState (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer T.Text (ReaderT Config (ResourceT m))
                , A.Alters (IPAsText,TCPPort) ActivityState (ReaderT Config (ResourceT m))
                )
             => Int
             -> m ()
-}
{-
runEthServer :: ( RunsServer (ReaderT Config (ResourceT m)) m
                , MonadUnliftIO m
                , MonadLogger m
                , Stacks Block (ReaderT Config (ResourceT m))
                , HasVault (ReaderT Config (ResourceT m))
                , Outputs (ReaderT Config (ResourceT m)) [IngestEvent]
                , Accessible [BlockData] (ReaderT Config (ResourceT m))
                , Accessible ActionTimestamp (ReaderT Config (ResourceT m))
                , Accessible RemainingBlockHeaders (ReaderT Config (ResourceT m))
                , Accessible PeerAddress (ReaderT Config (ResourceT m))
                , Accessible MaxReturnedHeaders (ReaderT Config (ResourceT m))
                , Accessible ConnectionTimeout (ReaderT Config (ResourceT m))
                , Accessible GenesisBlockHash (ReaderT Config (ResourceT m))
                , Accessible BestBlockNumber (ReaderT Config (ResourceT m))
                , Accessible AvailablePeers (ReaderT Config (ResourceT m))
                , Accessible BondedPeers (ReaderT Config (ResourceT m))
                , Accessible PublicKey (ReaderT Config (ResourceT m))
                , Modifiable [BlockData] (ReaderT Config (ResourceT m))
                , Modifiable ActionTimestamp (ReaderT Config (ResourceT m))
                , Modifiable RemainingBlockHeaders (ReaderT Config (ResourceT m))
                , Modifiable PeerAddress (ReaderT Config (ResourceT m))
                , Modifiable BestBlock (ReaderT Config (ResourceT m))
                , Modifiable WorldBestBlock (ReaderT Config (ResourceT m))
                , A.Selectable (IPAsText, UDPPort, B.ByteString) Point (ReaderT Config (ResourceT m))
                , A.Selectable Word256 ChainMemberRSet (ReaderT Config (ResourceT m))
                , A.Selectable Word256 ChainInfo (ReaderT Config (ResourceT m))
                , A.Selectable Integer (Canonical BlockData) (ReaderT Config (ResourceT m))
                , A.Selectable Keccak256 (Private (Word256, OutputTx)) (ReaderT Config (ResourceT m))
                , A.Selectable Keccak256 ChainTxsInBlock (ReaderT Config (ResourceT m))
                , A.Selectable Address X509CertInfoState (ReaderT Config (ResourceT m))
                , A.Selectable IPAsText PPeer (ReaderT Config (ResourceT m))
                , A.Selectable Point PPeer (ReaderT Config (ResourceT m))
                , A.Selectable ChainMemberParsedSet [ChainMemberParsedSet] (ReaderT Config (ResourceT m))
                , A.Selectable ChainMemberParsedSet TrueOrgNameChains (ReaderT Config (ResourceT m))
                , A.Selectable ChainMemberParsedSet FalseOrgNameChains (ReaderT Config (ResourceT m))
                , A.Selectable ChainMemberParsedSet X509CertInfoState (ReaderT Config (ResourceT m))
                , A.Selectable ChainMemberParsedSet IsValidator (ReaderT Config (ResourceT m))
                , A.Replaceable (IPAsText, Point) PeerBondingState (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer T.Text (ReaderT Config (ResourceT m))
                , A.Alters (T.Text, Keccak256) (Proxy (Outbound WireMessage)) (ReaderT Config (ResourceT m))
                , A.Alters (IPAsText, TCPPort) ActivityState (ReaderT Config (ResourceT m))
                , A.Alters Keccak256 (Proxy (Inbound WireMessage)) (ReaderT Config (ResourceT m))
                , A.Alters Keccak256 BlockData (ReaderT Config (ResourceT m))
                , A.Alters Keccak256 OutputBlock (ReaderT Config (ResourceT m))
                )
             => Int
             -> Config
             -> m ()
-}
runEthServer :: ( MonadLogger m
                , MonadUnliftIO m
                , RunsServer (ReaderT Config (ResourceT m)) m
                , Stacks Block (ReaderT Config (ResourceT m))
                , Outputs (ReaderT Config (ResourceT m)) [IngestEvent]
                , Accessible [BlockData] (ReaderT Config (ResourceT m))
                , Accessible ActionTimestamp (ReaderT Config (ResourceT m))
                , Accessible RemainingBlockHeaders (ReaderT Config (ResourceT m))
                , Accessible PeerAddress (ReaderT Config (ResourceT m))
                , Accessible AvailablePeers (ReaderT Config (ResourceT m))
                , Accessible BondedPeers (ReaderT Config (ResourceT m))
                , Modifiable [BlockData] (ReaderT Config (ResourceT m))
                , Modifiable ActionTimestamp (ReaderT Config (ResourceT m))
                , Modifiable RemainingBlockHeaders (ReaderT Config (ResourceT m))
                , Modifiable PeerAddress (ReaderT Config (ResourceT m))
                , A.Replaceable (IPAsText, Point) PeerBondingState (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT m))
                , A.Replaceable PPeer T.Text (ReaderT Config (ResourceT m))
                , A.Alters (T.Text, Keccak256) (Proxy (Outbound WireMessage)) (ReaderT Config (ResourceT m))
                , A.Alters (IPAsText, TCPPort) ActivityState (ReaderT Config (ResourceT m))
                )
             => Int
             -> Config
             -> m ()
runEthServer listenPort cfg = do
  --wireMessagesRef <- liftIO $ newIORef empty
  --cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  let sSource  = seqEventNotificationSource $ contextKafkaState initContext
      runner f = runContextM cfg $ f sSource 
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
  let peerStr = T.unpack i
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow peerStr
  --void $ register ender
  reg <- register ender
  getPeerByIP ipAsText >>= \case
    Nothing -> do
      $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ peerStr ++ ". rejecting violently."
    Just p -> do
      case pPeerPubkey p of
        Nothing -> do
          $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ peerStr ++ ". rejecting violently."
        Just pubkey -> do
            attempt <- withCertifiedPeer p . withActivePeer p . scoped $
                         runEthServerConduit p pSource pSink seqSrc peerStr
            case attempt of
              Nothing  -> do $logDebugS "runEthServer" "Peer ran successfully!"
                             release reg
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
                  e' | Just TimeoutException <- fromException e' -> do
                    disErr <- storeDisableException p (T.pack "TimeoutException")
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
                release reg
                throwIO err

runEthServerConduit ::
  MonadP2P m =>
  PPeer ->
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  String ->
  Scope ->
  m (Maybe SomeException)
runEthServerConduit p pSource pSink seqSrc peerStr scp = do
  myPubKey' <- getPub
  let myPubkey = secPubKeyToPoint myPubKey'
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptAccept otherPubKey `fuseUpstream` pSink
  case mConnectionResult of
    Nothing -> pure $ Just $ toException $ HandshakeException "handshake timed out"
    Just (_, (outCtx, inCtx)) -> do
      !eventSource <- mkEthP2PEventSource pSource seqSrc peerStr inCtx scp
      !eventSink <- mkEthP2PEventConduit peerStr outCtx
      fmap (either Just (const Nothing)) . try . runConduit $
        eventSource
          .| handleMsgServerConduit myPubkey p
          .| eventSink
          .| pSink

{-
stratoP2PServer :: ( MonadLogger m
                   , MonadUnliftIO m
                   , Accessible AvailablePeers (ReaderT Config (ResourceT (LoggingT m)))
                   , Accessible BondedPeers (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Replaceable (IPAsText,Point) PeerBondingState (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Replaceable PPeer T.Text (ReaderT Config (ResourceT (LoggingT m)))
                   , A.Alters (IPAsText,TCPPort) ActivityState (ReaderT Config (ResourceT (LoggingT m)))
                   , RunsServer (ReaderT Config (ResourceT (LoggingT m))) (LoggingT m)
                   )
                => LoggingT m ()
-}
stratoP2PServer :: ( MonadLogger m
                   , MonadUnliftIO m
                   , RunsServer (ReaderT Config (ResourceT m)) m
                   , Stacks Block (ReaderT Config (ResourceT m))
                   , Outputs (ReaderT Config (ResourceT m)) [IngestEvent]
                   , Accessible [BlockData] (ReaderT Config (ResourceT m))
                   , Accessible ActionTimestamp (ReaderT Config (ResourceT m))
                   , Accessible RemainingBlockHeaders (ReaderT Config (ResourceT m))
                   , Accessible PeerAddress (ReaderT Config (ResourceT m))
                   , Accessible AvailablePeers (ReaderT Config (ResourceT m))
                   , Accessible BondedPeers (ReaderT Config (ResourceT m))
                   , Modifiable [BlockData] (ReaderT Config (ResourceT m))
                   , Modifiable ActionTimestamp (ReaderT Config (ResourceT m))
                   , Modifiable RemainingBlockHeaders (ReaderT Config (ResourceT m))
                   , Modifiable PeerAddress (ReaderT Config (ResourceT m))
                   , A.Replaceable (IPAsText, Point) PeerBondingState (ReaderT Config (ResourceT m))
                   , A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT m))
                   , A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT m))
                   , A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT m))
                   , A.Replaceable PPeer T.Text (ReaderT Config (ResourceT m))
                   , A.Alters (T.Text, Keccak256) (Proxy (Outbound WireMessage)) (ReaderT Config (ResourceT m))
                   , A.Alters (IPAsText, TCPPort) ActivityState (ReaderT Config (ResourceT m))
                   )
                => Config
                -> m ()
stratoP2PServer cfg = do
  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen
  runEthServer flags_listen cfg
