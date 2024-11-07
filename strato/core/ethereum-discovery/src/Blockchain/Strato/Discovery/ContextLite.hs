{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite (..),
    initContextLite,
    addPeer,
    DiscoveryRunner,
    MonadDiscovery,
    doPeersExist,
    getPeerByIP',
    lengthenPeerDisable',
  )
where

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.DBM
import Blockchain.Data.PubKey (secPubKeyToPoint)
import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.UDP (processDataStream')
import Blockchain.Strato.Model.Secp256k1
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Control.Concurrent (threadDelay)
import Control.Exception hiding (catch)
import Control.Monad (void)
import Control.Monad.Catch hiding (bracket)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Modify (Accessible (..))
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Reader
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import Data.Maybe (listToMaybe)
import qualified Data.Text as T
import qualified Database.Persist.Postgresql as SQL
import qualified Database.Redis as Redis
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Network.Socket
import qualified Network.Socket.ByteString as NB
import Servant.Client
import qualified Strato.Strato23.API as VC
import qualified Strato.Strato23.Client as VC
import System.Timeout

data ContextLite = ContextLite
  { liteSQLDB :: SQLDB,
    redisBlockDB :: RBDB.RedisConnection,
    vaultClient :: ClientEnv,
    sock :: Socket,
    myUdpPort :: UDPPort,
    myTcpPort :: TCPPort
  }

instance Monad m => Accessible SQLDB (ReaderT ContextLite m) where
  access _ = asks liteSQLDB

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT ContextLite m) where
  accessEnv = asks liteSQLDB

instance Monad m => Accessible Socket (ReaderT ContextLite m) where
  access _ = asks sock

instance Monad m => Accessible UDPPort (ReaderT ContextLite m) where
  access _ = asks myUdpPort

instance Monad m => Accessible TCPPort (ReaderT ContextLite m) where
  access _ = asks myTcpPort

instance Monad m => Accessible RBDB.RedisConnection (ReaderT ContextLite m) where
  access _ = asks redisBlockDB
  
instance MonadIO m => Accessible ValidatorAddresses (ReaderT ContextLite m) where
  access _ = RBDB.withRedisBlockDB $ ValidatorAddresses <$> RBDB.getValidatorAddresses

instance MonadUnliftIO m => A.Replaceable IPAsText PPeer (ReaderT ContextLite m) where
  replace _ (IPAsText ip) peer = do
    maybePeer <- getPeerByIP $ T.unpack ip
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
      getPeerByIP :: String -> ReaderT ContextLite m (Maybe (SQL.Entity PPeer))
      getPeerByIP ipStr = listToMaybe <$> sqlQuery actions'
        where
          actions' = SQL.selectList [PPeerIp SQL.==. T.pack ipStr] []

instance MonadUnliftIO m => A.Selectable String PPeer (ReaderT ContextLite m) where
  select _ ip = getPeerByIP ip
    where
      getPeerByIP :: String -> ReaderT ContextLite m (Maybe PPeer)
      getPeerByIP ipStr =
        sqlQuery actions >>= \case
          [] -> return Nothing
          lst -> return . Just . SQL.entityVal $ head lst
        where
          actions = SQL.selectList [PPeerIp SQL.==. T.pack ipStr] []

instance MonadIO m => A.Replaceable SockAddr B.ByteString (ReaderT ContextLite m) where
  replace _ addr packet = do
    sock' <- asks sock
    liftIO $ catch 
      (void $ NB.sendTo sock' packet addr) 
      (\(err :: IOError) -> runLoggingT . $logErrorS "NB.sendTo" . T.pack $ "Could not send data to " <> show addr <> "; got error: " <> show err)

instance A.Selectable (IPAsText, UDPPort, B.ByteString) Point IO where
  select _ (IPAsText domain, UDPPort udpPortNum, theMsg) = catch
    (withSocketsDo $ bracket getSocket close (talk theMsg))
    (\(err :: IOError) -> runLoggingT ($logErrorS "withSocketsDo" . T.pack $ "Got error: " <> show err) >> return Nothing)
    where
      getSocket :: IO Socket
      getSocket = do
        (serveraddr : _) <- getAddrInfo 
          (Just defaultHints {addrFlags = [AI_ALL]})
          (Just $ T.unpack domain)
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

instance MonadIO m => A.Selectable (Maybe IPAsText, UDPPort) SockAddr (ReaderT ContextLite m) where
  select _ (Nothing, UDPPort udpPortNum) = do
    fmap (fmap addrAddress . listToMaybe) . liftIO $
      getAddrInfo
        (Just (defaultHints {addrFlags = [AI_PASSIVE]}))
        Nothing
        (Just (show udpPortNum))
  select _ (Just (IPAsText ip), UDPPort udpPortNum) = do
    fmap (fmap addrAddress . listToMaybe) . liftIO $ catch
      (getAddrInfo
        (Just defaultHints {addrFlags = [AI_ALL]})
        (Just $ T.unpack ip)
        (Just $ show udpPortNum))
      ((\(err :: IOError) -> runLoggingT ($logErrorS "getAddrInfo" . T.pack $ "Got error: " <> show err) >> return []))

instance MonadIO m => A.Selectable (IPAsText, UDPPort, B.ByteString) Point (ReaderT ContextLite m) where
  select p = liftIO . A.select p

instance MonadIO m => A.Selectable () (B.ByteString, SockAddr) (ReaderT ContextLite m) where
  select _ _ = do
    sock' <- asks sock
    liftIO . timeout 10000000 $ NB.recvFrom sock' 80000

instance (Monad m, MonadIO m, MonadLogger m) => HasVault (ReaderT ContextLite m) where
  sign msg = do
    vc <- asks vaultClient
    $logInfoS "HasVault" "asking vault-proxy for a message signature"
    waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash msg)) vc

  getPub = do
    vc <- asks vaultClient
    $logInfoS "HasVault" "asking vault-proxy for the node's public key"
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey Nothing Nothing) vc

  getShared _ = error "called HasVault's getShared in ethereum-discovery, but this should never happen"

type DiscoveryRunner n m a = (Int -> n a) -> m a

type MonadDiscovery m =
  ( HasVault m,
    HasPeerDB m,
    MonadFail m,
    MonadCatch m,
    MonadThrow m,
    MonadLogger m,
    MonadUnliftIO m,
    A.Selectable String PPeer m,
    A.Selectable () (B.ByteString, SockAddr) m,
    A.Replaceable IPAsText PPeer m,
    A.Replaceable SockAddr B.ByteString m,
    Mod.Accessible UDPPort m,
    Mod.Accessible TCPPort m,
    Mod.Accessible ValidatorAddresses m,
    A.Selectable (Maybe IPAsText, UDPPort) SockAddr m
  )

waitOnVault :: (MonadIO m, MonadLogger m, Show a) => m (Either a b) -> m b
waitOnVault action = do
  res <- action
  case res of
    Left err -> do
      $logErrorS "HasVault" . T.pack $ "vault-proxy returned an error: " ++ show err
      liftIO $ threadDelay $ 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val

initContextLite :: MonadUnliftIO m => String -> UDPPort -> TCPPort -> m ContextLite
initContextLite vaultUrl udpPort tcpPort = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  mgr <- liftIO $ newManager defaultManagerSettings
  url <- liftIO $ parseBaseUrl vaultUrl
  return
    ContextLite
      { liteSQLDB = sqlDB' dbs,
        redisBlockDB = RBDB.RedisConnection redisBDBPool,
        vaultClient = mkClientEnv mgr url,
        sock = error "initContextLite: Uninitialized socket",
        myUdpPort = udpPort,
        myTcpPort = tcpPort
      }

addPeer :: A.Replaceable IPAsText PPeer m => PPeer -> m ()
addPeer peer = A.replace (A.Proxy @PPeer) (IPAsText $ pPeerIp peer) peer

getPeerByIP' ::
  (A.Selectable String PPeer m) =>
  String ->
  m (Maybe PPeer)
getPeerByIP' ip = A.select (A.Proxy @PPeer) ip

doPeersExist ::
  (A.Selectable String PPeer m) =>
  [String] ->
  m (Bool)
doPeersExist peers = do
  maybePeer <- traverse doesPeerExist peers
  pure $ all (== True) maybePeer

doesPeerExist ::
  (A.Selectable String PPeer m) =>
  String ->
  m (Bool)
doesPeerExist peer = do
  maybePeer <- A.select (A.Proxy @PPeer) peer
  case maybePeer of
    Nothing -> pure False
    Just _ -> pure True
