{-# LANGUAGE BlockArguments      #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE MonoLocalBinds      #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}

module Blockchain.Strato.Discovery.UDPServer
  ( runEthUDPServer,
    connectMe,
    keepsHeldKey,
  )
where

import           BlockApps.Logging
import           Blockchain.Data.PubKey
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.P2PUtil
import           Blockchain.Strato.Discovery.UDP
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Host
import qualified Blockchain.Strato.Model.Secp256k1          as Secp256k1
import           Blockchain.Strato.Model.Validator          (Validator (..))
import           Control.Concurrent                       (threadDelay)
import           Control.Exception                       (evaluate)
import           Control.Monad                           (filterM, forM_, void, when, unless)
import           Control.Monad.Catch
import qualified Control.Monad.Change.Alter              as A
import qualified Control.Monad.Change.Modify             as Mod
import           Control.Monad.Composable.Vault
import           Control.Monad.IO.Class
import qualified Crypto.Types.PubKey.ECC                 as ECC
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import           Data.Default                            (def)
import           Data.Either.Combinators
import           Data.Foldable                           (for_)
import           Data.IP                                 (IP)
import           Data.Maybe                              (catMaybes, fromMaybe, isJust)
import qualified Data.Text                               as T
import           Data.Time.Clock.POSIX
import           Network.Socket
import           Numeric.Natural
import           Strato.Strato23.API.Types
import           System.Entropy
import           System.Random
import qualified Text.Colors                             as CL
import           Text.Format

getKeyOrMakeKey :: (MonadCatch m, HasVault m, MonadIO m, MonadLogger m) =>
                   m PublicKey
getKeyOrMakeKey = do
  (resultOrError :: Either SomeException PublicKey) <- try getPub

  case resultOrError of
    Left getErr -> do
      $logInfoS "getKeyOrMakeKey" . T.pack $ "Node key is not available from Vault yet: " ++ show getErr
      liftIO $ threadDelay 2000000
      getKeyOrMakeKey
    Right result -> return result

runEthUDPServer :: MonadDiscovery m => Int -> m ()
runEthUDPServer minPeers = do
  key <- getKeyOrMakeKey
  $logInfoS "ethereumDiscovery" . T.pack $ "My NodeID: " ++ format key
  $logInfoS "ethereumDiscovery" . T.pack $ "My Node Address: " ++ format (fromPublicKey key)
  udpHandshakeServer minPeers

connectMe ::
  (MonadIO m, MonadFail m, MonadCatch m) =>
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
          , addrFamily = AF_INET
          -- , addrFamily = AF_INET6  -- AF_INET6 + Datagram allows both ipv4 and ipv6 to be handled by same socket
          }))
        Nothing
        (Just (show port'))
  sock <- liftIO $ socket (addrFamily serveraddr) Datagram defaultProtocol
  liftIO (bind sock (addrAddress serveraddr)) `catch` \(e :: IOError) ->
    throwM $ userError $ "Failed to bind UDP port " ++ show port' ++ ": " ++ show e

  return sock

addPeersIfNeeded :: MonadDiscovery m => Int -> m ()
addPeersIfNeeded minPeers = do
  numAvailablePeers <- getNumAvailablePeers
  $logInfoS "addPeersIfNeeded" . T.pack $ "Number of available peers: " ++ show numAvailablePeers ++ " / " ++ show minPeers
  when (numAvailablePeers < minPeers) $ do
    -- Only a peer that completed an ETH handshake is proven to be on this
    -- network, but a joining node has none: until a bootnode admits it, it
    -- must ask the peers it does know, or it never learns of any other node.
    eBondedPeers <- getBondedPeersForUDP >>= \case
      Right [] -> getAnyBondedPeersForUDP
      other    -> pure other
    case eBondedPeers of
      Left err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to find peers: " ++ show err
      Right [] -> $logInfoS "addPeersIfNeeded" "no peers available to bootstrap from, will try again soon."
      Right bondedPeers -> do
        peerNumber <- liftIO $ randomRIO (0, length bondedPeers - 1)
        let thePeer = bondedPeers !! peerNumber
        time <- liftIO $ round `fmap` getPOSIXTime
        randomBytes <- liftIO $ getEntropy 64
        asked <- sendPacket thePeer $ FindNeighbors (NodeID randomBytes) (time + 50)
        for_ asked $ noteAsked AskNeighbors
        eErr <- disableUDPPeerForSeconds thePeer 10
        whenLeft eErr $ \err -> $logErrorS "addPeersIfNeeded" . T.pack $ "Unable to disable peer: " ++ show err

attemptBond :: MonadDiscovery m => m ()
attemptBond = do
  -- This runs for every packet received, so a peer is pinged again only once
  -- its last Ping has gone unanswered for the answer window.
  unbondedPeers <- filterM (fmap not . maybe (pure False) (wasAsked AskPing) . pPeerIp) =<< getUnbondedPeers
  forM_ unbondedPeers $ \p -> do
    when (pPeerLastMsg p == T.pack "Ping") $ do
      -- if we've pinged before w/o a response, wait longer before next ping
      eErr <- lengthenPeerDisable' p
      whenLeft eErr $ \err -> $logErrorS "handleValidPacket/attemptBond" . T.pack $ "Unable to disable peer: " ++ show err
    pingPeer p

-- | Ping the peer and note that its address was asked: only a Pong from an
-- address this node pinged bonds it (see 'acceptsPacket').
pingPeer :: MonadDiscovery m => PPeer -> m ()
pingPeer p = do
  udpPort <- Mod.access (Mod.Proxy @UDPPort)
  tcpPort <- Mod.access (Mod.Proxy @TCPPort)
  time <- liftIO $ round `fmap` getPOSIXTime
  mServerAddr <- A.select (A.Proxy @SockAddr) (Nothing :: Maybe Host, udpPort)
  forM_ mServerAddr \serverAddr ->
    case getHostAddress serverAddr of
      Left err -> $logErrorS "pingPeer" $ T.pack . show $ err
      Right hostAddress -> do
        pinged <- sendPacket p $
          Ping
            4
            (Endpoint hostAddress udpPort tcpPort)
            ( Endpoint
                (stringToIAddr $ hostToString $ pPeerHost p)
                (UDPPort . fromIntegral $ pPeerUdpPort p)
                (TCPPort . fromIntegral $ pPeerTcpPort p)
            )
            (time + 50)
        for_ pinged $ noteAsked AskPing

-- | Whether a packet is taken at all. It must not have expired, which stops
-- old packets being replayed, and a Pong or a Neighbors must come from an
-- address this node asked: their source address can be forged, so unasked
-- they would let anyone bond any address or fill the peer table.
acceptsPacket :: MonadDiscovery m => IP -> NodeDiscoveryPacket -> m Bool
acceptsPacket ip packet = do
  now <- liftIO $ round `fmap` getPOSIXTime
  if packetExpiration packet < now
    then pure False
    else case packet of
      Pong {} -> wasAsked AskPing ip
      Neighbors {} -> wasAsked AskNeighbors ip
      _ -> pure True

udpHandshakeServer :: MonadDiscovery m => Int -> m ()
udpHandshakeServer minPeers = do
  _ <- addPeersIfNeeded minPeers
  _ <- attemptBond
  -- TODO(tim): make a --strict-ethereum-compliance and reset this to 1280
  Mod.await @UDPPacket >>= \case
    Nothing -> $logInfoS "udpHandshakeServer" "timeout triggered"
    Just (UDPPacket (msg, addr)) -> do
      _ <- $logInfoS "udpHandshakeServer" $ T.pack $ "received bytes: len=" ++ show (B.length msg)
      catch (handler msg addr) $ \(e :: SomeException) -> $logInfoS "udpHandshakeServer" $ "malformed UDP packet: " <> T.pack (show e)
  udpHandshakeServer minPeers
  where
    handler msg addr = case argValidator msg addr of
      Left msgErr -> $logInfoS "udpHandshakeServer/handler" $ T.pack $ "Invalid message: " ++ show msgErr ++ " -- " ++ show msg
      Right (packet, otherPubKey, otherPort) -> do
        _ <- $logInfoS "udpHandshakeServer/handler" $ T.pack $ CL.cyan "receiving " ++ " (" ++ show addr ++ " " ++ BC.unpack (B.take 10 $ B16.encode $ pointToBytes otherPubKey) ++ "....) " ++ format packet
        accepted <- acceptsPacket (addressIP addr) packet
        if accepted
          then handleValidPacket addr otherPort packet otherPubKey
          else $logInfoS "udpHandshakeServer/handler" $ T.pack $ "Dropping an expired or unrequested packet from " ++ show addr
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
  Ping _ ep@(Endpoint _ _ otherTcpPort) _ _ -> do
    time <- liftIO $ round `fmap` getPOSIXTime
    mPeer <- getPeerByIP' ip
    mPeer' <-
      case mPeer of
        Nothing -> do
          addPeer' otherUdpPort otherTcpPort
          getPeerByIP' ip
        Just p' -> do
          -- A packet whose key the row refuses is not that peer's: nothing in it
          -- (ports, bonding) is taken, and it gets no Pong.
          adopted <- adoptPeerKey p' otherPubKey
          if adopted
            then do
              updateUdpPort p' otherUdpPort
              updateTcpPort p' otherTcpPort
              return $ Just p'
            else return Nothing
    case mPeer' of
      Nothing -> pure ()
      Just peer -> do
        let (UDPPort up') = otherUdpPort
        ownTcpPort <- Mod.access (Mod.Proxy @TCPPort)
        void . sendPacket peer{pPeerUdpPort = up'} $ Pong ep 4 (time + 50) (Just ownTcpPort)
        -- A Ping's source address can be forged, so a Ping alone does not bond
        -- its sender: it is pinged back, and its Pong bonds it.
        pinged <- wasAsked AskPing ip
        unless (pPeerBondState peer == 2 || pinged) $ pingPeer peer{pPeerUdpPort = up'}
  Pong _ _ _ mOtherTcpPort -> do
    mPeer <- getPeerByIP' ip
    mPeer' <-
      case mPeer of
        Nothing -> do
          addPeer' otherUdpPort (fromMaybe (TCPPort 30303) mOtherTcpPort)
          getPeerByIP' ip
        Just p' -> do
          adopted <- adoptPeerKey p' otherPubKey
          if adopted
            then do
              for_ mOtherTcpPort $ updateTcpPort p'
              return $ Just p'
            else return Nothing
    for_ mPeer' $ \peer -> do
      eErr <- resetPeerUdp peer
      whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Pong" . T.pack $ "Unable to reset peer disable: " ++ show err
      eErr' <- setPeerBondingState (pPeerHost peer) otherPubKey 2
      whenLeft eErr' $ \err -> do
        $logErrorS "handleValidPacket" . T.pack $ "Unable to set peer bonding state: " ++ show err
        throwM err
  (FindNeighbors targetPubkey _) -> do
    time <- liftIO $ round `fmap` getPOSIXTime
    let nextTime = time + 50
    peers <- getPeersClosestTo (20 :: Natural) targetPubkey otherPubKey
    let theNeighbors = catMaybes $ (\p -> Neighbor (mkEndpoint p) <$> mkNodeId p) <$> peers
        UDPPort udpPort' = otherUdpPort
    void . sendPacket def{pPeerHost = host, pPeerIp = Just ip, pPeerUdpPort = udpPort'} $ Neighbors theNeighbors nextTime
    where
      mkEndpoint PPeer {..} = Endpoint (stringToIAddr $ hostToString pPeerHost) (UDPPort pPeerUdpPort) (TCPPort pPeerTcpPort)
      mkNodeId = fmap pointToNodeID . pPeerPubkey
  Neighbors neighbors _ -> do
    thePeer <- getPeerByIP' ip
    -- Neighbors only ever adds peers this node has not heard of. Anyone can send
    -- the packet, unasked, naming any IP with any node ID: if it could update a
    -- known peer, one packet would swap a validator's key for a made-up one, and
    -- the node would dial that validator with the wrong key until a restart.
    -- A node ID that is no public key is skipped too: dialing it can only fail.
    new <- filterM (\(Neighbor (Endpoint addr' _ _) nodeID) -> (isJust (nodeIdKey nodeID) &&) . not <$> doPeersExist [read $ format addr']) neighbors
    if null new
      then do
        $logInfoS "handleValidPacket/Neighbors" . T.pack $ "Got duplicate neighbors from " ++ show addr ++ ", lengthening peer UDP disable." ++ "\n"
        case thePeer of
          Nothing -> pure ()
          Just thePeer' -> do
            disErr <- storeDisableException thePeer' (T.pack "duplicateNeighbors")
            whenLeft disErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to store disable exception: " ++ show err
            eErr <- lengthenPeerDisable' thePeer'
            whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to disable peer: " ++ show err
      else do
        forM_ new $ \(Neighbor (Endpoint addr' (UDPPort udpPort) (TCPPort tcpPort)) nodeID) -> do
          $logDebugS "handleValidPacket/Neighbors" . T.pack $ "Got new neighbors: " ++ show new
          peer <- mkPeer (Just $ nodeIDToPoint nodeID) (Host $ T.pack $ format addr') Nothing (UDPPort udpPort) (TCPPort tcpPort)
          addPeer peer
        case thePeer of
          Nothing -> pure ()
          Just theP -> do
            eErr <- resetPeerUdp theP
            whenLeft eErr $ \err -> $logErrorS "handleValidPacket/Neighbors" . T.pack $ "Unable to reset peer disable: " ++ show err
  where
    ip = addressIP addr
    host = Host $ T.pack $ show ip
    addPeer' udpPort tcpPort = do
      peer <- mkPeer (Just otherPubKey) host (Just ip) udpPort tcpPort
      addPeer peer

-- | Store the key a peer signed a discovery packet with, unless the row holds a
-- current validator's key and this one differs. A validator's key is its
-- identity in the set, and a discovery packet proves only that its sender holds
-- the key it signed with, not that it is the validator at that address: the
-- source IP of a UDP packet can be forged.
-- Whether the row now holds @key@: False when it kept the one it had.
adoptPeerKey :: MonadDiscovery m => PPeer -> ECC.Point -> m Bool
adoptPeerKey peer key
  | pPeerPubkey peer == Just key = pure True
  | otherwise = do
      validators <- knownValidators
      if keepsHeldKey validators (pPeerPubkey peer) key
        then do
          $logWarnS "adoptPeerKey" . T.pack $ "Keeping the key held for " ++ show (pPeerHost peer) ++ "; a packet signed with another key claimed it"
          pure False
        else True <$ setPeerPubkey peer key

-- | Whether a peer row keeps the key it holds when a packet arrives signed with
-- @key@: when the held key differs and is a current validator's, or the
-- validator set could not be read (which is not an empty set). A row without a
-- key, or holding one that is no public key, takes the new one.
keepsHeldKey :: Maybe [Validator] -> Maybe ECC.Point -> ECC.Point -> Bool
keepsHeldKey validators held key = case held of
  Just h | h /= key, Just pub <- validKey h -> maybe True (Validator (fromPublicKey pub) `elem`) validators
  _ -> False

-- | The public key a point names, if it names one: discovery takes any 64 bytes
-- as a node ID, and converting one that is off the curve throws.
validKey :: ECC.Point -> Maybe Secp256k1.PublicKey
validKey p@(ECC.Point _ _) = Secp256k1.importPublicKey $ B.cons 0x04 (pointToBytes p)
validKey ECC.PointO = Nothing

-- | The key a node ID names, if it names a valid one.
nodeIdKey :: NodeID -> Maybe ECC.Point
nodeIdKey nodeID@(NodeID bs)
  | B.length bs == 64, Just _ <- validKey (nodeIDToPoint nodeID) = Just (nodeIDToPoint nodeID)
  | otherwise = Nothing

-- | The validators in force, or Nothing when they cannot be read (Redis down, or
-- no best sequenced block yet).
knownValidators :: MonadDiscovery m => m (Maybe [Validator])
knownValidators =
  (Mod.access (Mod.Proxy @[Validator]) >>= \vs -> liftIO (evaluate (length vs)) >> pure (Just vs))
    `catch` \(_ :: SomeException) -> pure Nothing

getAddrPort :: SockAddr -> Either DiscoverException PortNumber
getAddrPort (SockAddrInet portNumber _) = Right portNumber
getAddrPort (SockAddrInet6 portNumber _ _ _) = Right portNumber
getAddrPort s = Left . MissingPortException $ "No port number: " ++ show s
