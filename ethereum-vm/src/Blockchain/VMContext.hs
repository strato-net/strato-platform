{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.VMContext (
  Context(..),
  ContextBestBlockInfo(..),
  ContextM,
  runContextM,
  evalContextM,
  execContextM,
  incrementNonce,
  getNewAddress,
  purgeStorageMap,
  getContextBestBlockInfo,
  putContextBestBlockInfo
  ) where


import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Data.Map                           as M
import qualified Database.LevelDB                   as DB
import qualified Database.Persist.Postgresql        as SQL
import           System.Directory
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), (</>))


import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.VMOptions

import           Blockchain.Bagger
import           Blockchain.Bagger.BaggerState      (BaggerState,
                                                     defaultBaggerState)

import           Blockchain.Strato.Model.SHA

import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import qualified Database.Redis                     as Redis
import qualified Network.Kafka                      as K

data Context = Context {
    contextStateDB           :: MP.MPDB,
    contextHashDB            :: HashDB,
    contextCodeDB            :: CodeDB,
    contextBlockSummaryDB    :: BlockSummaryDB,
    contextSQLDB             :: SQLDB,
    contextAddressStateDBMap :: M.Map Address AddressStateModification,
    contextStorageMap        :: M.Map (Address, Word256) Word256,
    contextBaggerState       :: !BaggerState,
    contextKafkaState        :: K.KafkaState,
    contextBestBlockInfo     :: ContextBestBlockInfo,
    contextRedisPool         :: Redis.Connection
}

type ContextM = StateT Context (ResourceT (LoggingT IO))

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo (SHA, BlockData, Integer, Int, Int)
    deriving (Eq, Read, Show)

instance HasStateDB ContextM where
  getStateDB = contextStateDB <$> get
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{contextStateDB=(contextStateDB cxt){MP.stateRoot=sr}}

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

runContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                StateT Context (ResourceT m) a -> m (a, Context)
runContextM f = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    runResourceT $ do
        sdb <- DB.open (dbDir "h" ++ stateDBPath)
                 DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
        hdb <- DB.open (dbDir "h" ++ hashDBPath)
                 DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
        cdb <- DB.open (dbDir "h" ++ codeDBPath)
                 DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
        blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath)
                 DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
        conn <- liftIO $ runNoLoggingT  $ SQL.createPostgresqlPool connStr' 20
        redisPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
        let initialKafkaState = mkConfiguredKafkaState "ethereum-vm"
        runStateT f (Context
                        MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateroot not set"}
                        hdb
                        cdb
                        blksumdb
                        conn
                        M.empty
                        M.empty
                        defaultBaggerState
                        initialKafkaState
                        Unspecified
                        redisPool)


evalContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (ResourceT m) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) => StateT Context (ResourceT m) a -> m Context
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
  putStorageMap $ M.filterWithKey (\key _ -> fst key /= address) storageMap

getContextBestBlockInfo :: ContextM ContextBestBlockInfo
getContextBestBlockInfo = contextBestBlockInfo <$> get

putContextBestBlockInfo :: ContextBestBlockInfo -> ContextM ()
putContextBestBlockInfo new = do
    ctx <- get
    put ctx { contextBestBlockInfo = new }
