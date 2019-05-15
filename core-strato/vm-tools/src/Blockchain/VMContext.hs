{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE StandaloneDeriving    #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS_GHC -fno-warn-type-defaults #-}


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
    , queuePendingVote
    , peekPendingVote
    , clearPendingVote
    , compactContextM
    ) where

import           Control.DeepSeq
import           Control.Lens                       hiding (Context(..))
import           Control.Monad.Catch
import qualified Control.Monad.Change.Alter         as A
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Blockchain.Output
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                    as B
import           Data.Foldable                      (toList)
import           Data.List.Split                    (chunksOf)
import qualified Data.Map                           as M
import           Data.Maybe                         (fromMaybe)
import           Data.Proxy
import qualified Data.Sequence                      as Q
import           Data.Word
import qualified Data.Text                          as T
import qualified Database.LevelDB                   as DB
import qualified Database.Persist.Postgresql        as PSQL
import qualified Database.Persist.Sqlite            as Lite
import qualified Database.Redis                     as Redis
import           GHC.Generics
import qualified Network.Kafka                      as K
import qualified Network.Kafka.Protocol             as K
import qualified Blockchain.MilenaTools             as K
import           System.Directory
import           System.IO.Temp
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), (</>))
import           Prometheus

import           Blockchain.Bagger.BaggerState      (BaggerState, defaultBaggerState)
import           Blockchain.Blockstanbul.Authentication as Auth
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
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf
import qualified Blockchain.Strato.Indexer.Kafka    as IK
import qualified Blockchain.Strato.Indexer.Model    as IM
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import           Executable.EVMFlags

instance NFData Redis.Connection where
  rnf c = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo (SHA, BlockData, Integer, Int, Int)
    deriving (Eq, Read, Show, Generic, NFData)

newtype Config = Config { configSQLDB :: SQLDB } deriving (Show)

instance NFData Config where
  rnf = const ()

data Context = Context { contextStateDB                :: MP.MPDB
                       , contextHashDB                 :: HashDB
                       , contextCodeDB                 :: CodeDB
                       , contextBlockSummaryDB         :: BlockSummaryDB
                       , contextAddressStateTxDBMap    :: M.Map Address AddressStateModification
                       , contextAddressStateBlockDBMap :: M.Map Address AddressStateModification
                       , contextStorageTxMap           :: M.Map (Address, B.ByteString) B.ByteString
                       , contextStorageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString
                       , contextBlockHashRoot          :: MP.StateRoot
                       , contextGenesisRoot            :: MP.StateRoot
                       , contextBestBlockRoot          :: MP.StateRoot
                       , contextBaggerState            :: !BaggerState
                       , contextKafkaState             :: K.KafkaState
                       , contextBestBlockInfo          :: ContextBestBlockInfo
                       , contextRedisPool              :: Redis.Connection
                       , contextTxResultQueue          :: Q.Seq TransactionResult
                       , contextLogDBQueue             :: [LogDB]
                       , contextHasBlockstanbul        :: Bool
                       , _contextBlockRequested        :: Bool
                       , contextCoinbaseQueue          :: Q.Seq ((Address,Word64), Address)
                       } deriving (Generic, NFData)
makeLenses ''Context


type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance Show Context where
  show = const "<context>"

instance HasMemTXResultDB ContextM where
  enqueueTransactionResults txrs = do
    ctx <- get
    let q = contextTxResultQueue ctx
    recordTxrEnqueue $ length txrs
    put $ ctx { contextTxResultQueue = q Q.>< Q.fromList txrs }

  flushTransactionResults = do
    ctx <- get
    let q = contextTxResultQueue ctx
        toWrite = chunksOf 2000 $ map IM.TxResult $ toList q
    recordTxrFlush $ Q.length q
    mapM_ (K.withKafkaViolently . IK.writeIndexEvents) toWrite
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
  getBestBlockRoot = contextBestBlockRoot <$> get
  putBestBlockRoot sr = do
    cxt <- get
    put cxt{contextBestBlockRoot = sr}

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

instance (Address `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance HasRawStorageDB ContextM where
  getRawStorageTxDB = do
    cxt <- get
    return (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
            contextStorageTxMap cxt)
  putRawStorageTxMap theMap = do
    cxt <- get
    put cxt{contextStorageTxMap=theMap}
  getRawStorageBlockDB = do
    cxt <- get
    return (MP.ldb $ contextStateDB cxt, --storage and states use the same database!
            contextStorageBlockMap cxt)
  putRawStorageBlockMap theMap = do
    cxt <- get
    put cxt{contextStorageBlockMap=theMap}

instance HasHashDB ContextM where
  getHashDB = contextHashDB <$> get

instance HasCodeDB ContextM where
  getCodeDB = contextCodeDB <$> get

instance HasBlockSummaryDB ContextM where
  getBlockSummaryDB = contextBlockSummaryDB <$> get

instance (MonadReader Config m, MonadIO m, MonadUnliftIO m) => HasSQLDB m where
  getSQLDB = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance RBDB.HasRedisBlockDB ContextM where
    getRedisBlockDB = contextRedisPool <$> get

instance MonadMonitor (ResourceT (LoggingT IO)) where
    doIO = liftIO

runTestContextM :: (MonadIO m, MonadUnliftIO m, MonadMask m,
                    HasStateDB (StateT Context (ReaderT Config (ResourceT m)))) =>
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
        let initialKafkaState = K.mkKafkaState (K.KString "fake_client")
                                               (K.Host (K.KString "localhost"), K.Port 1234132)
        flip runStateT (Context
                     MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "must set stateroot for test context"}
                     hdb
                     cdb
                     blksumdb
                     M.empty
                     M.empty
                     M.empty
                     M.empty
                     MP.emptyTriePtr
                     MP.emptyTriePtr
                     MP.emptyTriePtr
                     defaultBaggerState
                     initialKafkaState
                     Unspecified
                     redisPool
                     Q.empty []
                     False
                     False
                     Q.empty) $ do
          MP.initializeBlank =<< getStateDB
          setStateDBStateRoot MP.emptyTriePtr
          f

runContextM :: (MonadIO m, MonadUnliftIO m) =>
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
                       MP.MPDB{MP.ldb=sdb, MP.stateRoot=MP.emptyTriePtr}
                       hdb
                       cdb
                       blksumdb
                       M.empty
                       M.empty
                       M.empty
                       M.empty
                       MP.emptyTriePtr
                       MP.emptyTriePtr
                       MP.emptyTriePtr
                       defaultBaggerState
                       initialKafkaState
                       Unspecified
                       redisPool
                       Q.empty
                       []
                       flags_blockstanbul
                       False
                       Q.empty)


evalContextM :: (MonadIO m, MonadUnliftIO m) => StateT Context (ReaderT Config (ResourceT m)) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadUnliftIO m) => StateT Context (ReaderT Config (ResourceT m)) a -> m Context
execContextM f = snd <$> runContextM f

incrementNonce :: (Address `A.Alters` AddressState) f => Address -> f ()
incrementNonce address = A.repsert_ Proxy address $ \mState ->
  let addressState = fromMaybe blankAddressState mState
   in pure addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress :: (MonadIO m, (Address `A.Alters` AddressState) m) => Address -> m Address
getNewAddress address = do
  nonce <- addressStateNonce <$> getAddressState address
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty address) ++ ", nonce=" ++ show nonce
  let newAddress = getNewAddress_unsafe address nonce
  incrementNonce address
  return newAddress

purgeStorageMap :: HasStorageDB m => Address -> m ()
purgeStorageMap address = do
  storageMap <- snd <$> getRawStorageTxDB
  putRawStorageTxMap $ M.filterWithKey (\(a,_) _ -> a /= address) storageMap

getContextBestBlockInfo :: ContextM ContextBestBlockInfo
getContextBestBlockInfo = contextBestBlockInfo <$> get

putContextBestBlockInfo :: ContextBestBlockInfo -> ContextM ()
putContextBestBlockInfo new = do
    ctx <- get
    put ctx { contextBestBlockInfo = new }

queuePendingVote :: Address -> Bool -> Address -> ContextM ()
queuePendingVote a r s= do
  let nonce = case r of
        True -> maxBound
        False -> 0
  let newVote = ((a, nonce), s)
  $logInfoLS "queuePendingVote" newVote
  ctx <- get
  put ctx { contextCoinbaseQueue = newVote Q.<| (contextCoinbaseQueue ctx)}

-- (Coinbase, Nonce) to be applied on a constructed block
-- When no pending votes are available, supplies the default coinbase (0x0)
peekPendingVote :: ContextM (Address, Word64)
peekPendingVote = do
  ctx <- get
  case Q.viewl $ contextCoinbaseQueue ctx of
    Q.EmptyL -> return (0,0)
    ( v Q.:< _) -> do
      $logInfoLS "peekPendingVote" v
      return $ fst v

-- If the Block was sent out by us and contains our vote,
-- mark the vote as committed and remove it from the queue.
clearPendingVote :: Block -> ContextM ()
clearPendingVote b = do
  let bd = blockBlockData b
      currentBlockData = (blockDataCoinbase bd, blockDataNonce bd)
  $logInfoLS "clearPendingVote" currentBlockData
  ctx <- get
  let sender = fromMaybe 0x0 $ Auth.verifyProposerSeal b =<< Auth.getProposerSeal b
  let ctxCoinbaseQ = contextCoinbaseQueue ctx
  let newCoinbaseQ = case Q.elemIndexL (currentBlockData, sender) ctxCoinbaseQ of
        Just i -> Q.deleteAt i ctxCoinbaseQ
        Nothing -> ctxCoinbaseQ
  put ctx { contextCoinbaseQueue = newCoinbaseQ}

compactContextM :: ContextM ()
compactContextM = modify' force
