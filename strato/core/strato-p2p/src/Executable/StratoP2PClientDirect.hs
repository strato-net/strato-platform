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

import           Control.Concurrent
import           Control.Lens                          ((^.))
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Data.Conduit
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import qualified Text.Colors                           as C
import           Text.Format
import           UnliftIO

import           BlockApps.Logging
import           Blockchain.Context
import           Blockchain.Event                      (checkPeerIsMember)
import           Blockchain.EventException
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Secp256k1     (getPub)

import           Executable.StratoP2PClient            (runEthClientConduit)

stratoP2PClientDirect :: ( MonadP2P m 
                         , RunsClient m
                         ) 
                      => PeerRunner m (LoggingT IO) () 
                      -> LoggingT IO ()
stratoP2PClientDirect runner = runner $ \sSource -> forever $ do
    runConduit $ sSource
              .| (awaitForever $ \e -> lift $ handleEvents e sSource runner)

handleEvents :: ( MonadP2P m 
                , RunsClient m
                )
             => P2pEvent
             -> ConduitM () P2pEvent m ()
             -> PeerRunner m (LoggingT IO) () 
             -> m ()
handleEvents ev sSource runner = do
  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack $ show ev
  case ev of
    P2pNewOrgName cId org -> do
      peers <- getPeersByParsedSets org
      $logDebugS "stratoP2PClientDirect/handleEvents" . T.pack $ show peers
      void . for peers $ \p -> do
        void . liftIO . forkIO . runLoggingT . runner $ \_ -> do
          runPeer p

      where
        runPeer thePeer = do
          case thePeer of
            Just peer -> do
              ender <- toIO . $logInfoS "stratoP2PClientDirect/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
              void $ register ender

              let isRunning = pPeerActiveState peer == 1

              $logDebugS "stratoP2PClientDirect/handleEvents/isRunning" . T.pack $ show isRunning

              if isRunning then do
                $logInfoS "stratoP2PClientDirect/handleEvents" "Peer is already active. Skipping direct connection."
              else do 
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

                peerX509 <- getPeerX509 peer
                orgChains <- selectWithDefault (Proxy @ChainMemberRSet) cId
                let peerCheck = checkPeerIsMember peerX509 orgChains

                $logDebugS "stratoP2PClientDirect/handleEvents" . T.pack . C.red $ show peerCheck
                
                if peerCheck then do
                  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack . C.blue  $ "Welcome to strato-p2p-client-DIRECT"
                  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack . C.blue  $ "============================"
                  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack . C.green $ " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))
                  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack . C.green $ " * " ++ "my pubkey is: " ++ format myPublic
                  $logInfoS "stratoP2PClientDirect/handleEvents" . T.pack . C.green $ " * " ++ "server pubkey is: " ++ format otherPubKey
                  runClientConnection (IPAsText $ pPeerIp peer) (TCPPort . fromIntegral $ pPeerTcpPort peer) sSource $ \c -> do
                    let pStr = pPeerString peer -- display string will show up as dns name
                    attempt :: Maybe SomeException <- withActivePeer peer $
                      runEthClientConduit peer{pPeerPubkey=Just otherPubKey}
                                          (c ^. peerSource)
                                          (c ^. peerSink)
                                          (c ^. seqSource)
                                          pStr
                    case attempt of
                      Nothing -> $logInfoS "stratoP2PClientDirect/handleEvents" "New chain member connected successfully!"
                      Just err -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ "New chain member connection was unsuccessful." ++ show(err)
                else $logInfoS "stratoP2PClientDirect/handleEvents" "Peer is not a member of the chain."
            Nothing -> $logErrorS "stratoP2PClientDirect/handleEvents" . T.pack $ "Peer/Peers doesn't exist."
    _ -> $logInfoS "stratoP2PClientDirect/handleEvents" "Skipping non-relevant events."

