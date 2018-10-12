{-# LANGUAGE BangPatterns          #-}
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
import           Control.Exception.Lifted
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Crypto.PubKey.ECC.DH
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import           Data.Conduit.Network
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import qualified Network.Haskoin.Internals             as H

import qualified Blockchain.Colors                     as C
import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.ECIES
import           Blockchain.EthConf                    hiding (genesisHash, port)
import           Blockchain.EthEncryptionException
import           Blockchain.EventException
import           Blockchain.Format
import           Blockchain.Options
import           Blockchain.Output                     (printLogMsg)
import           Blockchain.P2PRPC
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.TCPClientWithTimeout
import           Blockchain.TimerSource

runPeer :: (MonadUnliftIO m, MonadLogger m, MonadThrow m, MonadBaseControl IO m)
        => PPeer
        -> PrivateNumber
        -> BC.ByteString -- otherServiceCommHost
        -> CommPort      -- otherServiceCommPort
        -> m ()
runPeer peer myPriv _ _ = runResourceT $ do
  (cfg, ctx) <- initContext flags_maxReturnedHeaders
  let otherPubKey = fromMaybe (error "programmer error: runPeer was called without a pubkey") $ pPeerPubkey peer
      myPublic    = calculatePublic theCurve myPriv

  $logInfoS "runPeer" . T.pack . C.blue  $ "Welcome to strato-p2p-client"
  $logInfoS "runPeer" . T.pack . C.blue  $ "============================"
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey

  let peerPort    = pPeerTcpPort peer
      peerAddress = BC.pack . T.unpack $ pPeerIp peer

  runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> runContextM cfg ctx $ do
      void . liftIO $ setPeerActiveState (pPeerIp peer) (pPeerTcpPort peer) 1

      (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptConnect myPriv otherPubKey `fuseUpstream` appSink app

      !eventSource <- mkEthP2PEventSource app inCtx [timerSource]
      let !eventSink = mkEthP2PEventConduit (show $ appSockAddr app) outCtx
      (attempt :: Either SomeException ()) <- try . runConduit $
              eventSource
           .| handleMsgClientConduit myPublic peer
           .| eventSink
           .| appSink app

      void . liftIO $ setPeerActiveState (pPeerIp peer) (pPeerTcpPort peer) 0
      case attempt of
        Right () -> $logDebugS "runPeer" "Peer ran successfully!"
        Left err -> $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err

getPubKeyRunPeer :: (MonadUnliftIO m, MonadLogger m, MonadThrow m, MonadBaseControl IO m)
                 => PPeer
                 -> BC.ByteString
                 -> CommPort
                 -> m ()
getPubKeyRunPeer peer otherServiceCommHost otherServiceCommPort = do
  let PrivKey myPriv = privKey ethConf

  case (pPeerPubkey peer) of
    Nothing -> do
      $logInfoS "getPubKeyRunPeer" $ T.pack $ "Attempting to connect to " ++ pPeerString peer ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
      eitherOtherPubKey <- liftIO $ getServerPubKey (fromMaybe (error "invalid private number in main") $ H.makePrvKey $ fromIntegral myPriv) (T.unpack $ pPeerIp peer) (fromIntegral $ pPeerTcpPort peer)
      case eitherOtherPubKey of
            Right otherPubKey -> do
              $logInfoS "getPubKeyRunPeer" $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format otherPubKey
              runPeer peer{pPeerPubkey=Just otherPubKey} myPriv otherServiceCommHost otherServiceCommPort
            Left e -> $logInfoS "getPubKeyRunPeer" $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
    Just _ -> runPeer peer myPriv otherServiceCommHost otherServiceCommPort


runPeerInList :: (MonadUnliftIO m, MonadLogger m, MonadThrow m, MonadBaseControl IO m)
              => PPeer
              -> BC.ByteString
              -> CommPort
              -> m ()
runPeerInList thePeer otherServiceHost otherServicePort = do
  liftIO $ disablePeerForSeconds thePeer 10 --don't connect to a peer more than once per minute, out of politeness
  getPubKeyRunPeer thePeer otherServiceHost otherServicePort

stratoP2PClient :: LoggingT IO ()
stratoP2PClient = do
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn

  activePeersSem <- liftIO (SSem.new flags_maxConn)
  forever $ do
    $logDebugS "stratoP2PClient" "About to fetch available peers and loop over them"
    peers <- liftIO getAvailablePeers
    multiThreadedClient peers activePeersSem
    $logInfoS "stratoP2PClient" "Waiting 5 seconds before looping over peers again"
    liftIO $ threadDelay 5000000
    where
      multiThreadedClient :: [PPeer] -> SSem -> LoggingT IO ()
      multiThreadedClient [] _ = do
        $logInfoS "stratoP2PClient/multiThreadedClient" "No available peers, will try again in 10 seconds"
        liftIO $ threadDelay 10000000
      multiThreadedClient peers sem = liftIO . void . for peers $ \p -> do
        let isRunning = pPeerActiveState p == 1
        unless isRunning $ do
          (liftIO (SSem.tryWait sem)) >>= \case
            Nothing -> return ()
            Just _  -> void . forkIO . flip runLoggingT printLogMsg $ do
              result <- try $ runPeerInList p osch oscp
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
