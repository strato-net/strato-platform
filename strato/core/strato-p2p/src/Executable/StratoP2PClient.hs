{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PatternGuards         #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}

module Executable.StratoP2PClient
  ( stratoP2PClient
  , runEthClientConduit
  ) where

import           Blockchain.RLPx
import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.SSem               (SSem)
import qualified Control.Concurrent.SSem               as SSem
import           Control.Exception.Base                (ErrorCall(..))
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import           Data.Conduit.Network
import           Data.Either.Combinators
import           Data.Maybe
import qualified Data.Set.Ordered                      as S
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import           UnliftIO

import           BlockApps.Logging
import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.EthEncryptionException
import           Blockchain.EventException
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.P2PRPC
import           Blockchain.SeqEventNotify
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.TCPClientWithTimeout

import qualified Text.Colors                           as C
import           Text.Format

runPeer :: (MonadIO m, MonadLogger m, MonadUnliftIO m, MonadResource m)
        => IORef (S.OSet Keccak256)
        -> PPeer
        -> BC.ByteString -- otherServiceCommHost
        -> CommPort      -- otherServiceCommPort
        -> m ()
runPeer wireMessagesRef peer _ _ = do
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  runContextM cfg $ do
    ender <- toIO . $logInfoS "runPeer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
    void $ register ender

    myPublic <- getPub
    
    otherPubKey <- case (pPeerPubkey peer) of
      Nothing -> do
        $logInfoS "getPubKeyRunPeer" $ T.pack $ "Attempting to connect to " ++ pPeerString peer ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
        eitherOtherPubKey <- getServerPubKey (T.unpack $ pPeerIp peer) (fromIntegral $ pPeerTcpPort peer)
        case eitherOtherPubKey of
          Right pub -> do
            $logInfoS "getPubKeyRunPeer" $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format pub
            return pub
          Left e -> do 
            $logErrorS "getPubKeyRunPeer" $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
            throwIO NoPeerPubKey
      Just pub -> return pub

    $logInfoS "runPeer" . T.pack . C.blue  $ "Welcome to strato-p2p-client"
    $logInfoS "runPeer" . T.pack . C.blue  $ "============================"
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
    $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey
    let peerPort    = pPeerTcpPort peer
        peerAddress = BC.pack . T.unpack $ pPeerIp peer
    runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> do
      let pSource = appSource app
          pSink = appSink app
          sSource = seqEventNotificationSource $ contextKafkaState initContext
          pStr = pPeerString peer -- display string will show up as dns name
          --pStr = show $ appSockAddr app -- display string will show up as IP address
      uSink <- asks configUnseqSink
      attempt :: Maybe SomeException <- withActivePeer peer $ do
        initState <- newIORef initContext
        local (\c -> c{configContext = initState}) $
          runEthClientConduit peer{pPeerPubkey=Just otherPubKey} pSource pSink sSource uSink pStr
      case attempt of
        Nothing -> $logDebugS "runPeer" "Peer ran successfully!"
        Just err -> $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthClientConduit :: MonadP2P m
                    => PPeer
                    -> ConduitM () B.ByteString m ()
                    -> ConduitM B.ByteString Void m ()
                    -> ConduitM () P2pEvent m ()
                    -> ([IngestEvent] -> m ())
                    -> String
                    -> m (Maybe SomeException)
runEthClientConduit peer peerSource peerSink seqSource unseqSink peerStr = do
  myPublic' <- getPub

  let myPublic = secPubKeyToPoint myPublic'
      otherPubKey = fromMaybe (error "programmer error: runEthClientConduit was called without a pubkey") $ pPeerPubkey peer
  (_, (outCtx, inCtx)) <- peerSource $$+ ethCryptConnect otherPubKey `fuseUpstream` peerSink

  !eventSource <- mkEthP2PEventSource peerSource seqSource peerStr inCtx
  !eventSink <- mkEthP2PEventConduit peerStr outCtx unseqSink
  fmap (either Just (const Nothing)) . try . runConduit $ eventSource
                  .| handleMsgClientConduit myPublic peer
                  .| eventSink
                  .| peerSink


runPeerInList :: (MonadIO m, MonadLogger m, MonadUnliftIO m, MonadResource m)
              => IORef (S.OSet Keccak256)
              -> PPeer
              -> BC.ByteString
              -> CommPort
              -> m ()
runPeerInList wireMessagesRef thePeer otherServiceHost otherServicePort = do
  eErr <- liftIO $ nonviolentDisable thePeer --don't connect to a peer too frequently, out of politeness
  whenLeft eErr $ \err -> do
      $logErrorS "runPeerInList" . T.pack $ "Unable to disable peer:" ++ show err
      $logErrorS "runPeerInList" "Simulating disable..."
      liftIO $ threadDelay $ 10 * 1000 * 1000
  runPeer wireMessagesRef thePeer otherServiceHost otherServicePort

stratoP2PClient :: IORef (S.OSet Keccak256) -> LoggingT IO ()
stratoP2PClient wireMessagesRef = do
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
            Just _  -> void . forkIO . runLoggingT . runResourceT $ do
              result <- try $ runPeerInList wireMessagesRef p osch oscp
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
