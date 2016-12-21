{-# LANGUAGE FlexibleContexts, OverloadedStrings #-}

module Blockchain.UDPServer (
      runEthUDPServer,
      connectMe,
      udpHandshakeServer
     ) where

import Network.Socket
import qualified Network.Socket.ByteString as NB
import System.Timeout

import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import           Data.Time.Clock.POSIX
import           Data.Time.Clock
import qualified Data.Text as T

import System.Entropy
import System.Random

import qualified Blockchain.Colors as CL
import Blockchain.Data.PubKey
import Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.UDP
import           Blockchain.SHA
import           Blockchain.Data.Peer
import           Blockchain.DB.SQLDB
import           Blockchain.ContextLite
import           Blockchain.P2PUtil
import           Blockchain.PeerDB
                      
import qualified Network.Haskoin.Internals as H
    
runEthUDPServer::(MonadIO m, MonadThrow m, MonadBaseControl IO m, MonadLogger m)=>
                 ContextLite->H.PrvKey->Int->Socket->m ()
runEthUDPServer cxt myPriv portNum sock = do
  _ <- runResourceT $ flip runStateT cxt $ udpHandshakeServer myPriv sock portNum
  return ()

connectMe::(MonadIO m, MonadLogger m)=>
           Int->m Socket
connectMe port' = do
  (serveraddr:_) <- liftIO $ getAddrInfo
                                  (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
                                  Nothing (Just (show port'))
  sock <- liftIO $ socket (addrFamily serveraddr) Datagram defaultProtocol
  liftIO $ bindSocket sock (addrAddress serveraddr)
          
  return sock
         
addPeersIfNeeded::(MonadIO m, MonadLogger m)=>
                  H.PrvKey->Socket->m ()
addPeersIfNeeded prv sock= do
  numAvailablePeers <- liftIO getNumAvailablePeers
  when (numAvailablePeers < minAvailablePeers (discoveryConfig ethConf)) $ do
    bondedPeers <- liftIO getBondedPeers
    if length bondedPeers /= 0
      then do
        peerNumber <- liftIO $ randomRIO (0, length bondedPeers - 1)
        let thePeer = bondedPeers !! peerNumber
        (peeraddr:_) <- liftIO $ getAddrInfo Nothing (Just $ T.unpack $ pPeerIp thePeer) (Just $ show $ pPeerUdpPort thePeer)
        time <- liftIO $ round `fmap` getPOSIXTime
        randomBytes <- liftIO $ getEntropy 64
        sendPacket sock prv (addrAddress peeraddr) $ FindNeighbors (NodeID randomBytes) (time + 50)
      else logInfoN "no peers available to bootstrap from, will try again soon."

attemptBond::(MonadIO m, MonadLogger m)=>
                  H.PrvKey->Socket->Int->m ()
attemptBond prv sock portNum = do
  unbondedPeers <- liftIO getUnbondedPeers
  when (length unbondedPeers /= 0) $ 
    forM_ unbondedPeers $ \p -> do
      (peeraddr:_) <- liftIO $ getAddrInfo Nothing (Just $ T.unpack $ pPeerIp p) (Just $ show $ pPeerUdpPort p)
      time <- liftIO $ round `fmap` getPOSIXTime
      (serveraddr:_) <- liftIO $ getAddrInfo
                                  (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
                                  Nothing (Just (show portNum))
      sendPacket sock prv (addrAddress peeraddr) $ 
                Ping 4 
                   (Endpoint (getHostAddress $ addrAddress serveraddr) 30303 30303) 
                   (Endpoint (stringToIAddr $ T.unpack $ pPeerIp p)
                             (fromIntegral $ pPeerUdpPort p) 
                             (fromIntegral $ pPeerTcpPort p))
                   (time+50)
      liftIO $ setPeerBondingState (T.unpack $ pPeerIp p) (pPeerUdpPort p) 1

udpHandshakeServer::(HasSQLDB m, MonadResource m, MonadBaseControl IO m, MonadThrow m, MonadIO m, MonadLogger m)=>
                    H.PrvKey->Socket->Int->m ()
udpHandshakeServer prv sock portNum = do
  addPeersIfNeeded prv sock
  attemptBond prv sock portNum
  
  maybePacketData <- liftIO $ timeout 10000000 $ NB.recvFrom sock 1280  -- liftIO unavoidable?

  case maybePacketData of
   Nothing -> do
     logInfoN "timeout triggered"
   Just (msg,addr) -> do
     logInfoN $ T.pack $ "received bytes: len=" ++ (show $ B.length msg)
     let (packet, otherPubkey) = dataToPacket msg
     logInfoN "before the logInfoN line"
     logInfoN $ T.pack $ CL.cyan "<<<<" ++ " (" ++ show addr ++ " " ++ BC.unpack (B.take 10 $ B16.encode $ B.pack $ pointToBytes $ hPubKeyToPubKey otherPubkey) ++ "....) " ++ format (fst $ dataToPacket msg)
     logInfoN "after the logInfoN line"

     case packet of
      Ping _ _ _ _ -> do
                 let ip = sockAddrToIP addr
                 curTime <- liftIO $ getCurrentTime
                 let peer = PPeer {
                       pPeerPubkey = Just $ hPubKeyToPubKey $ otherPubkey,
                       pPeerIp = T.pack ip,
                       pPeerUdpPort = fromIntegral $ getAddrPort addr,
                       pPeerTcpPort = fromIntegral $ getAddrPort addr, --TODO- put correct TCP port in here
                       pPeerNumSessions = 0,
                       pPeerLastTotalDifficulty = 0,
                       pPeerLastMsg  = T.pack "msg",
                       pPeerLastMsgTime = curTime,
                       pPeerEnableTime = curTime,
                       pPeerLastBestBlockHash = SHA 0,
                       pPeerBondState = 0,
                       pPeerVersion = T.pack "61" -- fix
                       }
                 _ <- addPeer peer
        
                 time <- liftIO $ round `fmap` getPOSIXTime
                 peerAddr <- fmap IPV4Addr $ liftIO $ inet_addr "127.0.0.1"
                 sendPacket sock prv addr $ Pong (Endpoint peerAddr 30303 30303) 4 (time+50)

      Pong _ _ _ -> 
        liftIO $ setPeerBondingState (sockAddrToIP addr) (fromIntegral $ getAddrPort addr) 2

      FindNeighbors _ _ -> do
                 time <- liftIO $ round `fmap` getPOSIXTime
                 sendPacket sock prv addr $ Neighbors [] (time + 50)
                        
      Neighbors neighbors _ -> do
                 forM_ neighbors $ \(Neighbor (Endpoint addr' udpPort tcpPort) nodeID) -> do
                                curTime <- liftIO $ getCurrentTime
                                let peer = PPeer {
                                      pPeerPubkey = Just $ nodeIDToPoint nodeID,
                                      pPeerIp = T.pack $ format addr',
                                      pPeerUdpPort = fromIntegral udpPort,
                                      pPeerTcpPort = fromIntegral tcpPort,
                                      pPeerNumSessions = 0,
                                      pPeerLastTotalDifficulty = 0,
                                      pPeerLastMsg  = T.pack "msg",
                                      pPeerLastMsgTime = curTime,
                                      pPeerEnableTime = curTime,
                                      pPeerLastBestBlockHash = SHA 0,
                                      pPeerBondState = 0,
                                      pPeerVersion = T.pack "61" -- fix
                                      }
                                _ <- addPeer peer
                     
                                return ()



                 
  udpHandshakeServer prv sock portNum

getAddrPort::SockAddr->PortNumber
getAddrPort (SockAddrInet portNumber _) = portNumber
getAddrPort (SockAddrInet6 portNumber _ _ _) = portNumber
getAddrPort _ = error $ "getAddrPort called for address that doesn't have a port"
