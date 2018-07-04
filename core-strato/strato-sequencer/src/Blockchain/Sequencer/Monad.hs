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

import qualified Data.Set                                  as S

import           Blockchain.Constants
import qualified Blockchain.EthConf                        as EC
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
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
                      , seenTransactionDB   :: SeenTransactionDB
                      , privateHashDB       :: PrivateHashDB
                      , getTransactionsDB   :: S.Set SHA
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
            , seenTransactionDB   = mkSeenTxDB stxSize
            , privateHashDB       = emptyPrivateHashDB
            , getTransactionsDB   = S.empty
            , sequencerKafkaState = kState
            }
    return $ fst a

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask

getKafkaConsumerGroup :: SequencerM KP.ConsumerGroup
getKafkaConsumerGroup = kafkaConsumerGroup <$> ask
