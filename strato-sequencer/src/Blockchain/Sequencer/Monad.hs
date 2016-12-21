{-# LANGUAGE MultiParamTypeClasses, FlexibleInstances, FlexibleContexts #-}
module Blockchain.Sequencer.Monad (
    SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , runSequencerM
  , getLastIngestedOffset
  , setLastIngestedOffset
  , getKafkaClientID
) where

import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Reader
import Control.Monad.Trans.Resource

import Blockchain.Constants
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.SHA

import System.Directory (createDirectoryIfMissing)

import qualified Database.LevelDB       as LDB
import qualified Network.Kafka          as K
import qualified Network.Kafka.Protocol as KP

type SequencerM  = StateT SequencerContext (ResourceT (ReaderT SequencerConfig (LoggingT IO)))

data SequencerContext = SequencerContext
                      { dependentBlockDB   :: DependentBlockDB
                      , seenTransactionDB  :: SeenTransactionDB
                      , lastIngestedOffset :: KP.Offset
                      }

data SequencerConfig =
     SequencerConfig { depBlockDBCacheSize   :: Int
                     , depBlockDBPath        :: String
                     , seenTransactionDBSize :: Int
                     , kafkaClientId         :: K.KafkaClientId
                     , syncWrites            :: Bool
                     , bootstrapDoEmit       :: Bool
                     , startOffset           :: Integer
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

runSequencerM :: SequencerConfig -> SequencerM a -> LoggingT IO a
runSequencerM c m = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    a <- (flip runReaderT) c $ runResourceT $ do
        dbCS     <- depBlockDBCacheSize <$> ask
        dbPath   <- depBlockDBPath      <$> ask
        stxSize  <- seenTransactionDBSize <$> ask
        startOfs <- startOffset <$> ask
        depBlock <- LDB.open dbPath LDB.defaultOptions { LDB.createIfMissing = True, LDB.cacheSize=dbCS }
        runStateT m $ SequencerContext
            { dependentBlockDB   = depBlock
            , seenTransactionDB  = mkSeenTxDB stxSize
            , lastIngestedOffset = KP.Offset . fromIntegral $ startOfs
            }
    return $ fst a

getLastIngestedOffset :: SequencerM KP.Offset
getLastIngestedOffset = lastIngestedOffset <$> get

setLastIngestedOffset :: KP.Offset -> SequencerM ()
setLastIngestedOffset newOffset = do
    ctx <- get
    put $ ctx { lastIngestedOffset = newOffset }

getKafkaClientID :: SequencerM K.KafkaClientId
getKafkaClientID = kafkaClientId <$> ask
