{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.UDPServer
     ( runEthUDPServer
     , connectMe
     ) where

import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Crypto.Types.PubKey.ECC                 as ECC
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import           Data.Maybe                              (fromJust)
import           Data.Monoid
import qualified Data.Text                               as T
import           Data.Time.Clock.POSIX
import           Network.Socket
import qualified Network.Socket.ByteString               as NB
import           System.Timeout

import           System.Entropy
import           System.Random

import qualified Blockchain.Colors                       as CL
import           Blockchain.Data.PubKey
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.P2PUtil
import           Blockchain.Strato.Discovery.PeerDB
import           Blockchain.Strato.Discovery.UDP

import qualified Network.Haskoin.Internals               as H

runEthUDPServer :: ( MonadIO m
                   , MonadCatch m
                   , MonadThrow m
                   , MonadBaseControl IO m
                   , MonadLogger m
                   )
                => ContextLite
                -> H.PrvKey
                -> Int
                -> Socket
                -> m ()
runEthUDPServer ctx myPriv _ sock =
  void . runResourceT $ runStateT (udpHandshakeServer myPriv sock portNum) ctx
     where portNum = 30303 -- TODO(tim): Reenable port selection

connectMe :: (MonadIO m, MonadLogger m)
          => Int
          -> m Socket
connectMe _ = do
  let port' = 30303 :: Int -- TODO(tim): Reenable port selection
  (serveraddr:_) <- liftIO $ getAddrInfo
                                  (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
                                  Nothing (Just (show port'))
  sock <- liftIO $ socket (addrFamily serveraddr) Datagram defaultProtocol
  liftIO $ bind sock (addrAddress serveraddr)

  return sock

addPeersIfNeeded :: (MonadIO m, MonadLogger m)
                 => H.PrvKey
                 -> Socket
                 -> m ()
addPeersIfNeeded prv sock= do
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
        (peeraddr:_) <- liftIO $ getAddrInfo Nothing (Just $ T.unpack $ pPeerIp thePeer) (Just $ show $ pPeerUdpPort thePeer)
        time <- liftIO $ round `fmap` getPOSIXTime
        randomBytes <- liftIO $ getEntropy 64
        sendPacket sock prv (addrAddress peeraddr) $ FindNeighbors (NodeID randomBytes) (time + 50)
        eErr <- liftIO $ disableUDPPeerForSeconds thePeer 10
        case eErr of
          Right () -> return ()
          Left err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to disable peer: " ++ show err

attemptBond :: (MonadIO m, MonadLogger m)
            => H.PrvKey
            -> Socket
            -> Int
            -> m ()
attemptBond prv sock _ = do
  let portNum = 30303 :: Int
  unbondedPeers <- liftIO getUnbondedPeers
  when (length unbondedPeers /= 0) $
    forM_ unbondedPeers $ \p' -> do
      let p = p'{pPeerUdpPort = 30303, pPeerTcpPort=30303} -- TODO(tim): Reenable port selection
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
        Left err -> $logInfoS "attemptBond" $ T.pack . show $ err
        Right hostAddress -> do
          sendPacket sock prv (addrAddress peeraddr) $
                Ping 4
                   (Endpoint hostAddress 30303 30303)
                   (Endpoint (stringToIAddr $ T.unpack $ pPeerIp p)
                             (fromIntegral $ pPeerUdpPort p)
                             (fromIntegral $ pPeerTcpPort p))
                   (time+50)

udpHandshakeServer :: ( HasSQLDB m
                      , MonadResource m
                      , MonadBaseControl IO m
                      , MonadCatch m
                      , MonadThrow m
                      , MonadLogger m
                      )
                   => H.PrvKey
                   -> Socket
                   -> Int
                   -> m ()
udpHandshakeServer prv sock _ = do
    let portNum = 30303 -- TODO(tim): Reenable port selection
    _ <- addPeersIfNeeded prv sock
    _ <- attemptBond prv sock portNum
    -- TODO(tim): make a --strict-ethereum-compliance and reset this to 1280
    maybePacketData <- liftIO $ timeout 10000000 $ NB.recvFrom sock 80000
    _ <- case maybePacketData of
      Nothing -> $logInfoS "udpHandshakeServer" "timeout triggered"
      Just (msg, addr) -> do
        _ <- $logInfoS "udpHandshakeServer" $ T.pack $ "received bytes: len=" ++ (show $ B.length msg)
        catch (handler msg addr) $ \(e :: SomeException) -> $logInfoS "udpHandshakeServer" $ "malformed UDP packet: " <> (T.pack $ show e)
    udpHandshakeServer prv sock portNum
  where
    handler msg addr = case argValidator msg addr of
      Left msgErr -> $logInfoS "udpHandshakeServer/handler" $ T.pack $ "Invalid message: " ++ show msgErr ++ " -- " ++ show msg
      Right (packet, otherPubKey, otherPort) -> do
        _ <- $logInfoS "udpHandshakeServer/handler" $ T.pack $ CL.cyan "receiving " ++ " (" ++ show addr ++ " " ++ BC.unpack (B.take 10 $ B16.encode $ B.pack $ pointToBytes otherPubKey) ++ "....) " ++ format packet
        handleValidPacket prv sock addr otherPort packet otherPubKey
    argValidator :: B.ByteString -> SockAddr -> Either DiscoverException (NodeDiscoveryPacket, ECC.Point, PortNumber)
    argValidator msg _ = do
      (packet, otherPubkey) <- dataToPacket msg
      validOtherPubKey <- hPubKeyToPubKey otherPubkey
      -- otherPort <- getAddrPort addr
      let otherPort = 30303 -- TODO(tim): Reenable port selection
      return (packet, validOtherPubKey, otherPort)

handleValidPacket :: ( HasSQLDB m
                     , MonadResource m
                     , MonadBaseControl IO m
                     , MonadCatch m
                     , MonadThrow m
                     , MonadLogger m
                     )
                  => H.PrvKey
                  -> Socket
                  -> SockAddr
                  -> PortNumber
                  -> NodeDiscoveryPacket
                  -> ECC.Point
                  -> m ()
                                                       -- TODO(tim): Reenable port selection
handleValidPacket prv sock addr _ packet otherPubKey = let portNum = 30303 :: Int in case packet of
    Ping{} -> do
        addPeer'
        time <- liftIO $ round `fmap` getPOSIXTime
        peerAddr <- fmap IPV4Addr $ liftIO $ inet_addr "127.0.0.1" -- todo: WHAT THE FUCK?!???!?!
        sendPacket sock prv addr $ Pong (Endpoint peerAddr 30303 30303) 4 (time+50)

    Pong{} -> do
        addPeer'
        eErr <- liftIO $ setPeerBondingState (sockAddrToIP addr) (fromIntegral portNum) 2
        case eErr of
          Right () -> return ()
          Left err -> do
            $logErrorS "handleValidPacket" . T.pack $ "Unable to set peer bonding state: " ++ show err
            throwM err

    (FindNeighbors targetPubkey _) -> do
        time <- liftIO $ round `fmap` getPOSIXTime
        let nextTime = time + 50
            ip = sockAddrToIP addr
        peers <- getPeersClosestTo targetPubkey (T.pack ip) otherPubKey
        let theNeighbors = (\p -> Neighbor (mkEndpoint p) (mkNodeId p)) <$> peers
        sendPacket sock prv addr $ Neighbors theNeighbors nextTime
                -- TODO(tim): Reenable port selection
          where mkEndpoint PPeer{..} = Endpoint (stringToIAddr $ T.unpack pPeerIp) 30303 30303
                mkNodeId             = pointToNodeID . fromJust . pPeerPubkey


                                                          -- TODO(tim): Reenable port selection
    Neighbors neighbors _ -> forM_ neighbors $ \(Neighbor (Endpoint addr' _ _) nodeID) -> do
        $logDebugS "handleValidPacket/Neighbors" . T.pack $ "Got new neighbors: " ++ show neighbors
        curTime <- liftIO getCurrentTime
        let peer = PPeer { pPeerPubkey = Just $ nodeIDToPoint nodeID
                         , pPeerIp = T.pack $ format addr'
                         , pPeerUdpPort = 30303
                         , pPeerTcpPort = 30303
                         , pPeerNumSessions = 0
                         , pPeerLastTotalDifficulty = 0
                         , pPeerLastMsg  = T.pack "msg"
                         , pPeerLastMsgTime = curTime
                         , pPeerEnableTime = curTime
                         , pPeerUdpEnableTime = curTime
                         , pPeerLastBestBlockHash = SHA 0
                         , pPeerBondState = 0
                         , pPeerActiveState = 0
                         , pPeerVersion = T.pack "61" -- fix
                         }
        void $ addPeer peer
  where addPeer' = do
          curTime <- liftIO getCurrentTime
          let ip   = sockAddrToIP addr
              portNum = 30303 :: Int
              peer = PPeer { pPeerPubkey = Just otherPubKey
                          , pPeerIp = T.pack ip
                          , pPeerUdpPort = fromIntegral portNum
                          -- TODO(tim): This TODO may be the cause of the trouble
                          , pPeerTcpPort = fromIntegral portNum --TODO- put correct TCP port in here
                          ,  pPeerNumSessions = 0
                          ,  pPeerLastTotalDifficulty = 0
                          ,  pPeerLastMsg  = T.pack "msg"
                          ,  pPeerLastMsgTime = curTime
                          ,  pPeerEnableTime = curTime
                          ,  pPeerUdpEnableTime = curTime
                          ,  pPeerLastBestBlockHash = SHA 0
                          ,  pPeerBondState = 0
                          ,  pPeerActiveState = 0
                          ,  pPeerVersion = T.pack "61" -- fix
                          }
          void $ addPeer peer

-- TODO(tim): Reenable port selection
-- getAddrPort :: SockAddr -> Either DiscoverException PortNumber
-- getAddrPort (SockAddrInet portNumber _)      = Right portNumber
-- getAddrPort (SockAddrInet6 portNumber _ _ _) = Right portNumber
-- getAddrPort s                                = Left . MissingPortException $ "No port number: " ++ show s
