{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE Rank2Types           #-}
{-# LANGUAGE RankNTypes           #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE ConstraintKinds      #-}
{-# OPTIONS -fno-warn-orphans     #-}
module Blockchain.Context
    ( Context(..)
    , HasContext
    , HasContextControl
    , ContextM
    , runContextM
    , getDebugMsg
    , addDebugMsg
    , getBlockHeaders
    , putBlockHeaders
    , clearDebugMsg
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getMaxHeaders
    , getConnectionTimeout
    , setPeerAddrIfUnset
    , shouldSendToPeer
    ) where


import           Conduit
import           Control.Applicative
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           UnliftIO.IORef
import           Data.Time.Clock

import           Blockchain.Data.Address
import           Blockchain.Data.BlockHeader
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Sequencer.Event            (IngestEvent (..))
import           Blockchain.Sequencer.Kafka            (writeUnseqEvents, HasUnseqSink(..))

import           Blockchain.Stream.VMEvent             (HasVMEventsSink(..), VMEvent, produceVMEventsM)

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import qualified Database.Redis                        as Redis
import qualified Network.Kafka                         as K
import qualified Blockchain.MilenaTools                as K

data Context =
    Context {
        contextSQLDB        :: SQLDB,
        contextRedisBlockDB :: Redis.Connection,
        contextKafkaState   :: IORef K.KafkaState,
        vmTrace             :: IORef [String],
        unseqSink           :: forall m . (MonadIO m, K.HasKafkaState m) => [IngestEvent] -> m (),
        vmEventsSink        :: forall m . (MonadIO m, K.HasKafkaState m) => [VMEvent] -> m (),
        blockHeaders        :: IORef [BlockHeader],
        actionTimestamp     :: IORef (Maybe UTCTime),
        connectionTimeout   :: Int,
        maxReturnedHeaders  :: Int,
        blockstanbulPeerAddr :: IORef (Maybe Address)
    }

type ContextM = ReaderT Context (ResourceT (LoggingT IO))

type HasContext m = (MonadReader Context m, MonadIO m, Monad m, MonadResource m)
type HasContextControl m = (HasContext m, MonadUnliftIO m, MonadBaseControl IO m)

instance (HasContextControl m) => HasSQLDB m where
  getSQLDB = asks contextSQLDB

instance HasContext m => K.HasKafkaState m where
    getKafkaState = readIORef =<< asks contextKafkaState
    putKafkaState s = flip writeIORef s =<< asks contextKafkaState

instance HasContext m => RBDB.HasRedisBlockDB m where
    getRedisBlockDB = asks contextRedisBlockDB

instance HasContext m => HasUnseqSink m where
  getUnseqSink = asks unseqSink

instance HasContext m => HasVMEventsSink m where
  getVMEventsSink = asks vmEventsSink

readerRef :: HasContext m => (Context -> IORef a) -> m a
readerRef f = readIORef =<< asks f

getDebugMsg :: HasContext m => m String
getDebugMsg = concat . reverse <$> readerRef vmTrace

getBlockHeaders :: HasContext m => m [BlockHeader]
getBlockHeaders = readerRef blockHeaders

putBlockHeaders :: HasContext m => [BlockHeader]->m ()
putBlockHeaders headers = flip writeIORef headers =<< asks blockHeaders

addDebugMsg :: HasContext m => String->m ()
addDebugMsg msg = do
    ref <- asks vmTrace
    atomicModifyIORef' ref (\t -> (msg:t, ()))

clearDebugMsg :: HasContext m => m ()
clearDebugMsg = flip writeIORef [] =<< asks vmTrace

stampActionTimestamp :: HasContext m => m ()
stampActionTimestamp = do
    ref <- asks actionTimestamp
    ts <- liftIO getCurrentTime
    writeIORef ref (Just ts)

getActionTimestamp ::HasContext m => m (Maybe UTCTime)
getActionTimestamp = readerRef actionTimestamp

clearActionTimestamp :: HasContext m => m ()
clearActionTimestamp = flip writeIORef Nothing =<< asks actionTimestamp

getMaxHeaders :: HasContext m => m Int
getMaxHeaders = asks maxReturnedHeaders

getConnectionTimeout :: HasContext m => m NominalDiffTime
getConnectionTimeout = asks (fromIntegral . connectionTimeout)

runContextM :: (MonadUnliftIO m, MonadBaseControl IO m, MonadThrow m)
            => Int
            -> ReaderT Context (ResourceT m) a
            -> m ()
runContextM maxHeaders act = void . runResourceT $ do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  ts <- newIORef Nothing
  ks <- newIORef $ mkConfiguredKafkaState "strato-p2p"
  bhs <- newIORef []
  vm <- newIORef []
  peer <- newIORef Nothing
  runReaderT act Context { contextSQLDB = sqlDB' dbs
                         , actionTimestamp = ts
                         , contextRedisBlockDB = redisBDBPool
                         , contextKafkaState = ks
                         , blockHeaders=bhs
                         , unseqSink=void . K.withKafkaViolently . writeUnseqEvents
                         , vmEventsSink=void . produceVMEventsM
                         , vmTrace=vm
                         , connectionTimeout=flags_connectionTimeout
                         , maxReturnedHeaders = maxHeaders
                         , blockstanbulPeerAddr = peer
                         }


setPeerAddrIfUnset :: HasContext m => Address -> m ()
setPeerAddrIfUnset addr = do
  bref <- asks blockstanbulPeerAddr
  atomicModifyIORef bref $ \ma -> (ma <|> Just addr, ())

shouldSendToPeer :: HasContext m => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg <$> join (asks (readIORef . blockstanbulPeerAddr))
        -- TODO(tim): 0x0 may come from a Legacy kafka message, remove
        -- in a future release
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr
