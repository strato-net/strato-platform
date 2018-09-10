{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.VMContext
    ( Context(..)
    , ContextBestBlockInfo(..)
    , ContextM
    , runContextM
    , evalContextM
    , execContextM
    , incrementNonce
    , getNewAddress
    , purgeStorageMap
    , getContextBestBlockInfo
    , putContextBestBlockInfo
    , contextBlockRequested
    ) where


import           Control.Lens                       hiding (Context(..))
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Stats
import           Control.Monad.Trans.Resource
import qualified Data.Map                           as M
import qualified Database.LevelDB                   as DB
import qualified Database.Persist.Postgresql        as SQL
import qualified Database.Redis                     as Redis
import qualified Network.Kafka                      as K
import qualified Blockchain.MilenaTools             as K
import           System.Directory
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), (</>))
import           Prometheus

import           Blockchain.Bagger.BaggerState      (BaggerState, defaultBaggerState)
import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs           (LogDB, TransactionResult)
import           Blockchain.Data.LogDB
import           Blockchain.Data.MiningStatus
import           Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import qualified Blockchain.Strato.Indexer.Kafka    as IK
import qualified Blockchain.Strato.Indexer.Model    as IM
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.VMOptions

import           Executable.EVMFlags

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo (SHA, BlockData, Integer, Int, Int)
    deriving (Eq, Read, Show)

data Context = Context { contextStateDB             :: MP.MPDB
                       , contextHashDB              :: HashDB
                       , contextCodeDB              :: CodeDB
                       , contextBlockSummaryDB      :: BlockSummaryDB
                       , contextSQLDB               :: SQLDB
                       , contextAddressStateDBMap   :: M.Map Address AddressStateModification
                       , contextStorageMap          :: M.Map (Address, Word256) Word256
                       , contextBlockHashRoot       :: MP.StateRoot
                       , contextGenesisRoot         :: MP.StateRoot
                       , contextCurrentBlockHash    :: SHA
                       , contextCurrentChainId      :: Maybe Word256
                       , contextBaggerState         :: !BaggerState
                       , contextKafkaState          :: K.KafkaState
                       , contextBestBlockInfo       :: ContextBestBlockInfo
                       , contextRedisPool           :: Redis.Connection
                       , contextInsertTxResultQueue :: [TransactionResult]
                       , contextUpdateTxResultQueue :: [(SHA,SHA,SHA,MiningStatus)]
                       , contextLogDBQueue          :: [LogDB]
                       , contextHasBlockstanbul     :: Bool
                       , _contextBlockRequested      :: Bool
                       }
makeLenses ''Context

type ContextM = StateT Context (StatsT (ResourceT (LoggingT IO)))

instance (MonadResource m) => MonadResource (StatsT m) where
    liftResourceT = lift . liftResourceT

instance (MonadLogger m) => MonadLogger (StatsT m) where
    monadLoggerLog a b c d = lift $ monadLoggerLog a b c d

instance HasMemTXResultDB ContextM where
  enqueueInsertTransactionResults txrs = do
    ctx <- get
    let q = contextInsertTxResultQueue ctx
    put $ ctx { contextInsertTxResultQueue = (q ++ txrs) }

  flushInsertTransactionResults = do
    ctx <- get
    let toWrite = contextInsertTxResultQueue ctx
    _ <- K.withKafkaViolently $ IK.writeIndexEvents (IM.InsertTxResult <$> toWrite)
    put $ ctx { contextInsertTxResultQueue = [] }

  enqueueUpdateTransactionResults sss = do
    ctx <- get
    let q = contextUpdateTxResultQueue ctx
    put $ ctx { contextUpdateTxResultQueue = (q ++ sss) }

  flushUpdateTransactionResults = do
    ctx <- get
    let toWrite = contextUpdateTxResultQueue ctx
    _ <- K.withKafkaViolently $ IK.writeIndexEvents (IM.UpdateTxResult <$> toWrite)
    put $ ctx { contextUpdateTxResultQueue = [] }

  flushTransactionResults = do
    ctx <- get
    let toInsert = IM.InsertTxResult <$> contextInsertTxResultQueue ctx
        toUpdate = IM.UpdateTxResult <$> contextUpdateTxResultQueue ctx
    _ <- K.withKafkaViolently $ IK.writeIndexEvents (toInsert ++ toUpdate)
    put $ ctx { contextInsertTxResultQueue = [], contextUpdateTxResultQueue = [] }

instance HasMemLogDB ContextM where
  enqueueLogEntries ls = do
    ctx <- get
    let q = contextLogDBQueue ctx
    put $ ctx { contextLogDBQueue = (q ++ ls) }

  flushLogEntries = do
    ctx <- get
    let toWrite = contextLogDBQueue ctx
    _ <- K.withKafkaViolently $ IK.writeIndexEvents (IM.LogDBEntry <$> toWrite)
    put $ ctx { contextLogDBQueue = [] }


instance HasStateDB ContextM where
  getStateDB = contextStateDB <$> get
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{contextStateDB=(contextStateDB cxt){MP.stateRoot=sr}}

instance HasChainDB ContextM where
  getBlockHashRoot = contextBlockHashRoot <$> get
  putBlockHashRoot sr = do
    cxt <- get
    put cxt{contextBlockHashRoot = sr}
  getGenesisRoot = contextGenesisRoot <$> get
  putGenesisRoot sr = do
    cxt <- get
    put cxt{contextGenesisRoot = sr}
  getCurrentBlockHash = contextCurrentBlockHash <$> get
  putCurrentBlockHash bh = do
    cxt <- get
    put cxt{contextCurrentBlockHash = bh}
  getCurrentChainId = contextCurrentChainId <$> get
  putCurrentChainId cid = do
    cxt <- get
    put cxt{contextCurrentChainId = cid}

instance K.HasKafkaState ContextM where
    getKafkaState = contextKafkaState <$> get
    putKafkaState ks = do
        ctx <- get
        put $ ctx {contextKafkaState = ks}

instance HasMemAddressStateDB ContextM where
  getAddressStateDBMap = contextAddressStateDBMap <$> get
  putAddressStateDBMap theMap = do
    cxt <- get
    put $ cxt{contextAddressStateDBMap=theMap}

instance HasStorageDB ContextM where
  getStorageDB = do
    cxt <- get
    return (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
            contextStorageMap cxt)
  putStorageMap theMap = do
    cxt <- get
    put cxt{contextStorageMap=theMap}

instance HasHashDB ContextM where
  getHashDB = contextHashDB <$> get

instance HasCodeDB ContextM where
  getCodeDB = contextCodeDB <$> get

instance HasBlockSummaryDB ContextM where
  getBlockSummaryDB = contextBlockSummaryDB <$> get

instance HasSQLDB ContextM where
  getSQLDB = contextSQLDB <$> get

instance RBDB.HasRedisBlockDB ContextM where
    getRedisBlockDB = contextRedisPool <$> get

instance MonadMonitor ContextM where
    doIO = liftIO

runContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                StateT Context (StatsT (ResourceT m)) a -> m (a, Context)
runContextM f = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    runResourceT $ do
        let ldbOptions = DB.defaultOptions {
            DB.createIfMissing = True,
            DB.cacheSize       = flags_ldbCacheSize,
            DB.blockSize       = flags_ldbBlockSize
        }
        sdb <- DB.open (dbDir "h" ++ stateDBPath) ldbOptions
        hdb <- DB.open (dbDir "h" ++ hashDBPath)  ldbOptions
        cdb <- DB.open (dbDir "h" ++ codeDBPath)  ldbOptions
        blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
        conn <- liftIO $ runNoLoggingT  $ SQL.createPostgresqlPool connStr 20
        redisPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
        let initialKafkaState = mkConfiguredKafkaState "ethereum-vm"
        runStatsTConfigured $ runStateT f (Context
                        MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateroot not set"}
                        hdb
                        cdb
                        blksumdb
                        conn
                        M.empty
                        M.empty
                        MP.emptyTriePtr
                        MP.emptyTriePtr
                        (SHA 0)
                        Nothing
                        defaultBaggerState
                        initialKafkaState
                        Unspecified
                        redisPool
                        [] [] []
                        flags_blockstanbul
                        False)


evalContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (StatsT (ResourceT m)) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (StatsT (ResourceT m)) a -> m Context
execContextM f = snd <$> runContextM f

incrementNonce :: (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) => Address -> m ()
incrementNonce address = do
  addressState <- getAddressState address
  putAddressState address addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress :: (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) => Address -> m Address
getNewAddress address = do
  addressState <- getAddressState address
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty address) ++ ", nonce=" ++ show (addressStateNonce addressState)
  let newAddress = getNewAddress_unsafe address (addressStateNonce addressState)
  incrementNonce address
  return newAddress

purgeStorageMap :: HasStorageDB m => Address -> m ()
purgeStorageMap address = do
  (_, storageMap) <- getStorageDB
  putStorageMap $ M.filterWithKey (\(a,_) _ -> a /= address) storageMap

getContextBestBlockInfo :: ContextM ContextBestBlockInfo
getContextBestBlockInfo = contextBestBlockInfo <$> get

putContextBestBlockInfo :: ContextBestBlockInfo -> ContextM ()
putContextBestBlockInfo new = do
    ctx <- get
    put ctx { contextBestBlockInfo = new }
