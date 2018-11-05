{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE Rank2Types           #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Context
    ( Context(..)
    , ContextM
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
    , addPeer
    , getPeerByIP
    , setPeerAddrIfUnset
    , shouldSendToPeer
    ) where


import           Conduit
import           Control.Applicative
import           Control.Lens                          hiding (Context)
import           Control.Monad.Logger
import           Control.Monad.State
import qualified Data.Text                             as T
import           Data.Time.Clock
import           Data.Void

import           Blockchain.Data.Address
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

data Context =
    Context {
        contextSQLDB        :: SQLDB,
        contextRedisBlockDB :: Redis.Connection,
        contextKafkaState   :: K.KafkaState,
        vmTrace             :: [String],
        unseqSink           :: forall m . (MonadIO m, K.HasKafkaState m) => ConduitM [IngestEvent] Void m (),
        vmEventsSink        :: forall m . (MonadIO m, K.HasKafkaState m, HasSQLDB m) => ConduitM [VMEvent] Void m (),
        blockHeaders        :: [BlockHeader],
        actionTimestamp     :: Maybe UTCTime,
        connectionTimeout   :: Int,
        maxReturnedHeaders  :: Int,
        _blockstanbulPeerAddr :: Maybe Address
    }

makeLenses ''Context

type ContextM = StateT Context (ResourceT (LoggingT IO))

instance {-# OVERLAPPING #-} (MonadState Context m) => K.HasKafkaState m where
    getKafkaState = contextKafkaState <$> get
    putKafkaState s = do
      ctx <- get
      put $ ctx { contextKafkaState = s }

instance (Monad m, MonadState Context m) => RBDB.HasRedisBlockDB m where
    getRedisBlockDB = contextRedisBlockDB <$> get

instance (MonadResource m, MonadBaseControl IO m, MonadState Context m, MonadIO m) => HasSQLDB m where
  getSQLDB = contextSQLDB <$> get

instance (MonadState Context m, MonadIO m) => HasUnseqSink m where
  getUnseqSink = gets unseqSink

instance (MonadState Context m, MonadIO m, HasSQLDB m) => HasVMEventsSink m where
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

runContextM :: (MonadBaseControl IO m, MonadThrow m, MonadIO m)
            => s
            -> StateT s (ResourceT m) a
            -> m ()
runContextM s f = void . runResourceT $ runStateT f s

initContext :: (MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m)
            => Int -> m Context
initContext maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = redisBDBPool
                 , contextKafkaState = mkConfiguredKafkaState "strato-p2p"
                 , contextSQLDB = sqlDB' dbs
                 , blockHeaders=[]
                 , unseqSink=mapM_C (void . K.withKafkaViolently . writeUnseqEvents) .| sinkNull
                 , vmEventsSink=mapM_C (void . produceVMEventsM) .| sinkNull
                 , vmTrace=[]
                 , connectionTimeout=flags_connectionTimeout
                 , maxReturnedHeaders = maxHeaders
                 , _blockstanbulPeerAddr = Nothing
                 }



addPeer :: (HasSQLDB m, MonadResource m, MonadBaseControl IO m, MonadThrow m)
        => PPeer
        -> m (SQL.Key PPeer)
addPeer peer = do
  db <- getSQLDB
  maybePeer <- getPeerByIP (T.unpack $ pPeerIp peer)
  SQL.runSqlPool (actions maybePeer) db
  where actions = \case
            Nothing    -> SQL.insert peer
            Just peer' -> do
              SQL.update (SQL.entityKey peer') [PPeerPubkey SQL.=.(pPeerPubkey peer)]
              return (SQL.entityKey peer')

getPeerByIP :: (HasSQLDB m, MonadResource m, MonadBaseControl IO m, MonadThrow m)
            => String
            -> m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
    db <- getSQLDB
    SQL.runSqlPool actions db >>= \case
        [] -> return Nothing
        lst -> return . Just $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []

setPeerAddrIfUnset :: MonadState Context m => Address -> m ()
setPeerAddrIfUnset addr = blockstanbulPeerAddr %= (<|> Just addr)

shouldSendToPeer :: MonadState Context m => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg <$> use blockstanbulPeerAddr
        -- TODO(tim): 0x0 may come from a Legacy kafka message, remove
        -- in a future release
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr
