{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
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
import           Control.Lens                          hiding (Context)
import qualified Control.Monad.Change.Modify           as Mod
import           Blockchain.Output
import           Control.Monad.Reader
import           Control.Monad.State.Strict
import qualified Data.Text                             as T
import           Data.Time.Clock

import           Blockchain.Data.Address
import           Blockchain.Data.BlockHeader
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Sequencer.Event            (IngestEvent (..))
import           Blockchain.Sequencer.Kafka            (writeUnseqEvents, UnseqSink)

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Stream.VMEvent             (HasVMEventsSink(..), VMEvent, produceVMEventsM)

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import qualified Database.Persist.Sql                  as SQL
import qualified Database.Redis                        as Redis
import qualified Network.Kafka                         as K
import qualified Blockchain.MilenaTools                as K

newtype Config = Config { configSQLDB :: SQLDB }

data Context = Context
  { contextRedisBlockDB   :: RBDB.RedisConnection
  , contextKafkaState     :: K.KafkaState
  , vmTrace               :: [String]
  , unseqSink             :: forall m . (MonadIO m, Mod.Modifiable K.KafkaState m) => [IngestEvent] -> m ()
  , vmEventsSink          :: forall m . (MonadIO m, Mod.Modifiable K.KafkaState m) => [VMEvent] -> m ()
  , blockHeaders          :: [BlockHeader]
  , remainingBlockHeaders :: [BlockHeader]
  , actionTimestamp       :: Maybe UTCTime
  , connectionTimeout     :: Int
  , maxReturnedHeaders    :: Int
  , _blockstanbulPeerAddr :: Maybe Address
  }

makeLenses ''Context

type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance Monad m => Mod.Modifiable K.KafkaState (StateT Context m) where
  get _   = gets contextKafkaState
  put _ k = get >>= \c -> put c{contextKafkaState = k}

instance MonadState Context m => Mod.Accessible RBDB.RedisConnection m where
  access _ = gets contextRedisBlockDB

instance MonadReader Config m => Mod.Accessible SQLDB m where
  access _ = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance (MonadIO m, MonadState Context m, Mod.Modifiable K.KafkaState m) => Mod.Accessible (UnseqSink m) m where
  access _ = gets unseqSink

instance (MonadState Context m, MonadIO m, Mod.Modifiable K.KafkaState m) => HasVMEventsSink m where
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
    db <- Mod.access (Mod.Proxy @SQLDB)
    SQL.runSqlPool actions db >>= \case
        [] -> return Nothing
        lst -> return . Just $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []

setPeerAddrIfUnset :: MonadState Context m => Address -> m ()
setPeerAddrIfUnset addr = blockstanbulPeerAddr %= alt
  where alt = \case -- strict alternative
          Just a -> Just a
          Nothing -> Just addr

shouldSendToPeer :: MonadState Context m => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg <$> use blockstanbulPeerAddr
        -- 0x0 is for a broadcast sync message.
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr
