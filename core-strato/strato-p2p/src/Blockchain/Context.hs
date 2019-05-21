{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TypeOperators        #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE Rank2Types           #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Context
    ( Context(..)
    , Config(..)
    , ContextM
    , initContext
    , runContextM
    , getDebugMsg
    , addDebugMsg
    , getBlockHeaders
    , putBlockHeaders
    , getRemainingBHeaders
    , putRemainingBHeaders
    , clearDebugMsg
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getPeerByIP
    , setPeerAddrIfUnset
    , shouldSendToPeer
    ) where


import           Conduit
import           Control.Applicative
import           Control.Lens                          hiding (Context)
import           Control.Monad.Change.Modify           hiding (get, put)
import           Blockchain.Output
import           Control.Monad.Reader
import           Control.Monad.State
import qualified Data.Text                             as T
import           Data.Time.Clock

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

newtype Config = Config { configSQLDB :: SQLDB }

data Context =
    Context {
        contextRedisBlockDB :: RBDB.RedisConnection,
        contextKafkaState   :: K.KafkaState,
        vmTrace             :: [String],
        unseqSink           :: forall m . (MonadIO m, Modifiable K.KafkaState m) => [IngestEvent] -> m (),
        vmEventsSink        :: forall m . (MonadIO m, Modifiable K.KafkaState m) => [VMEvent] -> m (),
        blockHeaders        :: [BlockHeader],
        remainingBlockHeaders :: [BlockHeader],
        actionTimestamp     :: Maybe UTCTime,
        connectionTimeout   :: Int,
        maxReturnedHeaders  :: Int,
        _blockstanbulPeerAddr :: Maybe Address
    }

makeLenses ''Context

type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance Context `Has` K.KafkaState where
  this _ = lens contextKafkaState (\c k -> c{contextKafkaState = k})

instance MonadState Context m => Accessible RBDB.RedisConnection m where
  access _ = gets contextRedisBlockDB

instance (MonadUnliftIO m, MonadReader Config m, MonadIO m) => HasSQLDB m where
  getSQLDB = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance (MonadState Context m, MonadIO m, Modifiable K.KafkaState m) => HasUnseqSink m where
  getUnseqSink = gets unseqSink

instance (MonadState Context m, MonadIO m, Modifiable K.KafkaState m) => HasVMEventsSink m where
  getVMEventsSink = gets vmEventsSink

getDebugMsg :: MonadState Context m => m String
getDebugMsg = concat . reverse . vmTrace <$> get

getBlockHeaders :: MonadState Context m => m [BlockHeader]
getBlockHeaders = blockHeaders <$> get

putBlockHeaders :: MonadState Context m => [BlockHeader]->m ()
putBlockHeaders headers = do
    cxt <- get
    put cxt{blockHeaders=headers}

getRemainingBHeaders :: MonadState Context m => m [BlockHeader]
getRemainingBHeaders = remainingBlockHeaders <$> get

putRemainingBHeaders :: MonadState Context m => [BlockHeader]->m ()
putRemainingBHeaders headers = do
    cxt <- get
    put cxt{remainingBlockHeaders=headers}

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

runContextM :: MonadUnliftIO m
            => (r, s)
            -> StateT s (ReaderT r (ResourceT m)) a
            -> m ()
runContextM (r, s) = void . runResourceT . flip runReaderT r . flip runStateT s

initContext :: ( MonadLogger m
               , MonadUnliftIO m
               )
            => Int -> m (Config, Context)
initContext maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return (Config (sqlDB' dbs),
         Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = RBDB.RedisConnection redisBDBPool
                 , contextKafkaState = mkConfiguredKafkaState "strato-p2p"
                 , blockHeaders=[]
                 , remainingBlockHeaders=[]
                 , unseqSink=void . K.withKafkaViolently . writeUnseqEvents
                 , vmEventsSink=void . produceVMEventsM
                 , vmTrace=[]
                 , connectionTimeout=flags_connectionTimeout
                 , maxReturnedHeaders = maxHeaders
                 , _blockstanbulPeerAddr = Nothing
                 })


getPeerByIP :: WrapsSQLDB t m
            => String
            -> (t m) (Maybe (SQL.Entity PPeer))
getPeerByIP ip = runWithSQL $ do
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
