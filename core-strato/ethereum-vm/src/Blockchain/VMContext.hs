{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}


module Blockchain.VMContext
    ( Context(..)
    , Config(..)
    , ContextBestBlockInfo(..)
    , ContextM
    , runTestContextM
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
import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Resource
import           Data.Foldable                      (toList)
import qualified Data.Map                           as M
import qualified Data.Sequence                      as Q
import qualified Data.Text                          as T
import qualified Database.LevelDB                   as DB
import qualified Database.Persist.Postgresql        as PSQL
import qualified Database.Persist.Sqlite            as Lite
import qualified Database.Redis                     as Redis
import qualified Network.Kafka                      as K
import qualified Blockchain.MilenaTools             as K
import           System.Directory
import           System.IO.Temp
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), (</>))
import           Prometheus

import           Blockchain.Bagger.BaggerState      (BaggerState, defaultBaggerState)
import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs           (LogDB, TransactionResult)
import           Blockchain.Data.LogDB
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

newtype Config = Config { configSQLDB :: SQLDB } deriving (Show)
data Context = Context { contextStateDB                :: MP.MPDB
                       , contextHashDB                 :: HashDB
                       , contextCodeDB                 :: CodeDB
                       , contextBlockSummaryDB         :: BlockSummaryDB
                       , contextAddressStateTxDBMap    :: M.Map Address AddressStateModification
                       , contextAddressStateBlockDBMap :: M.Map Address AddressStateModification
                       , contextStorageTxMap           :: M.Map (Address, Word256) Word256
                       , contextStorageBlockMap        :: M.Map (Address, Word256) Word256
                       , contextBlockHashRoot          :: MP.StateRoot
                       , contextGenesisRoot            :: MP.StateRoot
                       , contextBaggerState            :: !BaggerState
                       , contextKafkaState             :: K.KafkaState
                       , contextBestBlockInfo          :: ContextBestBlockInfo
                       , contextRedisPool              :: Redis.Connection
                       , contextTxResultQueue          :: Q.Seq TransactionResult
                       , contextLogDBQueue             :: [LogDB]
                       , contextHasBlockstanbul        :: Bool
                       , _contextBlockRequested        :: Bool
                       }
makeLenses ''Context


type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance Show Context where
  show = const "<context>"

instance HasMemTXResultDB ContextM where
  enqueueTransactionResults txrs = do
    ctx <- get
    let q = contextTxResultQueue ctx
    put $ ctx { contextTxResultQueue = q Q.>< Q.fromList txrs }

  flushTransactionResults = do
    ctx <- get
    let toWrite = contextTxResultQueue ctx
    _ <- K.withKafkaViolently $ IK.writeIndexEvents (IM.TxResult <$> toList toWrite)
    put $ ctx { contextTxResultQueue = Q.empty }

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

instance K.HasKafkaState ContextM where
    getKafkaState = contextKafkaState <$> get
    putKafkaState ks = do
        ctx <- get
        put $ ctx {contextKafkaState = ks}

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = contextAddressStateTxDBMap <$> get
  putAddressStateTxDBMap theMap = do
    cxt <- get
    put $ cxt{contextAddressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = contextAddressStateBlockDBMap <$> get
  putAddressStateBlockDBMap theMap = do
    cxt <- get
    put $ cxt{contextAddressStateBlockDBMap=theMap}

instance HasStorageDB ContextM where
  getStorageTxDB = do
    cxt <- get
    return (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
            contextStorageTxMap cxt)
  putStorageTxMap theMap = do
    cxt <- get
    put cxt{contextStorageTxMap=theMap}
  getStorageBlockDB = do
    cxt <- get
    return (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
            contextStorageBlockMap cxt)
  putStorageBlockMap theMap = do
    cxt <- get
    put cxt{contextStorageBlockMap=theMap}

instance HasHashDB ContextM where
  getHashDB = contextHashDB <$> get

instance HasCodeDB ContextM where
  getCodeDB = contextCodeDB <$> get

instance HasBlockSummaryDB ContextM where
  getBlockSummaryDB = contextBlockSummaryDB <$> get

instance (MonadReader Config m, MonadIO m, MonadUnliftIO m, MonadBaseControl IO m) => HasSQLDB m where
  getSQLDB = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance RBDB.HasRedisBlockDB ContextM where
    getRedisBlockDB = contextRedisPool <$> get

instance MonadMonitor (ResourceT (LoggingT IO)) where
    doIO = liftIO

runTestContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m, MonadMask m) =>
                   StateT Context (ReaderT Config (ResourceT m)) a -> m (a, Context)
runTestContextM f = withSystemTempDirectory "test_evm_context" $ \tmpdir ->
  withTempFile tmpdir "evm.sqlite" $ \filepath _ ->
    runResourceT $ do
      conn <- runNoLoggingT $ Lite.createSqlitePool (T.pack filepath) 20
      flip runReaderT (Config conn) $ do
        let ldbOptions = DB.defaultOptions {
          DB.createIfMissing = True,
          DB.cacheSize = flags_ldbCacheSize,
          DB.blockSize = flags_ldbBlockSize
        }
        let openDB base = DB.open (tmpdir ++ base) ldbOptions
        sdb <- openDB stateDBPath
        hdb <- openDB hashDBPath
        cdb <- openDB codeDBPath
        blksumdb <- openDB blockSummaryCacheDBPath
        redisPool <- liftIO . Redis.connect $ Redis.defaultConnectInfo {
          Redis.connectHost = "localhost",
          Redis.connectPort = Redis.PortNumber 2023,
          Redis.connectDatabase = 0
        }
        let initialKafkaState = error "TODO(tim): require sinks"
        runStateT f (Context
                     MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateroot not set"}
                     hdb
                     cdb
                     blksumdb
                     M.empty
                     M.empty
                     M.empty
                     M.empty
                     MP.emptyTriePtr
                     MP.emptyTriePtr
                     defaultBaggerState
                     initialKafkaState
                     Unspecified
                     redisPool
                     Q.empty []
                     False
                     False)

runContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                StateT Context (ReaderT Config (ResourceT m)) a -> m (a, Context)
runContextM f = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    runResourceT $ do
        conn <- liftIO $ runNoLoggingT  $ PSQL.createPostgresqlPool connStr 20
        flip runReaderT (Config conn) $ do
          let ldbOptions = DB.defaultOptions {
              DB.createIfMissing = True,
              DB.cacheSize       = flags_ldbCacheSize,
              DB.blockSize       = flags_ldbBlockSize
          }
          sdb <- DB.open (dbDir "h" ++ stateDBPath) ldbOptions
          hdb <- DB.open (dbDir "h" ++ hashDBPath)  ldbOptions
          cdb <- DB.open (dbDir "h" ++ codeDBPath)  ldbOptions
          blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
          redisPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
          let initialKafkaState = mkConfiguredKafkaState "ethereum-vm"
          runStateT f (Context
                       MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateroot not set"}
                       hdb
                       cdb
                       blksumdb
                       M.empty
                       M.empty
                       M.empty
                       M.empty
                       MP.emptyTriePtr
                       MP.emptyTriePtr
                       defaultBaggerState
                       initialKafkaState
                       Unspecified
                       redisPool
                       Q.empty
                       []
                       flags_blockstanbul
                       False)


evalContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (ReaderT Config (ResourceT m)) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (ReaderT Config (ResourceT m)) a -> m Context
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
  (_, storageMap) <- getStorageTxDB
  putStorageTxMap $ M.filterWithKey (\(a,_) _ -> a /= address) storageMap

getContextBestBlockInfo :: ContextM ContextBestBlockInfo
getContextBestBlockInfo = contextBestBlockInfo <$> get

putContextBestBlockInfo :: ContextBestBlockInfo -> ContextM ()
putContextBestBlockInfo new = do
    ctx <- get
    put ctx { contextBestBlockInfo = new }
