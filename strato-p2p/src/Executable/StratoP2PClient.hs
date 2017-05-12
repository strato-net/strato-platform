{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PatternGuards         #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}

module Executable.StratoP2PClient (stratoP2PClient) where

import           Blockchain.PrivateKeyConf
import           Blockchain.RLPx
import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.SSem               (SSem)
import qualified Control.Concurrent.SSem               as SSem
import           Control.Concurrent.STM.MonadIO
import           Control.Concurrent.STM.TVar           (readTVarIO)
import           Control.Exception.Lifted
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Crypto.PubKey.ECC.DH
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import           Data.Conduit.Network
import           Data.Maybe
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import qualified Network.Haskoin.Internals             as H
import           System.Random

import qualified Blockchain.Colors                     as C
import           Blockchain.CommunicationConduit
import           Blockchain.ContextLite
import           Blockchain.ECIES
import           Blockchain.EthConf                    hiding (genesisHash, port)
import           Blockchain.EthEncryptionException
import           Blockchain.EventException
import           Blockchain.Format
import           Blockchain.Options
import           Blockchain.Output                     (printLogMsg')
import           Blockchain.P2PRPC
import           Blockchain.P2PUtil
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.TCPClientWithTimeout

runPeer :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)
        => TVar (S.Set ConnectedPeer)
        -> PPeer
        -> PrivateNumber
        -> BC.ByteString -- otherServiceCommHost
        -> CommPort      -- otherServiceCommPort
        -> m ()
runPeer connectedPeers peer myPriv _ _ = runResourceT $ do
  ctx <- initContextLite
  runEthCryptMLite ctx $ do
    let otherPubKey = fromMaybe (error "programmer error- runPeer was called without a pubkey") $ pPeerPubkey peer
        myPublic    = calculatePublic theCurve myPriv

    $logInfoS "runPeer" $ T.pack $ C.blue "Welcome to strato-p2p-client"
    $logInfoS "runPeer" $ T.pack $ C.blue "============================"
    $logInfoS "runPeer" $ T.pack $ C.blue "now on steroids too "
    $logInfoS "runPeer" $ T.pack $ C.green " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
    $logInfoS "runPeer" $ T.pack $ C.green " * " ++ "my pubkey is: " ++ format myPublic
    $logInfoS "runPeer" $ T.pack $ C.green " * " ++ "server pubkey is : " ++ format otherPubKey

    let peerPort    = pPeerTcpPort peer
        peerAddress = BC.pack . T.unpack $ pPeerIp peer

    runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> do
        let cp = ConnectedPeer peer
        void $ modifyTVar connectedPeers $ S.insert cp

        (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptConnect myPriv otherPubKey `fuseUpstream` appSink app

        eventSource <- mkEthP2PEventSource app inCtx
        (_ :: Either SomeException ()) <- try $ eventSource
                       =$= handleMsgClientConduit myPublic peer
                       =$= mkEthP2PEventConduit app outCtx
                        $$ appSink app
        void $ modifyTVar connectedPeers (S.delete cp)

getPubKeyRunPeer :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)
                 => TVar (S.Set ConnectedPeer)
                 -> PPeer
                 -> BC.ByteString
                 -> CommPort
                 -> m ()
getPubKeyRunPeer connectedPeers peer otherServiceCommHost otherServiceCommPort = do
  let PrivKey myPriv = privKey ethConf

  case (pPeerPubkey peer) of
    Nothing -> do
      $logInfoS "getPubKeyRunPeer" $ T.pack $ "Attempting to connect to " ++ pPeerString peer ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
      eitherOtherPubKey <- liftIO $ getServerPubKey (fromMaybe (error "invalid private number in main") $ H.makePrvKey $ fromIntegral myPriv) (T.unpack $ pPeerIp peer) (fromIntegral $ pPeerTcpPort peer)
      case eitherOtherPubKey of
            Right otherPubKey -> do
              $logInfoS "getPubKeyRunPeer" $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format otherPubKey
              runPeer connectedPeers peer{pPeerPubkey=Just otherPubKey} myPriv otherServiceCommHost otherServiceCommPort
            Left e -> $logInfoS "getPubKeyRunPeer" $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
    Just _ -> runPeer connectedPeers peer myPriv otherServiceCommHost otherServiceCommPort


runPeerInList :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)
              => TVar (S.Set ConnectedPeer)
              -> PPeer
              -> BC.ByteString
              -> CommPort
              -> m ()
runPeerInList connectedPeers thePeer otherServiceHost otherServicePort = do
  liftIO $ disablePeerForSeconds thePeer 60 --don't connect to a peer more than once per minute, out of politeness
  getPubKeyRunPeer connectedPeers thePeer otherServiceHost otherServicePort

stratoP2PClient :: LoggingT IO ()
stratoP2PClient = do
  connectedPeers <- newTVar S.empty

  $logInfoS "stratoP2PClient" $ T.pack $ "clientCommPort: " ++ show clientCommPort
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn

  _ <- liftIO . forkIO $ runStratoP2PComm clientCommPort connectedPeers

  activePeersSem <- liftIO (SSem.new flags_maxConn)
  forever $ do
    peers <- filterM notAlreadyConnected =<< liftIO getAvailablePeers
    case flags_mode of
      SingleThreaded -> singleThreadedClient connectedPeers peers
      MultiThreaded  -> do
        multiThreadedClient connectedPeers peers activePeersSem
        $logInfoS "stratoP2PClient" "Waiting 15 seconds before looping over peers again"
        liftIO $ threadDelay 50000000

  where singleThreadedClient :: TVar (S.Set ConnectedPeer) -> [PPeer] -> LoggingT IO ()
        singleThreadedClient _  [] = do
          $logInfoS "stratoP2PClient/singleThreadedClient" "No available peers, will try again in 10 seconds"
          liftIO $ threadDelay 10000000
        singleThreadedClient connectedPeers peers = do
          peerNumber <- liftIO $ randomRIO (0, length peers - 1)
          let thePeer = peers !! peerNumber
          try (runPeerInList connectedPeers thePeer osch oscp) >>= handleRunPeerResult thePeer

        multiThreadedClient :: TVar (S.Set ConnectedPeer) -> [PPeer] -> SSem -> LoggingT IO ()
        multiThreadedClient connectedPeers peers sem = liftIO . void . for peers $ \p -> do
          isRunning <- ((ConnectedPeer p) `S.member`) <$> readTVarIO connectedPeers
          unless isRunning $ do
            (liftIO (SSem.tryWait sem)) >>= \case
              Nothing -> return ()
              Just _  -> void . forkIO . flip runLoggingT (printLogMsg' True True) $ do
                result <- try $ runPeerInList connectedPeers p osch oscp
                liftIO (SSem.signal sem)
                handleRunPeerResult p result

        disablePeerForHours :: MonadIO m => PPeer -> Int -> m ()
        disablePeerForHours thePeer = liftIO . disablePeerForSeconds thePeer . (60*60*)

        handleRunPeerResult :: (MonadLogger m, MonadIO m) => PPeer -> Either SomeException a -> m ()
        handleRunPeerResult thePeer = \case
          Left e | Just (ErrorCall x) <- fromException e -> error x
          Left e -> do
            $logInfoS "stratoP2PClient/handleRunPeerResult" $ T.pack $ "Connection ended: " ++ show (e :: SomeException)
            case e of
             e' | Just TimeoutException  <- fromException e' -> disablePeerForHours thePeer 4
             e' | Just WrongGenesisBlock <- fromException e' -> disablePeerForHours thePeer (24*7)
             e' | Just HeadMacIncorrect  <- fromException e' -> disablePeerForHours thePeer 24
             _  -> return ()
          Right _ -> return ()

        osch = "localhost"
        oscp = serverCommPort

        notAlreadyConnected :: (MonadLogger m, MonadIO m) => PPeer -> m Bool
        notAlreadyConnected PPeer{..} = isAlreadyConnected osch oscp (T.unpack pPeerIp) >>= \case
            Left err -> do
              $logInfoS "notAlreadyConnected" . T.pack $ "Failed to check if peer is already connected, pretending it is: " ++ show err
              return False
            Right theTruth -> return (not theTruth)
