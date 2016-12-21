{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances, FlexibleContexts, BangPatterns #-}

module Blockchain.VMContext (
  Context(..),
  ContextM,
  runContextM,
  evalContextM,
  execContextM,
--  getDebugMsg,
--  clearDebugMsg,
  getCachedBestProcessedBlock,
  putCachedBestProcessedBlock,      
  incrementNonce,
  getNewAddress,
  purgeStorageMap
  ) where


import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans.Resource
import Control.Monad.State
import qualified Data.Map as M
import qualified Database.LevelDB as DB
import qualified Database.Persist.Postgresql as SQL
import System.Directory
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))


import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockDB
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StorageDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.Constants
import Blockchain.EthConf
import Blockchain.ExtWord
import Blockchain.VMOptions

import Blockchain.Bagger
import Blockchain.Bagger.BaggerState (BaggerState, defaultBaggerState)

--import Debug.Trace

data Context =
  Context {
    contextStateDB::MP.MPDB,
    contextHashDB::HashDB,
    contextCodeDB::CodeDB,
    contextBlockSummaryDB::BlockSummaryDB,
    contextSQLDB::SQLDB,
    cachedBestProcessedBlock::Maybe Block,
    contextAddressStateDBMap::M.Map Address AddressStateModification,
    contextStorageMap::M.Map (Address, Word256) Word256,
    contextBaggerState :: !BaggerState
    }

type ContextM = StateT Context (ResourceT (LoggingT IO))

instance HasStateDB ContextM where
  getStateDB = do
    cxt <- get
    return $ contextStateDB cxt
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{contextStateDB=(contextStateDB cxt){MP.stateRoot=sr}}

instance HasMemAddressStateDB ContextM where
  getAddressStateDBMap = do
    cxt <- get
    return $ contextAddressStateDBMap cxt
  putAddressStateDBMap theMap = do
    cxt <- get
    put $ cxt{contextAddressStateDBMap=theMap}

instance HasStorageDB ContextM where
  getStorageDB = do
    cxt <- get
    return $ (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
              contextStorageMap cxt)
  putStorageMap theMap = do
    cxt <- get
    put cxt{contextStorageMap=theMap}

instance HasHashDB ContextM where
  getHashDB = fmap contextHashDB get

instance HasCodeDB ContextM where
  getCodeDB = fmap contextCodeDB get

instance HasBlockSummaryDB ContextM where
  getBlockSummaryDB = fmap contextBlockSummaryDB get

instance HasSQLDB ContextM where
  getSQLDB = fmap contextSQLDB get

{-
connStr'::SQL.ConnectionString
connStr' = BC.pack $ "host=localhost dbname=eth user=postgres password=api port=" ++ show (port $ sqlConfig ethConf)
-}

--runContextM::MonadIO m=>
--             ContextM a->m ()

runContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                StateT Context (ResourceT m) a -> m (a, Context)
runContextM f = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"

  r <-
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

      runStateT f (Context
                   MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateroot not set"}
                   hdb
                   cdb
                   blksumdb
                   conn
                   Nothing
                   M.empty
                   M.empty
                   defaultBaggerState)

  return r

evalContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                 StateT Context (ResourceT m) a -> m (a)
evalContextM f = fst <$> (runContextM f) 

execContextM :: (MonadIO m, MonadBaseControl IO m, MonadThrow m) =>
                 StateT Context (ResourceT m) a -> m (Context)
execContextM f = snd <$> (runContextM f)

{-
getDebugMsg::ContextM String
getDebugMsg = do
  cxt <- get
  return $ concat $ reverse $ vmTrace cxt

clearDebugMsg::ContextM ()
clearDebugMsg = do
  cxt <- get
  put cxt{vmTrace=[]}
-}

getCachedBestProcessedBlock::ContextM (Maybe Block)
getCachedBestProcessedBlock = do
  cxt <- get
  return $ cachedBestProcessedBlock cxt

putCachedBestProcessedBlock::Block->ContextM ()
putCachedBestProcessedBlock b = do
  cxt <- get
  put cxt{cachedBestProcessedBlock=Just b}

incrementNonce::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
                Address->m ()
incrementNonce address = do
  addressState <- getAddressState address
  putAddressState address addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
               Address->m Address
getNewAddress address = do
  addressState <- getAddressState address
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty address) ++ ", nonce=" ++ show (addressStateNonce addressState)
  let newAddress = getNewAddress_unsafe address (addressStateNonce addressState)
  incrementNonce address
  return newAddress

purgeStorageMap::HasStorageDB m=>Address->m ()
purgeStorageMap address = do
  (_, storageMap) <- getStorageDB
  putStorageMap $ M.filterWithKey (\key _ -> fst key /= address) storageMap










