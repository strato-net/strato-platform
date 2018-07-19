{-# LANGUAGE FlexibleContexts               #-}
{-# LANGUAGE FlexibleInstances              #-}
{-# LANGUAGE MultiParamTypeClasses          #-}
{-# LANGUAGE TemplateHaskell                #-}
{-# OPTIONS_GHC -fno-warn-orphans           #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds  #-}
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

import           Control.Lens
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Stats
import           Control.Monad.Trans.Resource

import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S

import           Blockchain.Blockstanbul
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

instance (MonadLogger m) => MonadLogger (StatsT m) where
    monadLoggerLog a b c d = lift $ monadLoggerLog a b c d

instance (MonadResource m) => MonadResource (StatsT m) where
    liftResourceT = lift . liftResourceT

data SequencerContext = SequencerContext
                      { _dependentBlockDB    :: DependentBlockDB
                      , _seenBlockDB         :: SeenBlockDB
                      , _seenTransactionDB   :: SeenTransactionDB
                      , _privateHashDB       :: PrivateHashDB
                      , _getChainsDB         :: S.Set Word256
                      , _getTransactionsDB   :: S.Set SHA
                      , _ldbBatchOps         :: Q.Seq LDB.BatchOp
                      , _vmEvents            :: Q.Seq OutputEvent
                      , _p2pEvents           :: Q.Seq OutputEvent
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

instance HasGetChainsDB SequencerM where
    getGetChainsDB = _getChainsDB <$> get
    putGetChainsDB new = do
        ctx <- get
        put $ ctx { _getChainsDB = new }

instance HasGetTransactionsDB SequencerM where
    getGetTransactionsDB = _getTransactionsDB <$> get
    putGetTransactionsDB new = do
        ctx <- get
        put $ ctx { _getTransactionsDB = new }

instance HasPrivateHashDB SequencerM where
    getPrivateHashDB = _privateHashDB <$> get
    putPrivateHashDB new = do
        ctx <- get
        put $ ctx { _privateHashDB = new }

instance HasSeenBlockDB SequencerM where
    getSeenBlockDB = _seenBlockDB <$> get
    putSeenBlockDB new = do
        ctx <- get
        put $ ctx { _seenBlockDB = new }

instance HasSeenTransactionDB SequencerM where
    getSeenTransactionDB = use seenTransactionDB
    putSeenTransactionDB = assign seenTransactionDB

instance K.HasKafkaState SequencerM where
    getKafkaState = use sequencerKafkaState
    putKafkaState = assign sequencerKafkaState

instance HasBlockstanbulContext SequencerM where
    getBlockstanbulContext = use blockstanbulContext
    putBlockstanbulContext = assign (blockstanbulContext . _Just)

runSequencerM :: SequencerConfig -> Maybe BlockstanbulContext -> SequencerM a -> (LoggingT IO) a
runSequencerM c mbc m = do
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
            { _dependentBlockDB    = depBlock
            , _seenBlockDB         = mkSeenBlockDB stxSize
            , _seenTransactionDB   = mkSeenTxDB stxSize
            , _privateHashDB       = emptyPrivateHashDB
            , _getChainsDB         = S.empty
            , _getTransactionsDB   = S.empty
            , _ldbBatchOps         = Q.empty
            , _vmEvents            = Q.empty
            , _p2pEvents           = Q.empty
            , _sequencerKafkaState = kState
            , _blockstanbulContext = mbc
            }
    return $ fst a

clearLdbBatchOps :: SequencerM ()
clearLdbBatchOps = modify (\st -> st{_ldbBatchOps = Q.empty})

addLdbBatchOps :: [LDB.BatchOp] -> SequencerM ()
addLdbBatchOps ops = do
  st <- get
  let existingOps = _ldbBatchOps st
      go e [] = e
      go e (o:os) = go (e Q.|> o) os
      newOps = go existingOps ops
  put st{_ldbBatchOps = newOps}

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask

getKafkaConsumerGroup :: SequencerM KP.ConsumerGroup
getKafkaConsumerGroup = kafkaConsumerGroup <$> ask
