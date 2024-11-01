{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.Data.Peer
  ( module Blockchain.Strato.Discovery.Metrics,
    module Blockchain.Strato.Discovery.Data.Peer,
  )
where

import Blockchain.DB.SQLDB (runSqlPool, withGlobalSQLPool)
import Blockchain.Data.PersistTypes ()
import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import Blockchain.MiscJSON ()
import Blockchain.Strato.Discovery.Metrics
import Blockchain.Strato.Model.Address (Address, fromPublicKey)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Util (byteString2Integer)
import Control.Exception hiding (try)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (sortBy)
import Data.Maybe (fromJust)
import qualified Data.Set as Set
import qualified Data.Text as T
import Data.Time
import Data.Time.Clock.POSIX
import qualified Database.Persist.Postgresql as SQL
import Database.Persist.TH
import GHC.Bits (xor)
import qualified LabeledError
import Network.URI (URI (..), URIAuth (..))
import qualified Network.URI as URI
import Prometheus
import Text.Format
import UnliftIO

share
  [mkPersist sqlSettings, mkMigrate "migrateAll"]
  [persistLowerCase|
PPeer
    pubkey Point Maybe
    ip T.Text
    tcpPort Int
    udpPort Int
    numSessions Int
    lastMsg T.Text
    lastMsgTime UTCTime
    enableTime UTCTime
    udpEnableTime UTCTime
    lastTotalDifficulty Integer
    lastBestBlockHash Keccak256
    bondState Int
    activeState Int
    version T.Text
    disableException T.Text
    nextDisableWindowSeconds Int default=5
    nextUdpDisableWindowSeconds Int default=5
    disableExpiration UTCTime default=now()
    deriving Show Read Eq
|]

newtype AvailablePeers = AvailablePeers {unAvailablePeers :: [PPeer]}

newtype IPAsText = IPAsText T.Text deriving (Eq, Ord)

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

newtype ValidatorAddresses = ValidatorAddresses {unValidatorAddresses :: [Address]}

type HasPeerDB m = (
  Mod.Accessible AvailablePeers m,
  A.Replaceable (IPAsText, TCPPort) ActivityState m,
  Mod.Accessible ActivePeers m,
  A.Replaceable (IPAsText, Point) PeerBondingState m,
  A.Selectable (IPAsText, Point) PeerBondingState m,
  Mod.Accessible BondedPeers m,
  Mod.Accessible BondedPeersForUDP m,
  Mod.Accessible UnbondedPeersForUDP m,
  A.Selectable Point ClosestPeers m,
  A.Replaceable PPeer UdpEnableTime m,
  A.Replaceable PPeer TcpEnableTime m,
  A.Replaceable PPeer PeerDisable m,
  A.Replaceable PPeer PeerUdpDisable m,
  A.Replaceable PPeer T.Text m,
  A.Replaceable T.Text PPeer m
  )

data PeerDisable
  = ExtendPeerDisableTime
      { epdtTcpEnableTime :: TcpEnableTime,
        epdtNextDisableWindowFactor :: Int
      }
  | SetPeerDisableTime
      { spdtTcpEnableTime :: TcpEnableTime,
        spdtNextDisableWindowSeconds :: Int,
        spdtDisableExpiration :: UTCTime
      }
  deriving (Eq, Ord)

data PeerUdpDisable
  = ExtendPeerUdpDisableTime
      { epdtUdpDisableTime :: UdpEnableTime,
        epdtNextUdpDisableWindowFactor :: Int
      }
  | SetPeerUdpDisableTime
      { epdtUdpDisableTime :: UdpEnableTime,
        spdtNextUdpDisableWindowSeconds :: Int,
        spdtUdpDisableExpiration :: UTCTime
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
pPeerString PPeer {..} = T.unpack pPeerIp ++ ":" ++ show pPeerTcpPort

jamshidBirth :: UTCTime
jamshidBirth = posixSecondsToUTCTime 0

createPeer :: String -> Either String PPeer
createPeer peerString = buildPeer <$> parseEnode peerString

buildPeer :: (Maybe String, String, Int) -> PPeer
buildPeer (mpk, ip, p) = buildPeerPoint (stringToPoint <$> mpk, ip, p)

buildPeerPoint :: (Maybe Point, String, Int) -> PPeer
buildPeerPoint (pubkeyMaybe, ip, p) =
  let peer =
        PPeer
          { pPeerPubkey = pubkeyMaybe,
            pPeerIp = T.pack ip,
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

parseEnode :: String -> Either String (Maybe String, String, Int)
parseEnode enode =
  case mUriAuth of
    Nothing -> Left $ "Invalid enode: " ++ enode
    (Just uriAuth) -> Right (parsePublicKey uriAuth, parseHostname uriAuth, parsePort uriAuth)
  where
    mUriAuth = URI.parseURI enode >>= validateURIScheme >>= URI.uriAuthority

validateURIScheme :: URI -> Maybe URI
validateURIScheme uri = case URI.uriScheme uri == "enode:" of
  True -> Just uri
  False -> Nothing

parsePublicKey :: URIAuth -> Maybe String
parsePublicKey uriAuth = case filter (/= '@') $ URI.uriUserInfo uriAuth of
  [] -> Nothing
  publicKey -> Just publicKey

parseHostname :: URIAuth -> String
parseHostname uriAuth = filter (\ch -> ch /= '[' && ch /= ']') (URI.uriRegName uriAuth)

parsePort :: URIAuth -> Int
parsePort uriAuth = LabeledError.read "Peer/parsePort" $ filter (/= ':') (URI.uriPort uriAuth)

getAvailablePeers :: (MonadUnliftIO m, Mod.Accessible AvailablePeers m) => m (Either SomeException [PPeer])
getAvailablePeers = try $ unAvailablePeers <$> Mod.access (Mod.Proxy @AvailablePeers)

setPeerActiveState ::
  (MonadUnliftIO m, MonadMonitor m, HasPeerDB m) =>
  T.Text ->
  Int ->
  ActivityState ->
  m (Either SomeException ())
setPeerActiveState ip port state = do
  recordStateChange state
  try $ A.replace (A.Proxy @ActivityState) (IPAsText ip, TCPPort port) state

getActivePeers :: (MonadUnliftIO m, Mod.Accessible ActivePeers m) => m (Either SomeException [PPeer])
getActivePeers = try $ unActivePeers <$> Mod.access (Mod.Proxy @ActivePeers)

setPeerBondingState ::
  (MonadUnliftIO m, A.Replaceable (IPAsText, Point) PeerBondingState m) =>
  String ->
  Point ->
  Int ->
  m (Either SomeException ())
setPeerBondingState ip point state = try $ A.replace (A.Proxy @PeerBondingState) (IPAsText $ T.pack ip, point) (PeerBondingState state)

getBondedPeers :: (MonadUnliftIO m, Mod.Accessible BondedPeers m) => m (Either SomeException [PPeer])
getBondedPeers = try $ unBondedPeers <$> Mod.access (Mod.Proxy @BondedPeers)

getBondedPeersForUDP :: (MonadUnliftIO m, Mod.Accessible BondedPeersForUDP m) => m (Either SomeException [PPeer])
getBondedPeersForUDP = try $ unBondedPeersForUDP <$> Mod.access (Mod.Proxy @BondedPeersForUDP)

getUnbondedPeers :: (MonadUnliftIO m, Mod.Accessible UnbondedPeersForUDP m) => m [PPeer]
getUnbondedPeers = unUnbondedPeers <$> Mod.access (Mod.Proxy @UnbondedPeersForUDP)

thisPeer :: PPeer -> [SQL.Filter PPeer]
thisPeer peer = [PPeerIp SQL.==. pPeerIp peer, PPeerTcpPort SQL.==. pPeerTcpPort peer]

thisOr100Years :: Int -> Int
thisOr100Years = min (100 * 365 * 24 * 60 * 60) -- there is no need to be disabling peers for > 100 years y'all

disableUDPPeerForSeconds ::
  (MonadUnliftIO m, A.Replaceable PPeer UdpEnableTime m) =>
  PPeer ->
  Int ->
  m (Either SomeException ())
disableUDPPeerForSeconds peer seconds = try $ do
  currentTime <- liftIO getCurrentTime
  if (currentTime < pPeerUdpEnableTime peer)
    then return ()
    else
      let seconds' = thisOr100Years seconds
          enableTime = UdpEnableTime $ fromIntegral seconds' `addUTCTime` currentTime
       in A.replace (A.Proxy @UdpEnableTime) peer enableTime

resetPeers :: IO ()
resetPeers = withGlobalSQLPool $ runSqlPool (SQL.updateWhere [] [PPeerActiveState SQL.=. 0])

nonviolentDisable ::
  (MonadUnliftIO m, A.Replaceable PPeer TcpEnableTime m) =>
  PPeer ->
  m (Either SomeException ())
nonviolentDisable peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let enableTime = TcpEnableTime $ 10 `addUTCTime` currentTime
  A.replace (A.Proxy @TcpEnableTime) peer' enableTime

-- The first time a peer is disabled, the timeout is five seconds. Every subsequent failure that
-- window is doubled, but those windows are reset every day. This prevents a mostly healthy node
-- from building up longer and longer disables, e.g. if it caused an exception once a day
-- by the end of the month it would be disabled for years.
lengthenPeerDisable ::
  (MonadUnliftIO m, A.Replaceable PPeer PeerDisable m) =>
  PPeer ->
  m (Either SomeException ())
lengthenPeerDisable = lengthenPeerDisableBy (24 * 60 * 60)

lengthenPeerDisableBy ::
  (MonadUnliftIO m, A.Replaceable PPeer PeerDisable m) =>
  NominalDiffTime ->
  PPeer ->
  m (Either SomeException ())
lengthenPeerDisableBy secs peer = try $ do
  currentTime <- liftIO getCurrentTime
  let disable = if (currentTime < pPeerDisableExpiration peer)
                then ExtendPeerDisableTime (TcpEnableTime $ fromIntegral (pPeerNextDisableWindowSeconds peer) `addUTCTime` currentTime) 2
                else SetPeerDisableTime (TcpEnableTime $ 5 `addUTCTime` currentTime) 5 (secs `addUTCTime` currentTime)
  A.replace (A.Proxy @PeerDisable) peer disable

-- A variation of 'lengthenPeerDisable' but for UDP instead, currently used for ethereum-discovery.
lengthenPeerDisable' ::
  (MonadUnliftIO m, A.Replaceable PPeer PeerUdpDisable m) =>
  PPeer ->
  m (Either SomeException ())
lengthenPeerDisable' peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let disable =
        if (currentTime < pPeerDisableExpiration peer')
          then 
            let seconds = thisOr100Years $ pPeerNextUdpDisableWindowSeconds peer'
            in ExtendPeerUdpDisableTime (UdpEnableTime $ fromIntegral seconds `addUTCTime` currentTime) 2
          else SetPeerUdpDisableTime (UdpEnableTime $ 5 `addUTCTime` currentTime) 5 ((24 * 60 * 60) `addUTCTime` currentTime)
  A.replace (A.Proxy @PeerUdpDisable) peer' disable

storeDisableException ::
  (MonadUnliftIO m, A.Replaceable PPeer T.Text m) =>
  PPeer ->
  T.Text ->
  m (Either SomeException ())
storeDisableException peer' e = try $ A.replace (A.Proxy) peer' e

getNumAvailablePeers :: (MonadUnliftIO m, Mod.Accessible AvailablePeers m) => m Int
getNumAvailablePeers = length . unAvailablePeers <$> Mod.access (Mod.Proxy @AvailablePeers) -- lolololol ever heard of SELECT COUNT

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
  ( A.Selectable Point ClosestPeers m
  , Mod.Accessible ValidatorAddresses m
  ) =>
  NodeID ->
  Point ->
  m [PPeer]
getPeersClosestTo targetNID requesterPubkey = do 
    peers <- maybe Set.empty (Set.fromDistinctAscList . unClosestPeers) <$> A.select (A.Proxy @ClosestPeers) requesterPubkey
    ValidatorAddresses valAdds <- Mod.access (Mod.Proxy @ValidatorAddresses)
    let targetPt = nodeIDToPoint targetNID
        (vals, nonvals) = Set.partition (\p -> (fromPublicKey . pointToSecPubKey . fromJust $ pPeerPubkey p) `elem` valAdds) peers
    return $
      Set.toList vals ++
      (take 20 . 
      sortBy (\peerA peerB -> compare (dist targetPt (pPeerPubkey peerA)) ((dist targetPt (pPeerPubkey peerB)))) $
      Set.toList nonvals)
      
  where 
    dist :: Point -> Maybe Point -> B.ByteString
    dist p1@(Point _ _) (Just p2@(Point _ _)) = -- xor of the points
      B.packZipWith xor (pointToBytes p1) (pointToBytes p2)
    dist _ _ = B.pack $ replicate 64 0xFF -- this case should never happen but just in case, make it the max distance possible

updateLastMessage ::
  (A.Replaceable T.Text PPeer m) =>
  T.Text ->
  PPeer ->
  m ()
updateLastMessage message peer = A.replace (A.Proxy @PPeer) message peer

resetPeerUdp ::
  (MonadUnliftIO m, A.Replaceable PPeer PeerUdpDisable m) =>
  PPeer ->
  m (Either SomeException ())
resetPeerUdp peer' = try $ A.replace (A.Proxy @PeerUdpDisable) peer' ResetPeerUdpDisable
