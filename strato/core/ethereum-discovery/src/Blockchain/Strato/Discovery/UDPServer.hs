{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# OPTIONS -fno-warn-deprecations #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.UDPServer
     ( runEthUDPServer
     , connectMe
     ) where

import           Control.Applicative                     (liftA2)
import           Control.Monad.Catch
import qualified Control.Monad.Change.Alter              as A
import qualified Control.Monad.Change.Modify             as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import qualified Crypto.Types.PubKey.ECC                 as ECC
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import           Data.Either.Combinators
import           Data.Foldable                           (for_)
import           Data.Maybe                              (fromJust)
import qualified Data.Text                               as T
import           Data.Time.Clock.POSIX
import           Network.Socket
import           System.Entropy
import           System.Random

import           BlockApps.Logging
import           Blockchain.Data.PubKey
import           Blockchain.EthConf
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.P2PUtil
import           Blockchain.Strato.Discovery.UDP
import qualified Text.Colors                             as CL
import           Text.Format


runEthUDPServer :: MonadDiscovery m => m ()
runEthUDPServer = do
  pub <- getPub
  $logInfoS "ethereumDiscovery" . T.pack $ "My NodeID: " ++ format pub
  $logInfoS "ethereumDiscovery" . T.pack $ "My Node Address: " ++ (format $ fromPublicKey pub)
  udpHandshakeServer

connectMe :: (MonadIO m, MonadFail m, MonadLogger m)
          => UDPPort -> m Socket
connectMe (UDPPort port') = do
  (serveraddr:_) <- liftIO $ getAddrInfo
                                  (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
                                  Nothing (Just (show port'))
  sock <- liftIO $ socket (addrFamily serveraddr) Datagram defaultProtocol
  liftIO $ bind sock (addrAddress serveraddr)

  return sock

addPeersIfNeeded :: MonadDiscovery m => m ()
addPeersIfNeeded = do
  numAvailablePeers <- liftIO getNumAvailablePeers
  let minPeers = minAvailablePeers (discoveryConfig ethConf)
  $logInfoS "addPeersIfNeeded" . T.pack $ "Number of available peers: " ++ show numAvailablePeers ++ " / " ++ show minPeers
  when (numAvailablePeers < minPeers) $ do
    eBondedPeers <- liftIO getBondedPeersForUDP
    case eBondedPeers of
      Left err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to find peers: " ++ show err
      Right [] -> $logInfoS "addPeersIfNeeded" "no peers available to bootstrap from, will try again soon."
      Right bondedPeers -> do
        peerNumber <- liftIO $ randomRIO (0, length bondedPeers - 1)
        let thePeer = bondedPeers !! peerNumber
        mPeerAddr <- A.select (A.Proxy @SockAddr) (Just $ IPAsText $ pPeerIp thePeer, UDPPort . fromIntegral $ pPeerUdpPort thePeer)
        for_ mPeerAddr $ \peerAddr -> do
          time <- liftIO $ round `fmap` getPOSIXTime
          randomBytes <- liftIO $ getEntropy 64
          sendPacket peerAddr $ FindNeighbors (NodeID randomBytes) (time + 50)
          eErr <- liftIO $ disableUDPPeerForSeconds thePeer 10
          whenLeft eErr $ \err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to disable peer: " ++ show err

attemptBond :: MonadDiscovery m => m ()
attemptBond = do
  udpPort <- Mod.access (Mod.Proxy @UDPPort)
  tcpPort <- Mod.access (Mod.Proxy @TCPPort)
  unbondedPeers <- liftIO getUnbondedPeers
  when (length unbondedPeers /= 0) . forM_ unbondedPeers $ \p -> do
    let peerIpAddr = IPAsText $ pPeerIp p
        peerUdpPort = UDPPort . fromIntegral $ pPeerUdpPort p
    mPeerAddr <- A.select (A.Proxy @SockAddr) (Just peerIpAddr, peerUdpPort)
    time <- liftIO $ round `fmap` getPOSIXTime
    mServerAddr <- A.select (A.Proxy @SockAddr) (Nothing :: Maybe IPAsText, udpPort)
    for_ (liftA2 (,) mPeerAddr mServerAddr) $ \(peerAddr, serverAddr) ->
      case getHostAddress serverAddr of
        Left err -> $logInfoS "attemptBond" $ T.pack . show $ err
        Right hostAddress -> do
          sendPacket peerAddr $
                Ping 4
                   (Endpoint hostAddress udpPort tcpPort)
                   (Endpoint (stringToIAddr $ T.unpack $ pPeerIp p)
                             peerUdpPort
                             (TCPPort . fromIntegral $ pPeerTcpPort p))
                   (time+50)

udpHandshakeServer :: MonadDiscovery m => m ()
udpHandshakeServer = do
    _ <- addPeersIfNeeded
    _ <- attemptBond
    -- TODO(tim): make a --strict-ethereum-compliance and reset this to 1280
    maybePacketData <- A.select (A.Proxy @(B.ByteString, SockAddr)) ()
    _ <- case maybePacketData of
      Nothing -> $logInfoS "udpHandshakeServer" "timeout triggered"
      Just (msg, addr) -> do
        _ <- $logInfoS "udpHandshakeServer" $ T.pack $ "received bytes: len=" ++ (show $ B.length msg)
        catch (handler msg addr) $ \(e :: SomeException) -> $logInfoS "udpHandshakeServer" $ "malformed UDP packet: " <> (T.pack $ show e)
    udpHandshakeServer
  where
    handler msg addr = case argValidator msg addr of
      Left msgErr -> $logInfoS "udpHandshakeServer/handler" $ T.pack $ "Invalid message: " ++ show msgErr ++ " -- " ++ show msg
      Right (packet, otherPubKey, otherPort) -> do
        _ <- $logInfoS "udpHandshakeServer/handler" $ T.pack $ CL.cyan "receiving " ++ " (" ++ show addr ++ " " ++ BC.unpack (B.take 10 $ B16.encode $ pointToBytes otherPubKey) ++ "....) " ++ format packet
        handleValidPacket addr otherPort packet otherPubKey
    argValidator :: B.ByteString -> SockAddr -> Either DiscoverException (NodeDiscoveryPacket, ECC.Point, UDPPort)
    argValidator msg sockAddr = do
      (packet, otherPubkey) <- dataToPacket msg
      otherUdpPort <- getAddrPort sockAddr
      let validOtherPubKey = secPubKeyToPoint otherPubkey
      return (packet, validOtherPubKey, UDPPort $ fromIntegral otherUdpPort)

handleValidPacket :: MonadDiscovery m
                  => SockAddr
                  -> UDPPort
                  -> NodeDiscoveryPacket
                  -> ECC.Point
                  -> m ()
handleValidPacket addr (UDPPort otherUdpPort) packet otherPubKey = case packet of
    Ping _ ep@(Endpoint _ otherUdpPort' otherTcpPort) _ _ -> do
        addPeer' otherUdpPort' otherTcpPort
        time <- liftIO $ round `fmap` getPOSIXTime
        sendPacket addr $ Pong ep 4 (time+50)

    Pong{} -> do
        eErr <- liftIO $ setPeerBondingState (sockAddrToIP addr) otherUdpPort 2
        whenLeft eErr $ \ err -> do
            $logErrorS "handleValidPacket" . T.pack $ "Unable to set peer bonding state: " ++ show err
            throwM err

    (FindNeighbors targetPubkey _) -> do
        time <- liftIO $ round `fmap` getPOSIXTime
        let nextTime = time + 50
            ip = sockAddrToIP addr
        peers <- getPeersClosestTo targetPubkey (T.pack ip) otherPubKey
        let theNeighbors = (\p -> Neighbor (mkEndpoint p) (mkNodeId p)) <$> peers
        sendPacket addr $ Neighbors theNeighbors nextTime
          where mkEndpoint PPeer{..} = Endpoint (stringToIAddr $ T.unpack pPeerIp) (UDPPort pPeerUdpPort) (TCPPort pPeerTcpPort)
                mkNodeId             = pointToNodeID . fromJust . pPeerPubkey

    Neighbors neighbors _ -> forM_ neighbors $ \(Neighbor (Endpoint addr' (UDPPort udpPort) (TCPPort tcpPort)) nodeID) -> do
        $logDebugS "handleValidPacket/Neighbors" . T.pack $ "Got new neighbors: " ++ show neighbors
        curTime <- liftIO getCurrentTime
        let peer = PPeer { pPeerPubkey = Just $ nodeIDToPoint nodeID
                         , pPeerIp = T.pack $ format addr'
                         , pPeerUdpPort = udpPort
                         , pPeerTcpPort = tcpPort
                         , pPeerNumSessions = 0
                         , pPeerLastTotalDifficulty = 0
                         , pPeerLastMsg  = T.pack "msg"
                         , pPeerLastMsgTime = curTime
                         , pPeerEnableTime = curTime
                         , pPeerUdpEnableTime = curTime
                         , pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0
                         , pPeerBondState = 0
                         , pPeerActiveState = 0
                         , pPeerVersion = T.pack "61" -- fix
                         , pPeerNextDisableWindowSeconds=5
                         , pPeerDisableExpiration=posixSecondsToUTCTime 0
                         , pPeerEnode = peerToEnode peer
                         }
        addPeer peer
  where addPeer' (UDPPort peerUdpPort) (TCPPort peerTcpPort) = do
          curTime <- liftIO getCurrentTime
          let ip   = sockAddrToIP addr
              peer = PPeer { pPeerPubkey = Just otherPubKey
                          , pPeerIp = T.pack ip
                          , pPeerUdpPort = fromIntegral peerUdpPort
                          , pPeerTcpPort = fromIntegral peerTcpPort
                          ,  pPeerNumSessions = 0
                          ,  pPeerLastTotalDifficulty = 0
                          ,  pPeerLastMsg  = T.pack "msg"
                          ,  pPeerLastMsgTime = curTime
                          ,  pPeerEnableTime = curTime
                          ,  pPeerUdpEnableTime = curTime
                          ,  pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0
                          ,  pPeerBondState = 0
                          ,  pPeerActiveState = 0
                          ,  pPeerVersion = T.pack "61" -- fix
                          , pPeerNextDisableWindowSeconds=5
                          , pPeerDisableExpiration=posixSecondsToUTCTime 0
                          , pPeerEnode = peerToEnode peer
                          }
          addPeer peer


getAddrPort :: SockAddr -> Either DiscoverException PortNumber
getAddrPort (SockAddrInet portNumber _)      = Right portNumber
getAddrPort (SockAddrInet6 portNumber _ _ _) = Right portNumber
getAddrPort s                                = Left . MissingPortException $ "No port number: " ++ show s
