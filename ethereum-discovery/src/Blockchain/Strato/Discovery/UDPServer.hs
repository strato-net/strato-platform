{-# LANGUAGE FlexibleContexts, OverloadedStrings, ScopedTypeVariables #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.UDPServer (
      runEthUDPServer,
      connectMe,
      udpHandshakeServer
     ) where

import Network.Socket
import qualified Network.Socket.ByteString as NB
import System.Timeout
import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Crypto.Types.PubKey.ECC as ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import           Data.Monoid
import           Data.Time.Clock.POSIX
import qualified Data.Text as T

import System.Entropy
import System.Random

import Blockchain.Data.PubKey
import qualified Blockchain.Colors as CL
import           Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.DB.SQLDB
import           Blockchain.SHA
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.P2PUtil
import           Blockchain.Strato.Discovery.PeerDB

import qualified Network.Haskoin.Internals as H

runEthUDPServer::(MonadIO m, MonadCatch m, MonadThrow m, MonadBaseControl IO m, MonadLogger m)=>
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
  logInfoN . T.pack $ "Number of available peers: " ++ show numAvailablePeers
  when (numAvailablePeers < minAvailablePeers (discoveryConfig ethConf)) $ do
    bondedPeers <- liftIO getBondedPeersForUDP
    if length bondedPeers /= 0
      then do
        peerNumber <- liftIO $ randomRIO (0, length bondedPeers - 1)
        let thePeer = bondedPeers !! peerNumber
        (peeraddr:_) <- liftIO $ getAddrInfo Nothing (Just $ T.unpack $ pPeerIp thePeer) (Just $ show $ pPeerUdpPort thePeer)
        time <- liftIO $ round `fmap` getPOSIXTime
        randomBytes <- liftIO $ getEntropy 64
        sendPacket sock prv (addrAddress peeraddr) $ FindNeighbors (NodeID randomBytes) (time + 50)
        liftIO $ disableUDPPeerForSeconds thePeer 10
      else logInfoN "no peers available to bootstrap from, will try again soon."

attemptBond :: (MonadIO m, MonadLogger m)
            => H.PrvKey
            -> Socket
            -> Int
            -> m ()
attemptBond prv sock portNum = do
  unbondedPeers <- liftIO getUnbondedPeers
  when (length unbondedPeers /= 0) $
    forM_ unbondedPeers $ \p -> do
      (peeraddr : _) <- liftIO $ getAddrInfo
                                   Nothing
                                   (Just $ T.unpack $ pPeerIp p)
                                   (Just $ show $ pPeerUdpPort p)
      time <- liftIO $ round `fmap` getPOSIXTime
      (serveraddr : _) <- liftIO $ getAddrInfo
                                    (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
                                    Nothing
                                    (Just (show portNum))
      ehostAddress <- return $ getHostAddress $ addrAddress serveraddr
      case ehostAddress of
        Left err -> logInfoN $ T.pack . show $ err
        Right hostAddress -> do
          sendPacket sock prv (addrAddress peeraddr) $
                Ping 4
                   (Endpoint hostAddress 30303 30303)
                   (Endpoint (stringToIAddr $ T.unpack $ pPeerIp p)
                             (fromIntegral $ pPeerUdpPort p)
                             (fromIntegral $ pPeerTcpPort p))
                   (time+50)
          liftIO $ setPeerBondingState (T.unpack $ pPeerIp p) (pPeerUdpPort p) 1

udpHandshakeServer :: (HasSQLDB m,
                       MonadResource m,
                       MonadBaseControl IO m,
                       MonadCatch m,
                       MonadThrow m,
                       MonadLogger m)
                   => H.PrvKey
                   -> Socket
                   -> Int
                   -> m ()
udpHandshakeServer prv sock portNum = do
    _ <- addPeersIfNeeded prv sock
    _ <- attemptBond prv sock portNum
    maybePacketData <- liftIO $ timeout 10000000 $ NB.recvFrom sock 1280
    _ <- case maybePacketData of
      Nothing -> logInfoN "timeout triggered"
      Just (msg, addr) -> do
        _ <- logInfoN $ T.pack $ "received bytes: len=" ++ (show $ B.length msg)
        catch (handler msg addr) $ \(e :: SomeException) -> logInfoN $ "malformed UDP packet: " <> (T.pack $ show e)
    udpHandshakeServer prv sock portNum
  where
    handler msg addr = case argValidator msg addr of
      Left msgErr -> logInfoN . T.pack $ "Invalid message: " ++ show msgErr ++ " -- " ++ show msg
      Right (packet, otherPubKey, otherPort) -> do
        _ <- logInfoN $ T.pack $ CL.cyan "<<<<" ++ " (" ++ show addr ++ " " ++ BC.unpack (B.take 10 $ B16.encode $ B.pack $ pointToBytes otherPubKey) ++ "....) " ++ format packet
        handleValidPacket prv sock addr otherPort packet otherPubKey
    argValidator :: B.ByteString -> SockAddr -> Either DiscoverException (NodeDiscoveryPacket, ECC.Point, PortNumber)
    argValidator msg addr = do
      (packet, otherPubkey) <- dataToPacket msg
      validOtherPubKey <- hPubKeyToPubKey otherPubkey
      otherPort <- getAddrPort addr
      return (packet, validOtherPubKey, otherPort)

handleValidPacket :: (HasSQLDB m,
                      MonadResource m,
                      MonadBaseControl IO m,
                      MonadCatch m,
                      MonadThrow m,
                      MonadLogger m)
                  => H.PrvKey
                  -> Socket
                  -> SockAddr
                  -> PortNumber
                  -> NodeDiscoveryPacket
                  -> ECC.Point
                  -> m ()
handleValidPacket prv sock addr portNum packet otherPubKey =
  case packet of
    Ping{} -> do
               let ip = sockAddrToIP addr
               curTime <- liftIO getCurrentTime
               let peer = PPeer {
                     pPeerPubkey = Just otherPubKey,
                     pPeerIp = T.pack ip,
                     pPeerUdpPort = fromIntegral portNum,
                     pPeerTcpPort = fromIntegral portNum, --TODO- put correct TCP port in here
                     pPeerNumSessions = 0,
                     pPeerLastTotalDifficulty = 0,
                     pPeerLastMsg  = T.pack "msg",
                     pPeerLastMsgTime = curTime,
                     pPeerEnableTime = curTime,
                     pPeerUdpEnableTime = curTime,
                     pPeerLastBestBlockHash = SHA 0,
                     pPeerBondState = 0,
                     pPeerVersion = T.pack "61" -- fix
                     }
               _ <- addPeer peer

               time <- liftIO $ round `fmap` getPOSIXTime
               peerAddr <- fmap IPV4Addr $ liftIO $ inet_addr "127.0.0.1"
               sendPacket sock prv addr $ Pong (Endpoint peerAddr 30303 30303) 4 (time+50)

    Pong{} ->
      liftIO $ setPeerBondingState (sockAddrToIP addr) (fromIntegral portNum) 2

    FindNeighbors{} -> do
               time <- liftIO $ round `fmap` getPOSIXTime
               sendPacket sock prv addr $ Neighbors [] (time + 50)

    Neighbors neighbors _ ->
               forM_ neighbors $ \(Neighbor (Endpoint addr' udpPort tcpPort) nodeID) -> do
                              curTime <- liftIO getCurrentTime
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
                                    pPeerUdpEnableTime = curTime,
                                    pPeerLastBestBlockHash = SHA 0,
                                    pPeerBondState = 0,
                                    pPeerVersion = T.pack "61" -- fix
                                    }
                              _ <- addPeer peer

                              return ()

getAddrPort::SockAddr-> Either DiscoverException PortNumber
getAddrPort (SockAddrInet portNumber _) = Right portNumber
getAddrPort (SockAddrInet6 portNumber _ _ _) = Right portNumber
getAddrPort s = Left $ MissingPortException $ "No port number: " ++ show s
