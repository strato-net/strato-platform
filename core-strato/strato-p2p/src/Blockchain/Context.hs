{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE Rank2Types           #-}
{-# LANGUAGE RankNTypes           #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Context
    ( Context(..)
    , ContextM
    , ConfigM
    , initContext
    , runContextM
    , getDebugMsg
    , addDebugMsg
    , getBlockHeaders
    , putBlockHeaders
    , clearDebugMsg
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getPeerByIP
    ) where


import           Conduit
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import qualified Data.Text                             as T
import           Data.Time.Clock
import           Data.Void

import           Blockchain.Data.BlockHeader
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Sequencer.Event            (IngestEvent (..))
import           Blockchain.Sequencer.Kafka            (writeUnseqEvents, HasUnseqSink(..))

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Stream.VMEvent             (HasVMEventsSink(..), VMEvent, produceVMEventsM)

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import qualified Database.Persist.Sql                  as SQL
import qualified Database.Redis                        as Redis
import qualified Network.Kafka                         as K
import qualified Blockchain.MilenaTools                as K

newtype P2PConfig = P2PConfig {
                    configSQLDB :: SQLDB
                  }

data Context =
    Context {
        contextRedisBlockDB :: Redis.Connection,
        contextKafkaState   :: K.KafkaState,
        vmTrace             :: [String],
        unseqSink           :: forall m . (MonadIO m, K.HasKafkaState m) => Conduit [IngestEvent] m Void,
        vmEventsSink        :: forall m . (MonadIO m, K.HasKafkaState m) => Conduit [VMEvent] m Void,
        blockHeaders        :: [BlockHeader],
        actionTimestamp     :: Maybe UTCTime,
        connectionTimeout   :: Int,
        maxReturnedHeaders  :: Int
    }

type ConfigM = ReaderT P2PConfig (ResourceT (LoggingT IO))
-- type ConfigM a = ReaderT P2PConfig (ResourceT (LoggingT IO))

instance (MonadUnliftIO m, MonadIO m, MonadBaseControl IO m, MonadReader P2PConfig m) => HasSQLDB m where
  getSQLDB = asks configSQLDB

type ContextM = StateT Context ConfigM

instance {-# OVERLAPPING #-} (MonadState Context m) => K.HasKafkaState m where
    getKafkaState = contextKafkaState <$> get
    putKafkaState s = do
      ctx <- get
      put $ ctx { contextKafkaState = s }

instance (Monad m, MonadState Context m) => RBDB.HasRedisBlockDB m where
    getRedisBlockDB = contextRedisBlockDB <$> get

instance (MonadState Context m, MonadIO m) => HasUnseqSink m where
  getUnseqSink = gets unseqSink

instance (MonadState Context m, MonadIO m) => HasVMEventsSink m where
  getVMEventsSink = gets vmEventsSink

getDebugMsg :: MonadState Context m => m String
getDebugMsg = concat . reverse . vmTrace <$> get

getBlockHeaders :: MonadState Context m => m [BlockHeader]
getBlockHeaders = blockHeaders <$> get

putBlockHeaders :: MonadState Context m => [BlockHeader]->m ()
putBlockHeaders headers = do
    cxt <- get
    put cxt{blockHeaders=headers}

addDebugMsg :: MonadState Context m => String->m ()
addDebugMsg msg = do
    cxt <- get
    put cxt{vmTrace=msg:vmTrace cxt}

clearDebugMsg :: MonadState Context m => m ()
clearDebugMsg = do
    cxt <- get
    put cxt{vmTrace=[]}

stampActionTimestamp :: (MonadIO m, MonadState Context m) => m ()
stampActionTimestamp = do
    cxt <- get
    ts <- liftIO getCurrentTime
    put cxt{actionTimestamp=Just ts}

getActionTimestamp :: MonadState Context m => m (Maybe UTCTime)
getActionTimestamp = actionTimestamp <$> get

clearActionTimestamp :: MonadState Context m => m ()
clearActionTimestamp = do
    cxt <- get
    put cxt{actionTimestamp=Nothing}

runContextM :: (MonadUnliftIO m, MonadBaseControl IO m)
            => P2PConfig
            -> Context
            -> StateT Context (ReaderT P2PConfig (ResourceT m)) a
            -> m ()
runContextM cfg cxt = void
                    . runConfigM cfg
                    . flip runStateT cxt

runConfigM :: (MonadUnliftIO m, MonadBaseControl IO m)
           => P2PConfig -> ReaderT P2PConfig (ResourceT m) a -> m a
runConfigM cfg = runResourceT . flip runReaderT cfg


initContext :: (MonadResource m, MonadUnliftIO m, MonadLogger m, MonadBaseControl IO m, Monad m)
            => Int -> m (P2PConfig, Context)
initContext maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return (P2PConfig $ sqlDB' dbs,
          Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = redisBDBPool
                 , contextKafkaState = mkConfiguredKafkaState "strato-p2p"
                 , blockHeaders=[]
                 , unseqSink=mapM_C (void . K.withKafkaViolently . writeUnseqEvents) .| sinkNull
                 , vmEventsSink=mapM_C (void . produceVMEventsM) .| sinkNull
                 , vmTrace=[]
                 , connectionTimeout=flags_connectionTimeout
                 , maxReturnedHeaders = maxHeaders
                 })

getPeerByIP :: (HasSQLDB m, MonadResource m, MonadThrow m)
            => String
            -> m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
    db <- getSQLDB
    SQL.runSqlPool actions db >>= \case
        [] -> return Nothing
        lst -> return . Just $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []

