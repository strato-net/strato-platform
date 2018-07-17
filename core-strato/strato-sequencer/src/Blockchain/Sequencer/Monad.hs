{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}
module Blockchain.Sequencer.Monad (
    SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , runSequencerM
  , getKafkaClientID
  , getKafkaConsumerGroup
) where

import           Control.Lens
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Stats
import           Control.Monad.Trans.Resource
import           Data.Maybe                                (fromMaybe)

import           Blockchain.Blockstanbul
import           Blockchain.Constants
import           Blockchain.Data.Address
import qualified Blockchain.EthConf                        as EC
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.StatsConf

import           System.Directory                          (createDirectoryIfMissing)

import qualified Database.LevelDB                          as LDB
import qualified Network.Kafka                             as K
import qualified Blockchain.MilenaTools                    as K
import qualified Network.Kafka.Protocol                    as KP
import qualified Network.Haskoin.Crypto                    as HK

instance (MonadLogger m) => MonadLogger (StatsT m) where
    monadLoggerLog a b c d = lift $ monadLoggerLog a b c d

instance (MonadResource m) => MonadResource (StatsT m) where
    liftResourceT = lift . liftResourceT

data SequencerContext = SequencerContext
                      { _dependentBlockDB    :: DependentBlockDB
                      , _seenTransactionDB   :: SeenTransactionDB
                      , _sequencerKafkaState :: K.KafkaState
                      , _blockstanbulContext :: Maybe BlockstanbulContext
                      }
makeLenses ''SequencerContext


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

type SequencerM  = StateT SequencerContext (ReaderT SequencerConfig (StatsT (ResourceT (LoggingT IO))))

instance HasDependentBlockDB SequencerM where
    getDependentBlockDB = use dependentBlockDB
    getWriteOptions     = LDB.WriteOptions . syncWrites <$> ask
    getReadOptions      = return LDB.defaultReadOptions

instance HasSeenTransactionDB SequencerM where
    getSeenTransactionDB = use seenTransactionDB
    putSeenTransactionDB = assign seenTransactionDB

instance K.HasKafkaState SequencerM where
    getKafkaState = use sequencerKafkaState
    putKafkaState = assign sequencerKafkaState

instance HasBlockstanbulContext SequencerM where
    getBlockstanbulContext = use blockstanbulContext
    putBlockstanbulContext = assign (blockstanbulContext . _Just)

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
        -- TODO(tim): Use proper values
        let ctx = newContext
                   (View 0 0)
                   [Address 0x80976e7d04c8ae9b3a1c08278a5c385e5b0ff446]
                   (fromMaybe (error "invalid argument")  $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5)

        runStateT m SequencerContext
            { _dependentBlockDB    = depBlock
            , _seenTransactionDB   = mkSeenTxDB stxSize
            , _sequencerKafkaState = kState
            , _blockstanbulContext = Just ctx
            }
    return $ fst a

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask

getKafkaConsumerGroup :: SequencerM KP.ConsumerGroup
getKafkaConsumerGroup = kafkaConsumerGroup <$> ask
