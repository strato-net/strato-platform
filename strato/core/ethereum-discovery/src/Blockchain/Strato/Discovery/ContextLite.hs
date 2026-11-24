{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DerivingStrategies    #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite (..),
    DiscoveryM (..),
    DiscoveryRow,
    runDiscoveryM,
    UDPPacket (..),
    Ask (..),
    Asked,
    noteAsked,
    askedFor,
    wasAsked,
    initContextLite,
    addPeer,
    DiscoveryRunner,
    MonadDiscovery,
    doPeersExist,
    getPeerByIP',
    lengthenPeerDisable',
  )
where

import           BlockApps.Logging
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Model.SyncState
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Validator
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.SyncDB
import           Control.Monad                         (void)
import           Control.Monad.Catch                   hiding (bracket)
import qualified Control.Monad.Change.Alter            as A
import           Control.Monad.Change.Modify           (Accessible (..))
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Composable.Base
import           Control.Monad.Composable.Vault
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import qualified Data.ByteString                       as B
import           Data.IORef
import           Data.IP
import           Data.List
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Time.Clock.POSIX                 (getPOSIXTime)
import qualified Database.Persist.Postgresql           as SQL
import qualified Database.Redis                        as Redis
import           Network.Socket
import qualified Network.Socket.ByteString             as NB
import           System.Timeout

data ContextLite = ContextLite
  { liteSQLDB    :: SQLDB,
    -- | Peers; the eth pool itself on a monolith.
    litePeerDB   :: SQLDB,
    redisBlockDB :: RBDB.RedisConnection,
    sock         :: Socket,
    myUdpPort    :: UDPPort,
    myTcpPort    :: TCPPort,
    liteAsked    :: Asked
  }

newtype UDPPacket = UDPPacket { getUDPPacket :: (B.ByteString, SockAddr) }

-- | The requests whose answers this node waits for.
data Ask = AskPing | AskNeighbors
  deriving (Eq, Ord)

-- | When this node last asked each address, by request, and what the answer
-- must carry. A Pong or a Neighbors is taken only from an address asked within
-- 'answerWindow', and only carrying that: a UDP source address can be forged,
-- and anyone can sign, so otherwise anyone could bond any address or fill the
-- peer table.
newtype Asked = Asked (IORef (M.Map (Ask, IP) (Integer, B.ByteString)))

-- | Seconds an answer is waited for: the expiration this node puts on its
-- requests.
answerWindow :: Integer
answerWindow = 50

-- | Record that @ip@ was just sent the request, and what its answer must carry:
-- the Ping's hash, which only a node that received the Ping can echo in its
-- Pong, or the key of the peer asked for neighbors, which signs its Neighbors.
noteAsked :: (MonadIO m, Accessible Asked m) => Ask -> IP -> B.ByteString -> m ()
noteAsked kind ip expected = do
  Asked ref <- access (Mod.Proxy @Asked)
  now <- liftIO $ round <$> getPOSIXTime
  liftIO . atomicModifyIORef' ref $ \asked ->
    (M.insert (kind, ip) (now, expected) $ M.filter ((> now - answerWindow) . fst) asked, ())

-- | What an answer from @ip@ must carry, when it was sent the request within
-- 'answerWindow'.
askedFor :: (MonadIO m, Accessible Asked m) => Ask -> IP -> m (Maybe B.ByteString)
askedFor kind ip = do
  Asked ref <- access (Mod.Proxy @Asked)
  now <- liftIO $ round <$> getPOSIXTime
  asked <- liftIO $ readIORef ref
  pure $ case M.lookup (kind, ip) asked of
    Just (at, expected) | at > now - answerWindow -> Just expected
    _ -> Nothing

-- | Whether @ip@ was sent the request within 'answerWindow'.
wasAsked :: (MonadIO m, Accessible Asked m) => Ask -> IP -> m Bool
wasAsked kind = fmap isJust . askedFor kind

-- | The discovery monad: 'ContextLite' over resources, the vault and the logger.
type DiscoveryRow = '[ReaderEnv ContextLite, InternalState, VaultData, Logger]

newtype DiscoveryM a = DiscoveryM {unDiscoveryM :: Eff DiscoveryRow a}
  deriving newtype (Functor, Applicative, Monad, MonadIO, MonadFail, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO, MonadReader ContextLite, MonadLogger, MonadLoggerIO, MonadResource, HasVault)

runDiscoveryM :: ContextLite -> DiscoveryM a -> Eff '[InternalState, VaultData, Logger] a
runDiscoveryM ctx (DiscoveryM m) = withReaderEnv ctx m

instance Accessible SQLDB DiscoveryM where
  access _ = asks liteSQLDB

instance AccessibleEnv SQLDB DiscoveryM where
  accessEnv = asks liteSQLDB

instance AccessibleEnv PeerStore DiscoveryM where
  accessEnv = asks (PeerStore . litePeerDB)

instance Accessible Socket DiscoveryM where
  access _ = asks sock

instance Accessible UDPPort DiscoveryM where
  access _ = asks myUdpPort

instance Accessible TCPPort DiscoveryM where
  access _ = asks myTcpPort

instance Accessible Asked DiscoveryM where
  access _ = asks liteAsked

instance Accessible RBDB.RedisConnection DiscoveryM where
  access _ = asks redisBlockDB

instance Accessible [Validator] DiscoveryM where
  access _ = do
    bestSequencedBlock <- fromMaybe (error "missing BestSequencedBlock in redis") <$> RBDB.withRedisBlockDB getBestSequencedBlockInfo
    return $ bestSequencedBlockValidators bestSequencedBlock

instance A.Replaceable Host PPeer DiscoveryM where
  replace _ host peer = do
    maybePeer <- getPeerByIP host
    void . peerQuery $ actions maybePeer
    where
      actions mp = case mp of
        Nothing -> SQL.insert peer
        Just peer' -> do
          SQL.update
            (SQL.entityKey peer')
            [ PPeerPubkey SQL.=. pPeerPubkey peer
            ]
          return (SQL.entityKey peer')
      getPeerByIP :: Host -> DiscoveryM (Maybe (SQL.Entity PPeer))
      getPeerByIP host' = listToMaybe <$> peerQuery actions'
        where
          actions' = SQL.selectList [PPeerHost SQL.==. host'] []

instance A.Selectable IP PPeer DiscoveryM where
  select _ = getPeerByIP
    where
      getPeerByIP :: IP -> DiscoveryM (Maybe PPeer)
      getPeerByIP ip' =
        peerQuery actions >>= \case
          [] -> return Nothing
          --If multiple Hosts map to the same IP address, choose one arbitrarily, but prefer ones with domain names
          lst -> case sortOn (isIP . pPeerHost . SQL.entityVal) lst of
                   [] -> error "getPeerByIP: sortOn returned an empty list. This should be impossible"
                   (p:_) -> return . Just $ SQL.entityVal p
        where
          actions = SQL.selectList [PPeerIp SQL.==. Just ip'] []

instance A.Replaceable SockAddr B.ByteString DiscoveryM where
  replace _ addr' packet = do
    sock' <- asks sock
    liftIO $ catch
      (void $ NB.sendTo sock' packet addr')
      (\(err :: IOError) -> runEff . runLogging . $logErrorS "NB.sendTo" . T.pack $ "Could not send data to " <> show addr' <> "; got error: " <> show err)

instance {-# OVERLAPPABLE #-} MonadIO m => A.Selectable (Maybe Host, UDPPort) SockAddr m where
  select _ (Nothing, UDPPort udpPortNum) = liftIO $ do
    fmap (fmap addrAddress . listToMaybe) $
      getAddrInfo
        (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
        Nothing
        (Just (show udpPortNum))
  select _ (Just ip, UDPPort udpPortNum) = liftIO $ do
    fmap (fmap addrAddress . listToMaybe) $ catch
      (getAddrInfo
        (Just defaultHints {addrFlags = [AI_ALL]})
        (Just $ hostToString ip)
        (Just $ show udpPortNum))
      (\(err :: IOError) -> (runEff . runLogging $ $logErrorS "getAddrInfo" . T.pack $ "Got error: " <> show err) >> return [])

instance Mod.Awaitable UDPPacket DiscoveryM where
  await = do
    sock' <- asks sock
    mPacket <- liftIO . timeout 10000000 $ NB.recvFrom sock' 80000
    pure $ UDPPacket <$> mPacket

type DiscoveryRunner n m a = (Int -> n a) -> m a

type MonadDiscovery m =
  ( HasVault m,
    HasPeerDB m,
    MonadFail m,
    MonadCatch m,
    MonadThrow m,
    MonadLogger m,
    MonadUnliftIO m,
    A.Selectable IP PPeer m,
    A.Replaceable Host PPeer m,
    A.Replaceable SockAddr B.ByteString m,
    Mod.Accessible UDPPort m,
    Mod.Accessible TCPPort m,
    Mod.Accessible Asked m,
    Mod.Accessible [Validator] m,
    Mod.Awaitable UDPPacket m,
    A.Selectable (Maybe Host, UDPPort) SockAddr m
  )

initContextLite :: MonadUnliftIO m => UDPPort -> TCPPort -> m ContextLite
initContextLite udpPort tcpPort = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  asked <- liftIO $ newIORef M.empty
  return
    ContextLite
      { liteSQLDB = sqlDB' dbs,
        litePeerDB = peerDB' dbs,
        redisBlockDB = RBDB.RedisConnection redisBDBPool,
        sock = error "initContextLite: Uninitialized socket",
        myUdpPort = udpPort,
        myTcpPort = tcpPort,
        liteAsked = Asked asked
      }

addPeer :: A.Replaceable Host PPeer m => PPeer -> m ()
addPeer peer = A.replace (A.Proxy @PPeer) (pPeerHost peer) peer

getPeerByIP' ::
  (A.Selectable IP PPeer m) =>
  IP ->
  m (Maybe PPeer)
getPeerByIP' = A.select (A.Proxy @PPeer)

doPeersExist :: (A.Selectable IP PPeer m) =>
                [IP] -> m Bool
doPeersExist peers = and <$> traverse doesPeerExist peers

doesPeerExist ::
  (A.Selectable IP PPeer m) =>
  IP ->
  m Bool
doesPeerExist peer = do
  maybePeer <- A.select (A.Proxy @PPeer) peer
  case maybePeer of
    Nothing -> pure False
    Just _  -> pure True
