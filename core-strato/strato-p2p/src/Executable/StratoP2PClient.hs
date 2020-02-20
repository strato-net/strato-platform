{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PatternGuards         #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}

module Executable.StratoP2PClient (stratoP2PClient) where

import           Blockchain.RLPx
import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.SSem               (SSem)
import qualified Control.Concurrent.SSem               as SSem
import           Control.Exception.Base                (ErrorCall(..))
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Crypto.PubKey.ECC.DH
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import           Data.Conduit.Lift
import           Data.Conduit.Network
import           Data.Either.Combinators
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import qualified Network.Haskoin.Internals             as H
import           UnliftIO.Exception

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.ECIES
import           Blockchain.EthConf                    hiding (genesisHash, port)
import           Blockchain.EthEncryptionException
import           Blockchain.EventException
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.Output
import           Blockchain.P2PRPC
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.TCPClientWithTimeout

import qualified Text.Colors                           as C
import           Text.Format

runPeer :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
        => PPeer
        -> PrivateNumber
        -> BC.ByteString -- otherServiceCommHost
        -> CommPort      -- otherServiceCommPort
        -> m ()
runPeer peer myPriv _ _ = runResourceT $ do
  ender <- toIO . $logInfoS "runPeer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  void $ register ender
  (cfg, initState) <- initContext flags_maxReturnedHeaders
  runContextM cfg $ do
    let otherPubKey = fromMaybe (error "programmer error: runPeer was called without a pubkey") $ pPeerPubkey peer
        myPublic    = calculatePublic theCurve myPriv

    $logInfoS "runPeer" . T.pack . C.blue  $ "Welcome to strato-p2p-client"
    $logInfoS "runPeer" . T.pack . C.blue  $ "============================"
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey
    let peerPort    = pPeerTcpPort peer
        peerAddress = BC.pack . T.unpack $ pPeerIp peer
    runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> do
        void . liftIO $ setPeerActiveState (pPeerIp peer) peerPort Active

        (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptConnect myPriv otherPubKey `fuseUpstream` appSink app

        !eventSource <- mkEthP2PEventSource app inCtx (contextKafkaState initState)
        !eventSink <- mkEthP2PEventConduit (show $ appSockAddr app) outCtx
        attempt :: Either SomeException () <- try . runConduit . evalStateLC initState $
                  transPipe lift eventSource
               .| handleMsgClientConduit myPublic peer
               .| transPipe lift eventSink
               .| appSink app

        void . liftIO $ setPeerActiveState (pPeerIp peer) (pPeerTcpPort peer) Unactive
        case attempt of
          Right () -> $logDebugS "runPeer" "Peer ran successfully!"
          Left err -> $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err

getPubKeyRunPeer :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
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


runPeerInList :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
              => PPeer
              -> BC.ByteString
              -> CommPort
              -> m ()
runPeerInList thePeer otherServiceHost otherServicePort = do
  eErr <- liftIO $ nonviolentDisable thePeer --don't connect to a peer too frequently, out of politeness
  whenLeft eErr $ \err -> do
      $logErrorS "runPeerInList" . T.pack $ "Unable to disable peer:" ++ show err
      $logErrorS "runPeerInList" "Simulating disable..."
      liftIO $ threadDelay $ 10 * 1000 * 1000
  getPubKeyRunPeer thePeer otherServiceHost otherServicePort

stratoP2PClient :: LoggingT IO ()
stratoP2PClient = do
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn

  activePeersSem <- liftIO (SSem.new flags_maxConn)
  forever $ do
    $logDebugS "stratoP2PClient" "About to fetch available peers and loop over them"
    ePeers <- liftIO getAvailablePeers
    case ePeers of
      Left err -> do
        $logErrorS "stratoP2PClient" . T.pack $ "Could not fetch peers: " ++ show err
        liftIO $ threadDelay 1000000
      Right peers -> do
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
            Just _  -> void . forkIO . runLoggingT $ do
              result <- try $ runPeerInList p osch oscp
              liftIO (SSem.signal sem)
              handleRunPeerResult p result

      handleRunPeerResult :: (MonadLogger m, MonadIO m) => PPeer -> Either SomeException a -> m ()
      handleRunPeerResult thePeer = \case
        Left e | Just (ErrorCall x) <- fromException e -> error x
        Left e -> do
          $logInfoS "stratoP2PClient/handleRunPeerResult" $ T.pack $ "Connection ended: " ++ show (e :: SomeException)
          recordException thePeer e
          eErr <- liftIO $ case e of
                   e' | Just TimeoutException  <- fromException e' -> lengthenPeerDisable thePeer
                   e' | Just WrongGenesisBlock <- fromException e' -> lengthenPeerDisable thePeer
                   e' | Just HeadMacIncorrect  <- fromException e' -> lengthenPeerDisable thePeer
                   _  -> return $ Right ()
          whenLeft eErr $ \err -> do
            $logErrorLS "stratoP2PClient/handleRunPeerResult" err

        Right _ -> return ()

      osch = "localhost"
      oscp = serverCommPort
