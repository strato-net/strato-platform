{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE MonoLocalBinds      #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Executable.StratoP2PServer
  ( stratoP2PServer,
    runEthServerConduit,
  )
where

import           BlockApps.Logging
import           Blockchain.CommunicationConduit
import           Blockchain.Context                    hiding (Inbound,
                                                        Outbound)
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.Display                    (MsgDirection (..),
                                                        displayMessage)
import           Blockchain.EthEncryptionException
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.EthConf (ethConf, p2pConfig)
import qualified Blockchain.EthConf.Model as Conf
import           Blockchain.RLPx
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Host
import           Blockchain.Threads
import           Blockchain.TimerSource
import           Conduit
import           Control.Lens                          ((^.))
import           Control.Monad
import           Control.Monad.Composable.Vault
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                       as B
import qualified Data.Conduit.List                     as CL
import           Data.Default                          (def)
import           Data.Either.Combinators
import qualified Data.Text                             as T
import           Data.Time.Clock (NominalDiffTime)
import           GHC.IO.Exception
import qualified Text.Colors                           as C
import           Text.Read                             (readMaybe)
import           UnliftIO

runEthServer ::
  (RunsServer m, MonadP2P m) =>
  Int ->
  PeerRunner m () ->
  IO ()
runEthServer listenPort runner =
  runServer (TCPPort listenPort) runner $ \c a p ->
    ethServerHandler (c ^. peerSource) (c ^. peerSink) (c ^. seqSource) a p

ethServerHandler ::
  MonadP2P m =>
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  Host ->
  TCPPort ->
  m ()
ethServerHandler pSource pSink seqSrc host (TCPPort port) = do
  let peerStr = "<" ++ hostToString host
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow peerStr
  void $ register ender
  p <- getPeerByIP host >>= \case
    Nothing -> pure def{pPeerHost = host, pPeerIp = readMaybe (hostToString host), pPeerTcpPort = port}
    Just p -> pure p{pPeerTcpPort = port}
  updateTcpPort p $ TCPPort port
  (p', attempt) <- withActivePeer p $ runEthServerConduit p pSource pSink seqSrc peerStr
  case (,) <$> pPeerPubkey p' <*> attempt of
    Nothing  -> $logDebugS "runEthServer" "Peer ran successfully!"
    Just (pubkey, err) -> do
      $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err
      _ <- case err of
        e' | Just WrongGenesisBlock <- fromException e' -> do
          udpErr <- disableUDPPeerForSeconds p 86400
          whenLeft udpErr $ \theUDPErr -> do
            $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
          disErr <- storeDisableException p (T.pack "WrongGenesisBlock")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
          _ <- setPeerBondingState (pPeerHost p) pubkey 3 -- 3 indicates wrong genesis block/networkID
          logAndLengthenPeerDisableBy (24 * 60 * 60) p
        e' | Just HeadMacIncorrect <- fromException e' -> do
          disErr <- storeDisableException p (T.pack "HeadMacIncorrect")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
          logAndLengthenPeerDisableBy (fromIntegral $ 2 * Conf.connectionTimeout (p2pConfig ethConf)) p
        e' | Just NetworkIDMismatch <- fromException e' -> do
          udpErr <- disableUDPPeerForSeconds p 86400
          whenLeft udpErr $ \theUDPErr -> do
            $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
          disErr <- storeDisableException p (T.pack "NetworkIDMismatch")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
          _ <- setPeerBondingState (pPeerHost p) pubkey 3 -- 3 indicates wrong genesis block/networkID
          logAndLengthenPeerDisableBy (24 * 60 * 60) p
        e' | Just PeerDisconnected <- fromException e' -> do
          disErr <- storeDisableException p (T.pack "PeerDisconnected")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
          logAndLengthenPeerDisableBy (fromIntegral $ 2 * Conf.connectionTimeout (p2pConfig ethConf)) p
        e' | Just CurrentlyTooManyPeers <- fromException e' -> do
          disErr <- storeDisableException p (T.pack "CurrentlyTooManyPeers")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
          logAndLengthenPeerDisableBy (fromIntegral $ 2 * Conf.connectionTimeout (p2pConfig ethConf)) p
        e' | Just NoPeerCertificate <- fromException e' -> do
          disErr <- storeDisableException p (T.pack "NoPeerCertificate")
          whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/handleRunPeerResult" . T.pack $ "Unable to store disable exception: " ++ show err2
          udpErr <- disableUDPPeerForSeconds p 86400
          whenLeft udpErr $ \theUDPErr -> do
            $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
          logAndLengthenPeerDisableBy (24 * 60 * 60) p
        e' | Just (IOError _ ioErrType _ _ _ _) <- fromException e' -> do
          case ioErrType of
            NoSuchThing -> do
              udpErr <- disableUDPPeerForSeconds p 86400
              whenLeft udpErr $ \theUDPErr -> do
                $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
              disErr <- storeDisableException p (T.pack "TimeoutException")
              whenLeft disErr $ \err2 -> $logErrorS "stratoP2PClient/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
              logAndLengthenPeerDisableBy (fromIntegral $ 2 * Conf.connectionTimeout (p2pConfig ethConf)) p
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
  m (PPeer, Maybe SomeException)
runEthServerConduit p pSource pSink seqSrc peerStr = labelPeerThread peerStr "Peer Manager" (Just "CONNECTED") $ do
  myPubKey' <- getPub
  let myPubkey = secPubKeyToPoint myPubKey'
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptAccept `fuseUpstream` pSink
  case mConnectionResult of
    Nothing -> pure (p, Just $ toException $ HandshakeException "handshake timed out")
    Just (_, (otherPubKey, outCtx, inCtx)) -> do
      let p' = p{pPeerPubkey = Just otherPubKey}
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
        , labelPeerThread peerStr "Timer Source" Nothing timerSource
        ] `mergeConnect` (
        CL.iterM recordEvent
          .| labelPeerThread peerStr "P2P Handler" Nothing (handleMsgServerConduit myPubkey p')
          .| debounceTxSendsAndUnseq
          .| CL.iterM recordMessage
          .| CL.iterM (displayMessage Outbound peerStr)
          .| messageToBytes
          .| CL.iterM (recordTraffic Outbound)
          .| ethEncrypt outCtx
          .| pSink
        )

      case ret of
        Nothing -> changeLabelStatusM "DISCONNECTING"
        Just e  -> changeLabelStatusM $ "DISCONNECTING: " ++ show e

      return (p', ret)

stratoP2PServer ::
  (MonadP2P m, RunsServer m) =>
  PeerRunner m () ->
  IO ()
stratoP2PServer runner = labelTheThread "stratoP2PServer" . runner $ \_ -> do
  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen
  liftIO $ runEthServer flags_listen runner

logAndLengthenPeerDisableBy :: MonadP2P m => NominalDiffTime -> PPeer -> m (Either SomeException ())
logAndLengthenPeerDisableBy disableBy peer = do
  $logInfoS "logAndLengthenPeerDisableBy" $ T.pack $ "Disabling Peer " ++ show (pPeerHost peer) ++ ", exponential reset will occur in " ++ show disableBy ++ " seconds"
  lengthenPeerDisableBy disableBy peer

