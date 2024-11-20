{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE BlockArguments #-}

{-# OPTIONS -fno-warn-deprecations #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.UDPServer
  ( runEthUDPServer,
    connectMe,
  )
where

import BlockApps.Logging
import Blockchain.Data.PubKey
import Blockchain.Strato.Discovery.ContextLite
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.P2PUtil
import Blockchain.Strato.Discovery.UDP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad (forM_, when)
import Control.Monad.Catch
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import qualified Crypto.Types.PubKey.ECC as ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Either.Combinators
import Data.Maybe (fromJust)
import qualified Data.Text as T
import Data.Time.Clock.POSIX
import Network.Socket
import System.Entropy
import System.Random
import qualified Text.Colors as CL
import Text.Format

runEthUDPServer :: MonadDiscovery m => Int -> m ()
runEthUDPServer minPeers = do
  pub <- getPub
  $logInfoS "ethereumDiscovery" . T.pack $ "My NodeID: " ++ format pub
  $logInfoS "ethereumDiscovery" . T.pack $ "My Node Address: " ++ (format $ fromPublicKey pub)
  udpHandshakeServer minPeers

connectMe ::
  (MonadIO m, MonadFail m, MonadLogger m) =>
  UDPPort ->
  m Socket
connectMe (UDPPort port') = do
  (serveraddr : _) <-
    liftIO $
      getAddrInfo
        (Just 
          (defaultHints {addrFlags = [AI_PASSIVE] 
          -- NOTE: I believe on day, we will want to use ipv6 addresses by default. Alas, today is not the day.
          -- But I will leave this line here with this comment in the hopes that when we do decide the day has come,
          -- all we need to do is uncomment the line below (will make platform prefer ipv6 over ipv4, so be prepared
          -- for some confusion :D)
          -- , addrFamily = AF_INET6  -- AF_INET6 + Datagram allows both ipv4 and ipv6 to be handled by same socket
          }))
        Nothing
        (Just (show port'))
  sock <- liftIO $ socket (addrFamily serveraddr) Datagram defaultProtocol
  liftIO $ bind sock (addrAddress serveraddr)

  return sock

addPeersIfNeeded :: MonadDiscovery m => Int -> m ()
addPeersIfNeeded minPeers = do
  numAvailablePeers <- getNumAvailablePeers
  $logInfoS "addPeersIfNeeded" . T.pack $ "Number of available peers: " ++ show numAvailablePeers ++ " / " ++ show minPeers
  when (numAvailablePeers < minPeers) $ do
    eBondedPeers <- getBondedPeersForUDP
    case eBondedPeers of
      Left err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to find peers: " ++ show err
      Right [] -> $logInfoS "addPeersIfNeeded" "no peers available to bootstrap from, will try again soon."
      Right bondedPeers -> do
        peerNumber <- liftIO $ randomRIO (0, length bondedPeers - 1)
        let thePeer = bondedPeers !! peerNumber
        time <- liftIO $ round `fmap` getPOSIXTime
        randomBytes <- liftIO $ getEntropy 64
        sendPacket thePeer $ FindNeighbors (NodeID randomBytes) (time + 50)
        eErr <- disableUDPPeerForSeconds thePeer 10
        whenLeft eErr $ \err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to disable peer: " ++ show err

attemptBond :: MonadDiscovery m => m ()
attemptBond = do
  udpPort <- Mod.access (Mod.Proxy @UDPPort)
  tcpPort <- Mod.access (Mod.Proxy @TCPPort)
  unbondedPeers <- getUnbondedPeers
  when (length unbondedPeers /= 0) . forM_ unbondedPeers $ \p -> do
    time <- liftIO $ round `fmap` getPOSIXTime
    mServerAddr <- A.select (A.Proxy @SockAddr) (Nothing :: Maybe IPAsText, udpPort)
    forM_ mServerAddr \serverAddr ->
      case getHostAddress serverAddr of
        Left err -> $logErrorS "attemptBond" $ T.pack . show $ err
        Right hostAddress -> do
          when (pPeerLastMsg p == T.pack "Ping") $ do
            -- if we've pinged before w/o a response, wait longer before next ping
            eErr <- lengthenPeerDisable' p
            whenLeft eErr $ \err -> $logErrorS "handleValidPacket/attemptBond" . T.pack $ "Unable to disable peer: " ++ show err
          sendPacket p $
            Ping
              4
              (Endpoint hostAddress udpPort tcpPort)
              ( Endpoint
                  (stringToIAddr $ T.unpack $ pPeerIp p)
                  (UDPPort . fromIntegral $ pPeerUdpPort p)
                  (TCPPort . fromIntegral $ pPeerTcpPort p)
              )
              (time + 50)

udpHandshakeServer :: MonadDiscovery m => Int -> m ()
udpHandshakeServer minPeers = do
  _ <- addPeersIfNeeded minPeers
  _ <- attemptBond
  -- TODO(tim): make a --strict-ethereum-compliance and reset this to 1280
  maybePacketData <- A.select (A.Proxy @(B.ByteString, SockAddr)) ()
  _ <- case maybePacketData of
    Nothing -> $logInfoS "udpHandshakeServer" "timeout triggered"
    Just (msg, addr) -> do
      _ <- $logInfoS "udpHandshakeServer" $ T.pack $ "received bytes: len=" ++ (show $ B.length msg)
      catch (handler msg addr) $ \(e :: SomeException) -> $logInfoS "udpHandshakeServer" $ "malformed UDP packet: " <> (T.pack $ show e)
  udpHandshakeServer minPeers
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

handleValidPacket ::
  MonadDiscovery m =>
  SockAddr ->
  UDPPort ->
  NodeDiscoveryPacket ->
  ECC.Point ->
  m ()
handleValidPacket addr otherUdpPort packet otherPubKey = case packet of
  Ping _ ep@(Endpoint _ otherUdpPort' otherTcpPort) _ _ -> do
    addPeer' otherUdpPort' otherTcpPort
    time <- liftIO $ round `fmap` getPOSIXTime
    mPeer <- getPeerByIP' ip
    sendPacket (fromJust mPeer) $ Pong ep 4 (time + 50)
    eErr' <- setPeerBondingState ip otherPubKey 2
    whenLeft eErr' $ \err -> do
      $logErrorS "handleValidPacket" . T.pack $ "Unable to set peer bonding state: " ++ show err
      throwM err
  Pong {} -> do
    addPeer' otherUdpPort (TCPPort 30303) -- to update pubkey if needed
    thePeer <- getPeerByIP' ip
    eErr <- resetPeerUdp $ fromJust thePeer
    whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Pong" . T.pack $ "Unable to reset peer disable: " ++ show err
    eErr' <- setPeerBondingState ip otherPubKey 2
    whenLeft eErr' $ \err -> do
      $logErrorS "handleValidPacket" . T.pack $ "Unable to set peer bonding state: " ++ show err
      throwM err
  (FindNeighbors targetPubkey _) -> do
    time <- liftIO $ round `fmap` getPOSIXTime
    let nextTime = time + 50
    getPeerByIP' ip >>= \case 
      Nothing -> $logInfoS "handleValidPacket/FindNeighbors" "Ignoring FindNeigbors request from unknown peer"
      Just peer -> do 
        A.select (A.Proxy @PeerBondingState) (IPAsText $ T.pack ip, otherPubKey) >>= \case 
          Just (PeerBondingState b) | b > 1 -> do
            peers <- getPeersClosestTo targetPubkey otherPubKey
            let theNeighbors = (\p -> Neighbor (mkEndpoint p) (mkNodeId p)) <$> peers
            sendPacket (peer) $ Neighbors theNeighbors nextTime
          _ -> do
            $logInfoS "handleValidPacket/FindNeighbors" "Recieved FindNeighbors request from a peer we are not bonded to; will attempt to bond first"
            udpPort <- Mod.access (Mod.Proxy @UDPPort)
            tcpPort <- Mod.access (Mod.Proxy @TCPPort)
            mServerAddr <- A.select (A.Proxy @SockAddr) (Nothing :: Maybe IPAsText, udpPort)
            case getHostAddress <$> mServerAddr of 
              Just (Right hostAddress) -> sendPacket (peer) $ Ping 4 (Endpoint hostAddress udpPort tcpPort) (mkEndpoint peer) nextTime
              _ -> $logErrorS "handleValidPacket/FindNeighbors" "Attempted to bond to peer but failed"
    where
      mkEndpoint PPeer {..} = Endpoint (stringToIAddr $ T.unpack pPeerIp) (UDPPort pPeerUdpPort) (TCPPort pPeerTcpPort)
      mkNodeId = pointToNodeID . fromJust . pPeerPubkey
  Neighbors neighbors _ -> do
    let neighborIPs = ((\(Neighbor (Endpoint addr' _ _) _) -> format addr') <$> neighbors)
    thePeer <- getPeerByIP' ip
    neighborsExist <- doPeersExist neighborIPs
    if (neighborsExist == True)
      then do
        $logInfoS "handleValidPacket/Neighbors" . T.pack $ "Got duplicate neighbors from " ++ show addr ++ ", lengthening peer UDP disable." ++ "\n"
        disErr <- storeDisableException (fromJust thePeer) (T.pack "duplicateNeighbors")
        whenLeft disErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to store disable exception: " ++ show err
        eErr <- lengthenPeerDisable' $ fromJust thePeer
        whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to disable peer: " ++ show err
      else do
        forM_ neighbors $ \(Neighbor (Endpoint addr' (UDPPort udpPort) (TCPPort tcpPort)) nodeID) -> do
          $logDebugS "handleValidPacket/Neighbors" . T.pack $ "Got new neighbors: " ++ show neighbors
          curTime <- liftIO getCurrentTime
          let peer =
                PPeer
                  { pPeerPubkey = Just $ nodeIDToPoint nodeID,
                    pPeerIp = T.pack $ format addr',
                    pPeerUdpPort = udpPort,
                    pPeerTcpPort = tcpPort,
                    pPeerNumSessions = 0,
                    pPeerLastTotalDifficulty = 0,
                    pPeerLastMsg = T.pack "msg",
                    pPeerLastMsgTime = curTime,
                    pPeerEnableTime = curTime,
                    pPeerUdpEnableTime = curTime,
                    pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0,
                    pPeerBondState = 0,
                    pPeerActiveState = 0,
                    pPeerVersion = T.pack "61", -- fix
                    pPeerDisableException = T.pack "None",
                    pPeerNextDisableWindowSeconds = 5,
                    pPeerNextUdpDisableWindowSeconds = 5,
                    pPeerDisableExpiration = posixSecondsToUTCTime 0
                  }
          addPeer peer
        eErr <- resetPeerUdp $ fromJust thePeer
        whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to reset peer disable: " ++ show err
  where
    ip = sockAddrToIP addr
    addPeer' (UDPPort peerUdpPort) (TCPPort peerTcpPort) = do
      curTime <- liftIO getCurrentTime
      let peer =
            PPeer
              { pPeerPubkey = Just otherPubKey,
                pPeerIp = T.pack ip,
                pPeerUdpPort = fromIntegral peerUdpPort,
                pPeerTcpPort = fromIntegral peerTcpPort,
                pPeerNumSessions = 0,
                pPeerLastTotalDifficulty = 0,
                pPeerLastMsg = T.pack "msg",
                pPeerLastMsgTime = curTime,
                pPeerEnableTime = curTime,
                pPeerUdpEnableTime = curTime,
                pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0,
                pPeerBondState = 0,
                pPeerActiveState = 0,
                pPeerVersion = T.pack "61", -- fix
                pPeerDisableException = T.pack "None",
                pPeerNextDisableWindowSeconds = 5,
                pPeerNextUdpDisableWindowSeconds = 5,
                pPeerDisableExpiration = posixSecondsToUTCTime 0
              }
      addPeer peer

getAddrPort :: SockAddr -> Either DiscoverException PortNumber
getAddrPort (SockAddrInet portNumber _) = Right portNumber
getAddrPort (SockAddrInet6 portNumber _ _ _) = Right portNumber
getAddrPort s = Left . MissingPortException $ "No port number: " ++ show s
