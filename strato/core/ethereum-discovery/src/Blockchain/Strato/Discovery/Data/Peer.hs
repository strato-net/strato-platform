{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DerivingStrategies         #-}
{-# LANGUAGE FlexibleContexts           #-} {-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE NoDeriveAnyClass           #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE StandaloneDeriving         #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeApplications           #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE UndecidableInstances       #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}
  
module Blockchain.Strato.Discovery.Data.Peer
  ( module Blockchain.Strato.Discovery.Metrics
  , module Blockchain.Strato.Discovery.Data.Peer
  ) where

import           Control.Exception            hiding (try)
import qualified Control.Monad.Change.Alter   as A
import qualified Control.Monad.Change.Modify  as Mod
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Char8        as BC
import qualified Data.Text                    as T
import           Data.Time
import           Data.Time.Clock.POSIX
import qualified Database.Persist.Postgresql  as SQL
import           Database.Persist.TH
import           Network.URI                  (URI (..), URIAuth (..))
import qualified Network.URI                  as URI


import           Blockchain.Data.Enode
import           Blockchain.Data.PersistTypes ()
import           Blockchain.Data.PubKey
import           Blockchain.Data.RLP
import           Blockchain.DB.SQLDB          (runSqlPool, withGlobalSQLPool)
import           Blockchain.MiscJSON          ()
import           Blockchain.Strato.Discovery.Metrics
import           Blockchain.Strato.Model.Keccak256
import           Prometheus
import           UnliftIO
import           Text.Format

import qualified LabeledError

share [mkPersist sqlSettings, mkMigrate "migrateAll"] [persistLowerCase|
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
    nextDisableWindowSeconds Int default=5
    disableExpiration UTCTime default=now()
    ~enode Enode Maybe
    deriving Show Read Eq
|]

newtype AvailablePeers = AvailablePeers { unAvailablePeers :: [PPeer] }
newtype IPAsText = IPAsText T.Text deriving (Eq, Ord)
newtype TCPPort = TCPPort Int deriving (Show, Read, Eq, Ord)
newtype UDPPort = UDPPort Int deriving (Show, Read, Eq, Ord)
newtype ActivePeers = ActivePeers { unActivePeers :: [PPeer] }
newtype PeerBondingState = PeerBondingState { unPeerBondingState :: Int }
newtype BondedPeers = BondedPeers { unBondedPeers :: [PPeer] }
newtype BondedPeersForUDP = BondedPeersForUDP { unBondedPeersForUDP :: [PPeer] }
newtype UnbondedPeers = UnbondedPeers { unUnbondedPeers :: [PPeer] }
newtype ClosestPeers = ClosestPeers { unClosestPeers :: [PPeer] }
newtype UdpEnableTime = UdpEnableTime UTCTime
newtype TcpEnableTime = TcpEnableTime UTCTime deriving (Eq, Ord)
newtype NodeID = NodeID B.ByteString deriving (Show, Read, Eq)

data PeerDisable =
    ExtendPeerDisableTime
    { epdtTcpEnableTime :: TcpEnableTime
    , epdtNextDisableWindowFactor :: Int
    }
  | SetPeerDisableTime
    { spdtTcpEnableTime :: TcpEnableTime
    , spdtNextDisableWindowSeconds :: Int
    , spdtDisableExpiration :: UTCTime
    }
  deriving (Eq, Ord)

instance RLPSerializable NodeID where
  rlpEncode (NodeID x) = RLPString x
  rlpDecode (RLPString x) = NodeID x
  rlpDecode x             = error $ "unsupported rlp in rlpDecode for NodeID: " ++ show x

instance Format NodeID where
  format (NodeID x) = BC.unpack (B16.encode $ B.take 10 x) ++ "...."

instance Mod.Accessible AvailablePeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- liftIO getCurrentTime
    fmap (AvailablePeers . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [PPeerEnableTime SQL.<. currentTime] []

instance (A.Replaceable (IPAsText, TCPPort) ActivityState) IO where
  replace _ (IPAsText ip, TCPPort port) state = withGlobalSQLPool . runSqlPool $ do
    SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
                    [PPeerActiveState SQL.=. fromEnum state]

instance Mod.Accessible ActivePeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (ActivePeers . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [PPeerActiveState SQL.==. fromEnum Active, PPeerEnableTime SQL.<. currentTime] []
  
instance (A.Replaceable (IPAsText, UDPPort) PeerBondingState) IO where
  replace _ (IPAsText ip, UDPPort port) (PeerBondingState state) = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerIp SQL.==. ip, PPeerUdpPort SQL.==. port] [PPeerBondState SQL.=. state]

instance Mod.Accessible BondedPeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeers . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

instance Mod.Accessible BondedPeersForUDP IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeersForUDP . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime] []

instance Mod.Accessible UnbondedPeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (UnbondedPeers . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [PPeerBondState SQL.==. 0, PPeerEnableTime SQL.<. currentTime] []

instance A.Selectable IPAsText ClosestPeers IO where
  select _ (IPAsText requesterIP) = withGlobalSQLPool $ \sqldb ->
    fmap (Just . ClosestPeers . map SQL.entityVal) $ flip runSqlPool sqldb $
      SQL.selectList [ PPeerIp SQL.!=. requesterIP, PPeerPubkey SQL.!=. Nothing] []

instance A.Replaceable PPeer UdpEnableTime IO where
  replace _ peer' (UdpEnableTime enableTime) = withGlobalSQLPool $ \sqldb -> do
    -- TODO(tim): Reenable port selection
    let peer = peer'{pPeerTcpPort=30303}
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerUdpEnableTime SQL.=. enableTime]

instance A.Replaceable PPeer TcpEnableTime IO where
  replace _ peer' (TcpEnableTime enableTime) = withGlobalSQLPool $ \sqldb -> do
    -- TODO(tim): Reenable port selection
    let peer = peer'{pPeerTcpPort=30303}
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerEnableTime SQL.=. enableTime]

instance A.Replaceable PPeer PeerDisable IO where
  replace _ peer d = withGlobalSQLPool $ \sqldb -> do
    let selector = thisPeer peer
    flip runSqlPool sqldb $ case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        SQL.updateWhere selector [PPeerEnableTime SQL.=. enableTime
                                 , PPeerNextDisableWindowSeconds SQL.*=. nextDisableWindowFactor
                                 ]
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        SQL.updateWhere selector [ PPeerEnableTime SQL.=. enableTime
                                 , PPeerNextDisableWindowSeconds SQL.=. nextDisableWindow
                                 , PPeerDisableExpiration SQL.=. disableExpiration
                                 ]

pPeerString :: PPeer -> String
pPeerString PPeer{..} = T.unpack pPeerIp ++ ":" ++ show pPeerTcpPort

jamshidBirth::UTCTime
jamshidBirth = posixSecondsToUTCTime 0

createPeer :: String -> Either String PPeer
createPeer peerString = buildPeer <$> parseEnode peerString

-- TODO(tim): Reenable port selection
buildPeer :: (Maybe String, String, Int) -> PPeer
buildPeer (mpk, ip, p) = buildPeerPoint (stringToPoint <$> mpk, ip, p)

buildPeerPoint :: (Maybe Point, String, Int) -> PPeer
buildPeerPoint (pubkeyMaybe, ip, _) =
  let peer = PPeer {
        pPeerPubkey = pubkeyMaybe,
        pPeerIp = T.pack ip,
        pPeerUdpPort = 30303, --TODO think about this....  Should the UDP port be the same as the TCP port by default?
        pPeerTcpPort = 30303,
        pPeerNumSessions = 0,
        pPeerLastTotalDifficulty = 0,
        pPeerLastMsg  = T.pack "msg",
        pPeerLastMsgTime = jamshidBirth,
        pPeerEnableTime = jamshidBirth,
        pPeerUdpEnableTime = jamshidBirth,
        pPeerLastBestBlockHash = unsafeCreateKeccak256FromWord256 0,
        pPeerBondState=0,
        pPeerActiveState = 0,
        pPeerVersion = T.pack "61", -- fix
        pPeerNextDisableWindowSeconds = 5,
        pPeerDisableExpiration = jamshidBirth,
        pPeerEnode = peerToEnode peer
        }
  in peer

parseEnode :: String -> Either String (Maybe String, String, Int)
parseEnode enode =
    case mUriAuth of
        Nothing        -> Left $ "Invalid enode: " ++ enode
        (Just uriAuth) -> Right (parsePublicKey uriAuth, parseHostname uriAuth, parsePort uriAuth)
    where
        mUriAuth = URI.parseURI enode >>= validateURIScheme >>= URI.uriAuthority

validateURIScheme :: URI -> Maybe URI
validateURIScheme uri = case URI.uriScheme uri == "enode:" of
    True  -> Just uri
    False -> Nothing

parsePublicKey :: URIAuth -> Maybe String
parsePublicKey uriAuth = case filter (/= '@') $ URI.uriUserInfo uriAuth of
    []        -> Nothing
    publicKey -> Just publicKey

parseHostname :: URIAuth -> String
parseHostname uriAuth = filter (\ch -> ch /= '[' && ch /= ']') (URI.uriRegName uriAuth)

parsePort :: URIAuth -> Int
parsePort uriAuth = LabeledError.read "Peer/parsePort" $ filter (/= ':') (URI.uriPort uriAuth)


getAvailablePeers :: (MonadUnliftIO m, Mod.Accessible AvailablePeers m) => m (Either SomeException [PPeer])
getAvailablePeers = try $ unAvailablePeers <$> Mod.access (Mod.Proxy @AvailablePeers)


setPeerActiveState :: (MonadUnliftIO m, MonadMonitor m, A.Replaceable (IPAsText, TCPPort) ActivityState m)
                   => T.Text -> Int -> ActivityState -> m (Either SomeException ())
setPeerActiveState ip port state = do
  recordStateChange state
  try $ A.replace (A.Proxy @ActivityState) (IPAsText ip, TCPPort port) state

getActivePeers :: (MonadUnliftIO m, Mod.Accessible ActivePeers m) => m (Either SomeException [PPeer])
getActivePeers = try $ unActivePeers <$> Mod.access (Mod.Proxy @ActivePeers)

setPeerBondingState :: (MonadUnliftIO m, A.Replaceable (IPAsText, UDPPort) PeerBondingState m)
                    => String -> Int -> Int -> m (Either SomeException ())
setPeerBondingState ip port state = try $ A.replace (A.Proxy @PeerBondingState) (IPAsText $ T.pack ip, UDPPort port) (PeerBondingState state)

getBondedPeers :: (MonadUnliftIO m, Mod.Accessible BondedPeers m) => m (Either SomeException [PPeer])
getBondedPeers = try $ unBondedPeers <$> Mod.access (Mod.Proxy @BondedPeers)

getBondedPeersForUDP :: (MonadUnliftIO m, Mod.Accessible BondedPeersForUDP m) => m (Either SomeException [PPeer])
getBondedPeersForUDP = try $ unBondedPeersForUDP <$> Mod.access (Mod.Proxy @BondedPeersForUDP)

getUnbondedPeers :: (MonadUnliftIO m, Mod.Accessible UnbondedPeers m) => m [PPeer]
getUnbondedPeers = unUnbondedPeers <$> Mod.access (Mod.Proxy @UnbondedPeers)

thisPeer :: PPeer -> [SQL.Filter PPeer]
thisPeer peer = [PPeerIp SQL.==. pPeerIp peer, PPeerTcpPort SQL.==. pPeerTcpPort peer]

disableUDPPeerForSeconds :: (MonadUnliftIO m, A.Replaceable PPeer UdpEnableTime m)
                         => PPeer -> Int -> m (Either SomeException ())
disableUDPPeerForSeconds peer seconds = try $ do
  currentTime <- liftIO getCurrentTime
  let enableTime = UdpEnableTime $ fromIntegral seconds `addUTCTime` currentTime
  A.replace (A.Proxy @UdpEnableTime) peer enableTime

resetPeers :: IO ()
resetPeers = withGlobalSQLPool $ runSqlPool (SQL.updateWhere [] [PPeerActiveState SQL.=. 0])

nonviolentDisable :: (MonadUnliftIO m, A.Replaceable PPeer TcpEnableTime m)
                  => PPeer -> m (Either SomeException ())
nonviolentDisable peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let enableTime = TcpEnableTime $ 10 `addUTCTime` currentTime
  A.replace (A.Proxy @TcpEnableTime) peer' enableTime

-- The first time a peer is disabled, the timeout is five seconds. Every subsequent failure that
-- window is doubled, but those windows are reset every day. This prevents a mostly healthy node
-- from building up longer and longer disables, e.g. if it caused an exception once a day
-- by the end of the month it would be disabled for years.
lengthenPeerDisable :: (MonadUnliftIO m, A.Replaceable PPeer PeerDisable m)
                    => PPeer -> m (Either SomeException ())
lengthenPeerDisable peer' = try $ do
  currentTime <- liftIO getCurrentTime
  let peer = peer'{pPeerTcpPort=30303}
      disable = if (currentTime < pPeerDisableExpiration peer)
                  then ExtendPeerDisableTime (TcpEnableTime $ fromIntegral (pPeerNextDisableWindowSeconds peer) `addUTCTime` currentTime) 2
                  else SetPeerDisableTime (TcpEnableTime $ 5 `addUTCTime` currentTime) 5 ((24 * 60 * 60) `addUTCTime` currentTime)
  A.replace (A.Proxy @PeerDisable) peer disable

-- TODO: Allow an empty public key in the Enode type
peerToEnode :: PPeer -> Maybe Enode
peerToEnode peer = (\pk -> Enode (OrgId $ pointToBytes pk)
                                 (readIP . T.unpack $ pPeerIp peer)
                                 (pPeerTcpPort peer)
                                 (Just $ pPeerUdpPort peer)) <$> pPeerPubkey peer

getNumAvailablePeers :: (MonadUnliftIO m, Mod.Accessible AvailablePeers m) => m Int
getNumAvailablePeers = length . unAvailablePeers <$> Mod.access (Mod.Proxy @AvailablePeers) -- lolololol ever heard of SELECT COUNT

-- todo: respect the requester's target. also is this basically getClosePeers?s
getPeersClosestTo :: (MonadUnliftIO m, A.Selectable IPAsText ClosestPeers m)
                  => NodeID -> T.Text -> Point -> m [PPeer]
getPeersClosestTo _ requesterIP _ = take 20 . maybe [] unClosestPeers <$> A.select (A.Proxy @ClosestPeers) (IPAsText requesterIP)