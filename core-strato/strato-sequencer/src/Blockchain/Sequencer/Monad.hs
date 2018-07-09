{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}
module Blockchain.Sequencer.Monad (
    SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , runSequencerM
  , getKafkaClientID
  , getKafkaConsumerGroup
  , clearLdbBatchOps
  , addLdbBatchOps
) where

import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Stats
import           Control.Monad.Trans.Resource

import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S

import           Blockchain.Constants
import qualified Blockchain.EthConf                        as EC
import           Blockchain.ExtWord                        (Word256)
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Blockchain.StatsConf

import           System.Directory                          (createDirectoryIfMissing)

import qualified Database.LevelDB                          as LDB
import qualified Network.Kafka                             as K
import qualified Blockchain.MilenaTools                    as K
import qualified Network.Kafka.Protocol                    as KP

type SequencerM  = StateT SequencerContext (ReaderT SequencerConfig (StatsT (ResourceT (LoggingT IO))))

instance (MonadLogger m) => MonadLogger (StatsT m) where
    monadLoggerLog a b c d = lift $ monadLoggerLog a b c d

instance (MonadResource m) => MonadResource (StatsT m) where
    liftResourceT = lift . liftResourceT

data SequencerContext = SequencerContext
                      { dependentBlockDB    :: DependentBlockDB
                      , seenBlockDB         :: SeenBlockDB
                      , seenTransactionDB   :: SeenTransactionDB
                      , privateHashDB       :: PrivateHashDB
                      , getChainsDB         :: S.Set Word256
                      , getTransactionsDB   :: S.Set SHA
                      , ldbBatchOps         :: Q.Seq LDB.BatchOp
                      , vmEvents            :: Q.Seq OutputEvent
                      , p2pEvents           :: Q.Seq OutputEvent
                      , sequencerKafkaState :: K.KafkaState
                      }

data SequencerConfig =
     SequencerConfig { depBlockDBCacheSize   :: Int
                     , depBlockDBPath        :: String
                     , seenTransactionDBSize :: Int
                     , kafkaAddress          :: Maybe K.KafkaAddress
                     , kafkaClientId         :: K.KafkaClientId
                     , kafkaConsumerGroup    :: KP.ConsumerGroup
                     , syncWrites            :: Bool
                     , bootstrapDoEmit       :: Bool
                     , statsConfig           :: Maybe StatsConf
                     }


instance HasDependentBlockDB SequencerM where
    getDependentBlockDB = dependentBlockDB <$> get
    getWriteOptions     = LDB.WriteOptions . syncWrites <$> ask
    getReadOptions      = return LDB.defaultReadOptions

instance HasGetChainsDB SequencerM where
    getGetChainsDB = getChainsDB <$> get
    putGetChainsDB new = do
        ctx <- get
        put $ ctx { getChainsDB = new }

instance HasGetTransactionsDB SequencerM where
    getGetTransactionsDB = getTransactionsDB <$> get
    putGetTransactionsDB new = do
        ctx <- get
        put $ ctx { getTransactionsDB = new }

instance HasPrivateHashDB SequencerM where
    getPrivateHashDB = privateHashDB <$> get
    putPrivateHashDB new = do
        ctx <- get
        put $ ctx { privateHashDB = new }

instance HasSeenBlockDB SequencerM where
    getSeenBlockDB = seenBlockDB <$> get
    putSeenBlockDB new = do
        ctx <- get
        put $ ctx { seenBlockDB = new }

instance HasSeenTransactionDB SequencerM where
    getSeenTransactionDB = seenTransactionDB <$> get
    putSeenTransactionDB new = do
        ctx <- get
        put $ ctx { seenTransactionDB = new }

instance K.HasKafkaState SequencerM where
    getKafkaState = sequencerKafkaState <$> get
    putKafkaState newS = do
        ctx <- get
        put $ ctx { sequencerKafkaState = newS }

runSequencerM :: SequencerConfig -> SequencerM a -> (LoggingT IO) a
runSequencerM c m = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    a <- runResourceT . EC.runStatsT (statsConfig c) . flip runReaderT c $ do
        dbCS     <- asks depBlockDBCacheSize
        dbPath   <- asks depBlockDBPath
        stxSize  <- asks seenTransactionDBSize
        kClId    <- asks kafkaClientId
        mAddr    <- asks kafkaAddress
        depBlock <- LDB.open dbPath LDB.defaultOptions { LDB.createIfMissing = True, LDB.cacheSize=dbCS }
        let kState = case mAddr of
                         Nothing -> EC.mkConfiguredKafkaState kClId
                         Just addr -> K.mkKafkaState kClId addr

        runStateT m SequencerContext
            { dependentBlockDB    = depBlock
            , seenBlockDB         = mkSeenBlockDB stxSize
            , seenTransactionDB   = mkSeenTxDB stxSize
            , privateHashDB       = emptyPrivateHashDB
            , getChainsDB         = S.empty
            , getTransactionsDB   = S.empty
            , ldbBatchOps         = Q.empty
            , vmEvents            = Q.empty
            , p2pEvents           = Q.empty
            , sequencerKafkaState = kState
            }
    return $ fst a

clearLdbBatchOps :: SequencerM ()
clearLdbBatchOps = modify (\st -> st{ldbBatchOps = Q.empty})

addLdbBatchOps :: [LDB.BatchOp] -> SequencerM ()
addLdbBatchOps ops = do
  st <- get
  let existingOps = ldbBatchOps st
      go e [] = e
      go e (o:os) = go (e Q.|> o) os
      newOps = go existingOps ops
  put st{ldbBatchOps = newOps}

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask

getKafkaConsumerGroup :: SequencerM KP.ConsumerGroup
getKafkaConsumerGroup = kafkaConsumerGroup <$> ask
