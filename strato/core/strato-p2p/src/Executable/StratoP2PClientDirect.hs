{-# LANGUAGE BangPatterns         #-}
{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE TypeApplications     #-}
{-# LANGUAGE TypeOperators        #-}

module Executable.StratoP2PClientDirect
  ( stratoP2PClientDirect 
  ) where

import           Control.Concurrent                    hiding (yield)
import           Control.Monad.Change.Alter
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import qualified Data.Conduit.Combinators              as DC
import           Data.Conduit.Network
import           Data.Maybe
import qualified Data.Set.Ordered                      as S
import qualified Data.Text                             as T
import qualified Network.Kafka                         as K
import qualified Text.Colors                           as C
import           Text.Printf
import           UnliftIO

import           BlockApps.Logging
import           Blockchain.CommunicationConduit       
import           Blockchain.Context
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.Event                      (checkPeerIsMember)
import           Blockchain.EventModel
import           Blockchain.Options
import           Blockchain.RLPx
import           Blockchain.SeqEventNotify
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address       (formatAddressWithoutColor)
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.TCPClientWithTimeout

stratoP2PClientDirect :: IORef (S.OSet Keccak256) -> LoggingT IO ()
stratoP2PClientDirect wireMessagesRef = forever $ do
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  runContextM cfg $ do
    let sSource = seqEventNotificationSource $ contextKafkaState initContext
    mkEthP2PSeqSource sSource
    liftIO $ threadDelay 1000000


mkEthP2PSeqSource :: ( MonadP2P m
                     , MonadReader Config m
                     , Selectable String PPeer m
                     , ((T.Text, Int) `Alters` ActivityState) m
                     , Mod.Modifiable K.KafkaState m
                     )
                  => ConduitM () P2pEvent m ()
                  -> m ()
mkEthP2PSeqSource seqEventSource = do
  runConduit $ seqEventSource 
            .| DC.mapM_ (\e -> handleEvents e)

handleEvents :: ( MonadP2P m 
                , MonadReader Config m
                , Selectable String PPeer m
                , ((T.Text, Int) `Alters` ActivityState) m
                , Mod.Modifiable K.KafkaState m
                )
             => P2pEvent
             -> m ()
handleEvents ev = case ev of
  P2pNewChainMember cId addr _ -> do
    $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack $ "Directly connecting to peer at " ++ formatAddressWithoutColor addr
    myPublic' <- getPub
    let myPublic = secPubKeyToPoint myPublic'
    maybePeer <- getPeerByIP $ formatAddressWithoutColor addr
    case maybePeer of
      Just p -> do
        ender <- toIO . $logInfoS "stratoP2PClientDirect/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp p) ++ ":" ++ show (pPeerTcpPort p))
        void $ register ender

        mems <- selectWithDefault (Proxy @ChainMembers) cId
        when (checkPeerIsMember p mems) $ do
          let peerPort = pPeerTcpPort p
              peerAddress = BC.pack . T.unpack $ pPeerIp p 
          runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> do
            let pSource = appSource app
                pSink = appSink app
                pStr = pPeerString p
                theEvent = NewSeqEvent ev
            uSink <- asks configUnseqSink

            attempt :: Maybe SomeException <- withActivePeer p $ do
              initState <- newIORef initContext
              local (\c -> c{configContext = initState}) $
                runEthClientConduitDirect theEvent myPublic p pSource uSink pSink pStr
            case attempt of
              Nothing -> $logInfoS "stratoP2PClientDirect/handleEvents" "New chain member connected successfully!"
              Just err -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ "New chain member connection was unsuccessful." ++ show(err)
      Nothing -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ printf
                    "The peer with address %s does not exist." $ formatAddressWithoutColor addr
  _ -> $logDebugS "stratoP2PClientDirect/handleEvents" "Skipping non-P2pNewChainMember events."


runEthClientConduitDirect :: MonadP2P m 
                          => Event
                          -> Point
                          -> PPeer
                          -> ConduitM () B.ByteString m ()
                          -> ([IngestEvent] -> m ())
                          -> ConduitM B.ByteString Void m ()
                          -> String
                          -> m (Maybe SomeException)
runEthClientConduitDirect ev myPubKey peer peerSource unseqSink peerSink peerString = do
  let otherPubKey = fromMaybe (error "Peer pubkey not found for peer in new chain member event.") $ pPeerPubkey peer

  (_, (outCtx, _)) <- peerSource $$+ ethCryptConnect otherPubKey `fuseUpstream` peerSink
  !eventSink <- mkEthP2PEventConduit peerString outCtx unseqSink

  fmap (either Just (const Nothing)) . try . runConduit $ yield ev
                                                       .| handleMsgClientConduit myPubKey peer 
                                                       .| eventSink
                                                       .| peerSink
