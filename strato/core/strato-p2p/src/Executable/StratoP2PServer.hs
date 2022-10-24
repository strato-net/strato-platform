{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Executable.StratoP2PServer
  ( stratoP2PServer
  , runEthServerConduit
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.RLPx
import           Conduit
import           Control.Lens                          ((^.))
import           Control.Monad
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                       as B
import           Data.Maybe                            (fromMaybe)
import qualified Data.Text                             as T
import           Network.Socket
import           UnliftIO

import           BlockApps.Logging
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Options
import           Blockchain.P2PUtil
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Text.Colors                           as C

runEthServer :: (RunsServer n m, MonadP2P n)
             => Int
             -> PeerRunner n m ()
             -> m ()
runEthServer listenPort runner = runServerConnection (TCPPort listenPort) runner $ \c a ->
  ethServerHandler (c ^. peerSource) (c ^. peerSink) (c ^. seqSource) a

ethServerHandler :: MonadP2P m
                 => ConduitM () B.ByteString m ()
                 -> ConduitM B.ByteString Void m ()
                 -> ConduitM () P2pEvent m ()
                 -> SockAddr
                 -> m ()
ethServerHandler pSource pSink seqSrc sockAddr = do
  let theSockAddr = sockAddrToIP sockAddr
      peerStr = show theSockAddr
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow theSockAddr
  void $ register ender
  getPeerByIP theSockAddr >>= \case
    Nothing -> do
      $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ peerStr ++ ". rejecting violently."
    Just p -> do
      case pPeerPubkey p of
        Nothing -> do
          $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ peerStr  ++ ". rejecting violently."
        Just _ -> do
          (attempt :: Maybe SomeException) <- withActivePeer p $
            runEthServerConduit p pSource pSink seqSrc peerStr
          case attempt of
            Nothing -> $logDebugS "runEthServer" "Peer ran successfully!"
            Just err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthServerConduit :: MonadP2P m
                    => PPeer
                    -> ConduitM () B.ByteString m ()
                    -> ConduitM B.ByteString Void m ()
                    -> ConduitM () P2pEvent m ()
                    -> String
                    -> m (Maybe SomeException)
runEthServerConduit p pSource pSink seqSrc peerStr = do
  myPubKey' <- getPub
  
  let myPubkey = secPubKeyToPoint myPubKey'
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  (_, (outCtx, inCtx)) <- pSource $$+ ethCryptAccept otherPubKey `fuseUpstream` pSink
  
  !eventSource <- mkEthP2PEventSource pSource seqSrc peerStr inCtx
  !eventSink <- mkEthP2PEventConduit peerStr outCtx
  fmap (either Just (const Nothing)) . try . runConduit $ eventSource
                  .| handleMsgServerConduit myPubkey p
                  .| eventSink
                  .| pSink

stratoP2PServer :: (MonadP2P n, RunsServer n (LoggingT IO))
                => PeerRunner n (LoggingT IO) () -> LoggingT IO ()
stratoP2PServer runner = do

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen

  runEthServer flags_listen runner
