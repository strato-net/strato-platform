{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PatternGuards         #-}
{-# LANGUAGE RankNTypes            #-}
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
import           Control.Lens                          ((^.))
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                       as B
import           Data.Conduit
import           Data.Either.Combinators
import           Data.Maybe
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
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.TCPClientWithTimeout

import qualified Text.Colors                           as C
import           Text.Format

runPeer :: (RunsClient m, MonadP2P m)
        => PPeer
        -> ConduitM () P2pEvent m ()
        -> m ()
runPeer peer sSource = do
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

  $logInfoS "runPeer" . T.pack . C.blue  $ "Welcome to strato-p2p-client"
  $logInfoS "runPeer" . T.pack . C.blue  $ "============================"
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
  $logInfoS "runPeer" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey
  runClientConnection (IPAsText $ pPeerIp peer) (TCPPort . fromIntegral $ pPeerTcpPort peer) sSource $ \c -> do
    let pStr = pPeerString peer -- display string will show up as dns name
    attempt :: Maybe SomeException <- withActivePeer peer $
      runEthClientConduit peer{pPeerPubkey=Just otherPubKey}
                          (c ^. peerSource)
                          (c ^. peerSink)
                          (c ^. seqSource)
                          pStr
    case attempt of
      Nothing -> $logDebugS "runPeer" "Peer ran successfully!"
      Just err -> $logErrorS "runPeer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthClientConduit :: MonadP2P m
                    => PPeer
                    -> ConduitM () B.ByteString m ()
                    -> ConduitM B.ByteString Void m ()
                    -> ConduitM () P2pEvent m ()
                    -> String
                    -> m (Maybe SomeException)
runEthClientConduit peer pSource pSink seqSrc peerStr = do
  myPublic' <- getPub

  let myPublic = secPubKeyToPoint myPublic'
      otherPubKey = fromMaybe (error "programmer error: runEthClientConduit was called without a pubkey") $ pPeerPubkey peer
  (_, (outCtx, inCtx)) <- pSource $$+ ethCryptConnect otherPubKey `fuseUpstream` pSink

  !eventSource <- mkEthP2PEventSource pSource seqSrc peerStr inCtx
  !eventSink <- mkEthP2PEventConduit peerStr outCtx 
  fmap (either Just (const Nothing)) . try . runConduit $ eventSource
                  .| handleMsgClientConduit myPublic peer
                  .| eventSink
                  .| pSink


runPeerInList :: ( MonadIO m
                 , MonadUnliftIO m
                 , MonadP2P m
                 , RunsClient m
                 )
              => PPeer
              -> ConduitM () P2pEvent m ()
              -> m ()
runPeerInList thePeer sSource = do
  eErr <- nonviolentDisable thePeer --don't connect to a peer too frequently, out of politeness
  whenLeft eErr $ \err -> do
      $logErrorS "runPeerInList" . T.pack $ "Unable to disable peer:" ++ show err
      $logErrorS "runPeerInList" "Simulating disable..."
      liftIO $ threadDelay $ 10 * 1000 * 1000
  runPeer thePeer sSource

stratoP2PClient :: (MonadP2P m, RunsClient m) => PeerRunner m (LoggingT IO) () -> LoggingT IO ()
stratoP2PClient runner = runner $ \_ -> do
  $logInfoS "stratoP2PClient" $ T.pack $ "maxConn: " ++ show flags_maxConn

  activePeersSem <- liftIO (SSem.new flags_maxConn)
  forever $ do
    $logDebugS "stratoP2PClient" "About to fetch available peers and loop over them"
    ePeers <- getAvailablePeers
    case ePeers of
      Left err -> do
        $logErrorS "stratoP2PClient" . T.pack $ "Could not fetch peers: " ++ show err
        liftIO $ threadDelay 1000000
      Right peers -> do
        multiThreadedClient peers activePeersSem cfg
        $logInfoS "stratoP2PClient" "Waiting 5 seconds before looping over peers again"
        liftIO $ threadDelay 5000000
    where
      multiThreadedClient :: MonadP2P m => [PPeer] -> SSem -> m ()
      multiThreadedClient [] _ = do
        $logInfoS "stratoP2PClient/multiThreadedClient" "No available peers, will try again in 10 seconds"
        liftIO $ threadDelay 10000000
      multiThreadedClient peers sem = void . for peers $ \p -> do
        let isRunning = pPeerActiveState p == 1
        unless isRunning $ do
          (liftIO (SSem.tryWait sem)) >>= \case
            Nothing -> return ()
            Just _  -> void . liftIO . forkIO . runLoggingT . runner $ \sSource -> do
              result <- try $ runPeerInList p sSource
              liftIO (SSem.signal sem)
              handleRunPeerResult p result

      handleRunPeerResult :: MonadP2P m => PPeer -> Either SomeException a -> m ()
      handleRunPeerResult thePeer = \case
        Left e | Just (ErrorCall x) <- fromException e -> error x
        Left e -> do
          $logInfoS "stratoP2PClient/handleRunPeerResult" $ T.pack $ "Connection ended: " ++ show (e :: SomeException)
          recordException thePeer e
          eErr <- case e of
                   e' | Just TimeoutException  <- fromException e' -> lengthenPeerDisable thePeer
                   e' | Just WrongGenesisBlock <- fromException e' -> lengthenPeerDisable thePeer
                   e' | Just HeadMacIncorrect  <- fromException e' -> lengthenPeerDisable thePeer
                   _  -> return $ Right ()
          whenLeft eErr $ \err -> do
            $logErrorLS "stratoP2PClient/handleRunPeerResult" err

        Right _ -> return ()