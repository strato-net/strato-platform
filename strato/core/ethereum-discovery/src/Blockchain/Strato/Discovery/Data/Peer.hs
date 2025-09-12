{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}



module Blockchain.Strato.Discovery.Data.Peer
  (
    HasPeerDB(..),
    TCPPort(..),
    UDPPort(..),
    NodeID(..),
    PeerUdpDisable(..),
    PeerDisable(..),
    UdpEnableTime(..),
    TcpEnableTime(..),
    ActivePeers(..),
    AvailablePeers(..),
    PeerBondingState(..),
    BondedPeers(..),
    BondedPeersForUDP(..),
    ClosestPeers(..),
    UnbondedPeersForUDP(..),
    PeerLastBestBlockHash(..),
    createPeer,
    pointToNodeID,
    nodeIDToPoint,
    thisPeer,
    lengthenPeerDisable',
    resetPeerUdp,
    getPeersClosestTo,
    disableUDPPeerForSeconds,
    jamshidBirth,
    lengthenPeerDisableBy,
    pPeerString,
    nonviolentDisable,
    resetPeers,
    addressIP,
    module Blockchain.Strato.Discovery.Metrics,
    module Blockchain.Strato.Discovery.Data.PeerDefinition
  )
where

import           BlockApps.Logging
import           Blockchain.Data.PersistTypes                    ()
import           Blockchain.Data.PubKey
import           Blockchain.Data.RLP
import           Blockchain.DB.SQLDB                             (runSqlPool,
                                                                  withGlobalSQLPool)
import           Blockchain.MiscJSON                             ()
import           Blockchain.Strato.Discovery.Data.PeerDefinition
import           Blockchain.Strato.Discovery.Metrics
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Util                    (byteString2Integer)
import           Blockchain.Strato.Model.Validator
import           Control.Exception                               hiding (try)
import qualified Control.Monad.Change.Modify                     as Mod
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                                 as B
import qualified Data.ByteString.Base16                          as B16
import qualified Data.ByteString.Char8                           as BC
import           Data.IP
import           Data.List                                       (sortBy)
import qualified Data.Set                                        as Set
import           Data.String
import qualified Data.Text                                       as T
import           Data.Time
import           Data.Time.Clock.POSIX
import qualified Database.Persist.Postgresql                     as SQL
import           GHC.Bits                                        (xor)
import qualified LabeledError
import           Network.Socket
import           Network.URI                                     (URI (..),
                                                                  URIAuth (..))
import qualified Network.URI                                     as URI
import           Numeric.Natural
import           Text.Format
import           UnliftIO

newtype AvailablePeers = AvailablePeers {unAvailablePeers :: [PPeer]}

newtype TCPPort = TCPPort Int deriving (Show, Read, Eq, Ord)

newtype UDPPort = UDPPort Int deriving (Show, Read, Eq, Ord)

newtype ActivePeers = ActivePeers {unActivePeers :: [PPeer]}

newtype PeerBondingState = PeerBondingState {unPeerBondingState :: Int}

newtype BondedPeers = BondedPeers {unBondedPeers :: [PPeer]}

newtype BondedPeersForUDP = BondedPeersForUDP {unBondedPeersForUDP :: [PPeer]}

newtype UnbondedPeersForUDP = UnbondedPeersForUDP {unUnbondedPeers :: [PPeer]}

newtype ClosestPeers = ClosestPeers {unClosestPeers :: [PPeer]}

newtype UdpEnableTime = UdpEnableTime UTCTime deriving (Eq, Ord)

newtype TcpEnableTime = TcpEnableTime UTCTime deriving (Eq, Ord)

newtype NodeID = NodeID B.ByteString deriving (Show, Read, Eq)

newtype PeerLastBestBlockHash = PeerLastBestBlockHash { unPeerLastBestBlockHash :: Keccak256 }

class HasPeerDB m where
  getNumAvailablePeers :: m Int
  setPeerActiveState :: Host -> Int -> ActivityState -> m ()
  getActivePeers :: m (Either SomeException [PPeer])
  setPeerBondingState :: Host -> Point -> Int -> m (Either SomeException ())
  getPeerBondingState :: Host -> Point -> m (Maybe Int)
  getBondedPeers :: m (Either SomeException [PPeer])
  getBondedPeersForUDP :: m (Either SomeException [PPeer])
  getUnbondedPeers :: m [PPeer]
  getClosestPeers :: Point -> Natural -> m [PPeer]

  updateUdpEnableTime :: PPeer -> UTCTime -> m ()
  updateIP :: PPeer -> IP -> m ()
  updateTcpEnableTime :: PPeer -> UTCTime -> m ()
  updatePeerDisable :: PPeer -> PeerDisable -> m ()
  updatePeerLastBestBlockHash :: PPeer -> PeerLastBestBlockHash -> m ()
  updatePeerUdpDisable :: PPeer -> PeerUdpDisable -> m ()
  setPeerPubkey :: PPeer -> Point -> m ()
  storeDisableException :: PPeer -> T.Text -> m (Either SomeException ())
  updateLastMessage :: PPeer -> T.Text -> m ()

  resetAllPeerTimeouts :: m ()

data PeerDisable
  = ExtendPeerDisableTime
      { epdtTcpEnableTime           :: TcpEnableTime,
        epdtNextDisableWindowFactor :: Int
      }
  | SetPeerDisableTime
      { spdtTcpEnableTime            :: TcpEnableTime,
        spdtNextDisableWindowSeconds :: Int,
        spdtDisableExpiration        :: UTCTime
      }
  deriving (Eq, Ord)

data PeerUdpDisable
  = ExtendPeerUdpDisableTime
      { epdtUdpDisableTime             :: UdpEnableTime,
        epdtNextUdpDisableWindowFactor :: Int
      }
  | SetPeerUdpDisableTime
      { epdtUdpDisableTime              :: UdpEnableTime,
        spdtNextUdpDisableWindowSeconds :: Int,
        spdtUdpDisableExpiration        :: UTCTime
      }
  | ResetPeerUdpDisable
  deriving (Eq, Ord)

instance RLPSerializable NodeID where
  rlpEncode (NodeID x) = RLPString x
  rlpDecode (RLPString x) = NodeID x
  rlpDecode x = error $ "unsupported rlp in rlpDecode for NodeID: " ++ show x

instance Format NodeID where
  format (NodeID x) = BC.unpack (B16.encode $ B.take 10 x) ++ "...."

pPeerString :: PPeer -> String
pPeerString PPeer {..} = hostToString pPeerHost ++ ":" ++ show pPeerTcpPort

jamshidBirth :: UTCTime
jamshidBirth = posixSecondsToUTCTime 0

createPeer :: String -> Either String PPeer
createPeer peerString = buildPeer <$> parseEnode peerString

buildPeer :: (Maybe String, Host, Int) -> PPeer
buildPeer (mpk, host, p) = buildPeerPoint (stringToPoint <$> mpk, host, p)

buildPeerPoint :: (Maybe Point, Host, Int) -> PPeer
buildPeerPoint (pubkeyMaybe, host, p) =
  let peer =
        PPeer
          { pPeerPubkey = pubkeyMaybe,
            pPeerHost = host,
            pPeerIp = Nothing,
            pPeerUdpPort = p,
            pPeerTcpPort = 30303,
            pPeerNumSessions = 0,
            pPeerLastTotalDifficulty = 0,
            pPeerLastMsg = T.pack "msg",
            pPeerLastMsgTime = jamshidBirth,
            pPeerEnableTime = jamshidBirth,
            pPeerUdpEnableTime = jamshidBirth,
            pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0,
            pPeerBondState = 0,
            pPeerActiveState = 0,
            pPeerVersion = T.pack "61", -- fix
            pPeerDisableException = T.pack "None",
            pPeerNextDisableWindowSeconds = 5,
            pPeerNextUdpDisableWindowSeconds = 5,
            pPeerDisableExpiration = jamshidBirth
          }
   in peer

parseEnode :: String -> Either String (Maybe String, Host, Int)
parseEnode enode =
  case mUriAuth of
    Nothing -> Left $ "Invalid enode: " ++ enode
    (Just uriAuth) -> Right (parsePublicKey uriAuth, parseHostname uriAuth, parsePort uriAuth)
  where
    mUriAuth = URI.parseURI enode >>= validateURIScheme >>= URI.uriAuthority

validateURIScheme :: URI -> Maybe URI
validateURIScheme uri =
  if URI.uriScheme uri == "enode:"
  then Just uri
  else Nothing

parsePublicKey :: URIAuth -> Maybe String
parsePublicKey uriAuth = case filter (/= '@') $ URI.uriUserInfo uriAuth of
  []        -> Nothing
  publicKey -> Just publicKey

parseHostname :: URIAuth -> Host
parseHostname uriAuth = fromString $ filter (\ch -> ch /= '[' && ch /= ']') (URI.uriRegName uriAuth)

parsePort :: URIAuth -> Int
parsePort uriAuth = LabeledError.read "Peer/parsePort" $ filter (/= ':') (URI.uriPort uriAuth)

thisPeer :: PPeer -> [SQL.Filter PPeer]
thisPeer peer = [PPeerHost SQL.==. pPeerHost peer, PPeerTcpPort SQL.==. pPeerTcpPort peer]

thisOr100Years :: Int -> Int
thisOr100Years = min (100 * 365 * 24 * 60 * 60) -- there is no need to be disabling peers for > 100 years y'all

disableUDPPeerForSeconds ::
  (MonadUnliftIO m, HasPeerDB m) =>
  PPeer ->
  Int ->
  m (Either SomeException ())
disableUDPPeerForSeconds peer seconds = try $ do
  currentTime <- liftIO getCurrentTime
  if currentTime < pPeerUdpEnableTime peer
    then return ()
    else
      let seconds' = thisOr100Years seconds
          enableTime = fromIntegral seconds' `addUTCTime` currentTime
       in updateUdpEnableTime peer enableTime

resetPeers :: IO ()
resetPeers = withGlobalSQLPool $ runSqlPool (SQL.updateWhere [] [PPeerActiveState SQL.=. 0])

nonviolentDisable ::
  (MonadUnliftIO m, HasPeerDB m) =>
  PPeer ->
  m (Either SomeException ())
nonviolentDisable peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let enableTime = 10 `addUTCTime` currentTime
  updateTcpEnableTime peer' enableTime

-- The first time a peer is disabled, the timeout is five seconds. Every subsequent failure that
-- window is doubled, but those windows are reset every day. This prevents a mostly healthy node
-- from building up longer and longer disables, e.g. if it caused an exception once a day
-- by the end of the month it would be disabled for years.
lengthenPeerDisableBy ::
  (MonadUnliftIO m, HasPeerDB m) =>
  NominalDiffTime ->
  PPeer ->
  m (Either SomeException ())
lengthenPeerDisableBy secs peer = try $ do
  currentTime <- liftIO getCurrentTime
  let disable = if currentTime < pPeerDisableExpiration peer
                then ExtendPeerDisableTime (TcpEnableTime $ fromIntegral (pPeerNextDisableWindowSeconds peer) `addUTCTime` currentTime) 2
                else SetPeerDisableTime (TcpEnableTime $ 5 `addUTCTime` currentTime) 5 (secs `addUTCTime` currentTime)
  updatePeerDisable peer disable

-- A variation of 'lengthenPeerDisable' but for UDP instead, currently used for ethereum-discovery.
lengthenPeerDisable' ::
  (MonadUnliftIO m, HasPeerDB m) =>
  PPeer ->
  m (Either SomeException ())
lengthenPeerDisable' peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let disable =
        if currentTime < pPeerDisableExpiration peer'
          then
            let seconds = thisOr100Years $ pPeerNextUdpDisableWindowSeconds peer'
            in ExtendPeerUdpDisableTime (UdpEnableTime $ fromIntegral seconds `addUTCTime` currentTime) 2
          else SetPeerUdpDisableTime (UdpEnableTime $ 5 `addUTCTime` currentTime) 5 ((24 * 60 * 60) `addUTCTime` currentTime)
  updatePeerUdpDisable peer' disable

nodeIDToPoint :: NodeID -> Point
nodeIDToPoint (NodeID nodeID) | B.length nodeID /= 64 = error "NodeID contains a bytestring that is not 64 bytes long"
nodeIDToPoint (NodeID nodeID) = Point x y
  where
    x = byteString2Integer $ B.take 32 nodeID
    y = byteString2Integer $ B.drop 32 nodeID

pointToNodeID :: Point -> NodeID
pointToNodeID PointO = error "called pointToNodeID with PointO, we can't handle that yet"
pointToNodeID (Point x y) = NodeID $ word256ToBytes (fromInteger x) <> word256ToBytes (fromInteger y)

getPeersClosestTo ::
  ( MonadLogger m
  , HasPeerDB m
  , Mod.Accessible [Validator] m
  ) =>
  Natural ->
  NodeID ->
  Point ->
  m [PPeer]
getPeersClosestTo limit targetNID requesterPubkey = do
    peers <- Set.fromDistinctAscList <$> getClosestPeers requesterPubkey limit
    $logInfoS "getPeersClosestTo" $ T.pack $ "peer list: " ++ show peers
    validators <- Mod.access (Mod.Proxy @[Validator])
    $logInfoS "getPeersClosestTo" $ T.pack $ "adding validator list to closest peers: " ++ show validators
    let targetPt = nodeIDToPoint targetNID
        (vals, nonvals) = Set.partition (\p -> (Validator . fromPublicKey . pointToSecPubKey <$> pPeerPubkey p) `elem` map Just validators) peers
    return $
      Set.toList vals ++
      (take (fromIntegral limit) .
      sortBy (\peerA peerB -> compare (dist targetPt (pPeerPubkey peerA)) (dist targetPt (pPeerPubkey peerB))) $
      Set.toList nonvals)

  where
    dist :: Point -> Maybe Point -> B.ByteString
    dist p1@(Point _ _) (Just p2@(Point _ _)) = -- xor of the points
      B.packZipWith xor (pointToBytes p1) (pointToBytes p2)
    dist _ _ = B.pack $ replicate 64 0xFF -- this case should never happen but just in case, make it the max distance possible

resetPeerTimeouts :: Monad m =>
                     m ()
resetPeerTimeouts = do
  return ()

resetPeerUdp ::
  (MonadUnliftIO m, HasPeerDB m) =>
  PPeer ->
  m (Either SomeException ())
resetPeerUdp peer' = try $ updatePeerUdpDisable peer' ResetPeerUdpDisable

addressIP :: SockAddr -> IP
addressIP (SockAddrInet _ addr)      = IPv4 (fromHostAddress addr)
addressIP (SockAddrInet6 _ _ addr _) = IPv6 (fromHostAddress6 addr)
addressIP _                          = error "Unsupported address type"

