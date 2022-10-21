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
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import qualified Data.Conduit.Combinators              as DC
import           Data.Conduit.Network
import qualified Data.Set.Ordered                      as S
import qualified Data.Text                             as T
import qualified Network.Kafka                         as K
import qualified Text.Colors                           as C
import           Text.Format
import           Text.Printf
import           UnliftIO

import           BlockApps.Logging
import           Blockchain.Context
import           Blockchain.Data.Enode
import           Blockchain.Event                      (checkPeerIsMember)
import           Blockchain.EventException
import           Blockchain.Options
import           Blockchain.SeqEventNotify
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.TCPClientWithTimeout

import           Executable.StratoP2PClient            (runEthClientConduit)

stratoP2PClientDirect :: IORef (S.OSet Keccak256) -> LoggingT IO ()
stratoP2PClientDirect wireMessagesRef = forever $ do
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  runContextM cfg $ do
    let sSource = seqEventNotificationSource $ contextKafkaState initContext
    mkEthP2PSeqSource sSource
    liftIO $ threadDelay 500000


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
  P2pNewChainMember cId _ (Enode _ ip _ _) -> do
    $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack $ "Directly connecting to peer at " ++ showIP ip
    maybePeer <- getPeerByIP $ showIP ip
    case maybePeer of
      Just p -> do
        ender <- toIO . $logInfoS "stratoP2PClientDirect/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp p) ++ ":" ++ show (pPeerTcpPort p))
        void $ register ender

        otherPubKey <- case (pPeerPubkey p) of
          Nothing -> do
            $logInfoS "getPubKeyRunPeer" $ T.pack $ "Attempting to connect to " ++ pPeerString p ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
            eitherOtherPubKey <- getServerPubKey (T.unpack $ pPeerIp p) (fromIntegral $ pPeerTcpPort p)
            case eitherOtherPubKey of
              Right pub -> do
                $logInfoS "getPubKeyRunPeer" $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format pub
                return pub
              Left e -> do 
                $logErrorS "getPubKeyRunPeer" $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
                throwIO NoPeerPubKey
          Just pub -> return pub
        let peerPort = pPeerTcpPort p
            peerAddress = BC.pack . T.unpack $ pPeerIp p 
        runTCPClientWithConnectTimeout (clientSettings peerPort peerAddress) 5 $ \app -> do
          let pSource = appSource app
              pSink = appSink app
              sSource = seqEventNotificationSource $ contextKafkaState initContext
              pStr = pPeerString p
          uSink <- asks configUnseqSink
          attempt :: Maybe SomeException <- withActivePeer p $ do
            initState <- newIORef initContext
            local (\c -> c{configContext = initState}) $
              runEthClientConduit p{pPeerPubkey=Just otherPubKey} pSource pSink sSource uSink pStr
          case attempt of
            Nothing -> $logInfoS "stratoP2PClientDirect/handleEvents" "New chain member connected successfully!"
            Just err -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ "New chain member connection was unsuccessful." ++ show(err)
      Nothing -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ printf
                    "The peer with IP %s does not exist." $ show ip
  _ -> $logDebugS "stratoP2PClientDirect/handleEvents" "Skipping non-P2pNewChainMember events."

