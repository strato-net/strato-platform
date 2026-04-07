{-# LANGUAGE ConstraintKinds       #-}
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
    UDPPacket (..),
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
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Model.SyncState
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP       (processDataStream')
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Validator
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.SyncDB
import           Control.Exception                     hiding (catch)
import           Control.Monad                         (void)
import           Control.Monad.Catch                   hiding (bracket)
import qualified Control.Monad.Change.Alter            as A
import           Control.Monad.Change.Modify           (Accessible (..))
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Composable.Base
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import           Data.IP
import           Data.List
import           Data.Maybe
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL
import qualified Database.Redis                        as Redis
import           Network.Socket
import qualified Network.Socket.ByteString             as NB
import           System.Timeout

data ContextLite = ContextLite
  { liteSQLDB    :: SQLDB,
    redisBlockDB :: RBDB.RedisConnection,
    sock         :: Socket,
    myUdpPort    :: UDPPort,
    myTcpPort    :: TCPPort
  }

newtype UDPPacket = UDPPacket { getUDPPacket :: (B.ByteString, SockAddr) }

instance {-# OVERLAPPING #-} Monad m => Accessible SQLDB (ReaderT ContextLite m) where
  access _ = asks liteSQLDB

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT ContextLite m) where
  accessEnv = asks liteSQLDB

instance {-# OVERLAPPING #-} Monad m => Accessible Socket (ReaderT ContextLite m) where
  access _ = asks sock

instance {-# OVERLAPPING #-} Monad m => Accessible UDPPort (ReaderT ContextLite m) where
  access _ = asks myUdpPort

instance {-# OVERLAPPING #-} Monad m => Accessible TCPPort (ReaderT ContextLite m) where
  access _ = asks myTcpPort

instance {-# OVERLAPPING #-} Monad m => Accessible RBDB.RedisConnection (ReaderT ContextLite m) where
  access _ = asks redisBlockDB

instance {-# OVERLAPPING #-} MonadIO m => Accessible [Validator] (ReaderT ContextLite m) where
  access _ = do
    bestSequencedBlock <- fromMaybe (error "missing BestSequencedBlock in redis") <$> RBDB.withRedisBlockDB getBestSequencedBlockInfo
    return $ bestSequencedBlockValidators bestSequencedBlock

instance {-# OVERLAPPING #-} MonadUnliftIO m => A.Replaceable Host PPeer (ReaderT ContextLite m) where
  replace _ host peer = do
    maybePeer <- getPeerByIP host
    void . sqlQuery $ actions maybePeer
    where
      actions mp = case mp of
        Nothing -> SQL.insert peer
        Just peer' -> do
          SQL.update
            (SQL.entityKey peer')
            [ PPeerPubkey SQL.=. pPeerPubkey peer
            ]
          return (SQL.entityKey peer')
      getPeerByIP :: Host -> ReaderT ContextLite m (Maybe (SQL.Entity PPeer))
      getPeerByIP host' = listToMaybe <$> sqlQuery actions'
        where
          actions' = SQL.selectList [PPeerHost SQL.==. host'] []

instance {-# OVERLAPPING #-} MonadUnliftIO m => A.Selectable IP PPeer (ReaderT ContextLite m) where
  select _ = getPeerByIP
    where
      getPeerByIP :: IP -> ReaderT ContextLite m (Maybe PPeer)
      getPeerByIP ip' =
        sqlQuery actions >>= \case
          [] -> return Nothing
          --If multiple Hosts map to the same IP address, choose one arbitrarily, but prefer ones with domain names
          lst -> case sortOn (isIP . pPeerHost . SQL.entityVal) lst of
                   [] -> error "getPeerByIP: sortOn returned an empty list. This should be impossible"
                   (p:_) -> return . Just $ SQL.entityVal p
        where
          actions = SQL.selectList [PPeerIp SQL.==. Just ip'] []

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable SockAddr B.ByteString (ReaderT ContextLite m) where
  replace _ addr' packet = do
    sock' <- asks sock
    liftIO $ catch
      (void $ NB.sendTo sock' packet addr')
      (\(err :: IOError) -> runLoggingT . $logErrorS "NB.sendTo" . T.pack $ "Could not send data to " <> show addr' <> "; got error: " <> show err)

instance {-# OVERLAPPING #-} A.Selectable (Host, UDPPort, B.ByteString) Point IO where
  select _ (domain, UDPPort udpPortNum, theMsg) = catch
    (withSocketsDo $ bracket getSocket close (talk theMsg))
    (\(err :: IOError) -> runLoggingT ($logErrorS "withSocketsDo" . T.pack $ "Got error: " <> show err) >> return Nothing)
    where
      getSocket :: IO Socket
      getSocket = do
        (serveraddr : _) <- getAddrInfo
          (Just defaultHints {addrFlags = [AI_ALL]})
          (Just $ hostToString domain)
          (Just $ show udpPortNum)
        s <- socket (addrFamily serveraddr) Datagram defaultProtocol
        _ <- connect s (addrAddress serveraddr)
        return s
      talk :: B.ByteString -> Socket -> IO (Maybe Point)
      talk msg socket' = do
        _ <- NB.send socket' msg

        --According to https://groups.google.com/forum/#!topic/haskell-cafe/aqaoEDt7auY, it looks like the only way we can time out UDP recv is to
        --use the Haskell timeout....  I did try setting socket options also, but that didn't work.
        timeout 5000000 $ secPubKeyToPoint . processDataStream' <$> NB.recv socket' 2000

instance {-# OVERLAPPING #-} A.Selectable (Maybe Host, UDPPort) SockAddr IO where
  select _ (Nothing, UDPPort udpPortNum) = do
    fmap (fmap addrAddress . listToMaybe) $
      getAddrInfo
        (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
        Nothing
        (Just (show udpPortNum))
  select _ (Just ip, UDPPort udpPortNum) = do
    fmap (fmap addrAddress . listToMaybe) $ catch
      (getAddrInfo
        (Just defaultHints {addrFlags = [AI_ALL]})
        (Just $ hostToString ip)
        (Just $ show udpPortNum))
      (\(err :: IOError) -> runLoggingT ($logErrorS "getAddrInfo" . T.pack $ "Got error: " <> show err) >> return [])

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Host, UDPPort, B.ByteString) Point (ReaderT ContextLite m) where
  select p = liftIO . A.select p

instance {-# OVERLAPPING #-} MonadIO m => Mod.Awaitable UDPPacket (ReaderT ContextLite m) where
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
    Mod.Accessible [Validator] m,
    Mod.Awaitable UDPPacket m,
    A.Selectable (Maybe Host, UDPPort) SockAddr m
  )

initContextLite :: MonadUnliftIO m => UDPPort -> TCPPort -> m ContextLite
initContextLite udpPort tcpPort = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return
    ContextLite
      { liteSQLDB = sqlDB' dbs,
        redisBlockDB = RBDB.RedisConnection redisBDBPool,
        sock = error "initContextLite: Uninitialized socket",
        myUdpPort = udpPort,
        myTcpPort = tcpPort
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
