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
) where

import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Stats
import           Control.Monad.Trans.Resource

import           Blockchain.Constants
import           Blockchain.EthConf                        (mkConfiguredKafkaState, runStatsTConfigured)
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB

import           System.Directory                          (createDirectoryIfMissing)

import qualified Database.LevelDB                          as LDB
import qualified Network.Kafka                             as K
import qualified Network.Kafka.Protocol                    as KP

type SequencerM  = StateT SequencerContext (ReaderT SequencerConfig (StatsT (ResourceT (LoggingT IO))))

instance (MonadLogger m) => MonadLogger (StatsT m) where
    monadLoggerLog a b c d = lift $ monadLoggerLog a b c d

instance (MonadResource m) => MonadResource (StatsT m) where
    liftResourceT = lift . liftResourceT

data SequencerContext = SequencerContext
                      { dependentBlockDB    :: DependentBlockDB
                      , seenTransactionDB   :: SeenTransactionDB
                      , sequencerKafkaState :: K.KafkaState
                      }

data SequencerConfig =
     SequencerConfig { depBlockDBCacheSize   :: Int
                     , depBlockDBPath        :: String
                     , seenTransactionDBSize :: Int
                     , kafkaClientId         :: K.KafkaClientId
                     , kafkaConsumerGroup    :: KP.ConsumerGroup
                     , syncWrites            :: Bool
                     , bootstrapDoEmit       :: Bool
                     }


instance HasDependentBlockDB SequencerM where
    getDependentBlockDB = dependentBlockDB <$> get
    getWriteOptions     = LDB.WriteOptions . syncWrites <$> ask
    getReadOptions      = return LDB.defaultReadOptions

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
    a <- runResourceT . runStatsTConfigured . flip runReaderT c $ do
        dbCS     <- depBlockDBCacheSize <$> ask
        dbPath   <- depBlockDBPath      <$> ask
        stxSize  <- seenTransactionDBSize <$> ask
        kClId    <- kafkaClientId <$> ask
        depBlock <- LDB.open dbPath LDB.defaultOptions { LDB.createIfMissing = True, LDB.cacheSize=dbCS }
        runStateT m SequencerContext
            { dependentBlockDB    = depBlock
            , seenTransactionDB   = mkSeenTxDB stxSize
            , sequencerKafkaState = mkConfiguredKafkaState kClId
            }
    return $ fst a

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask

getKafkaConsumerGroup :: SequencerM KP.ConsumerGroup
getKafkaConsumerGroup = kafkaConsumerGroup <$> ask
