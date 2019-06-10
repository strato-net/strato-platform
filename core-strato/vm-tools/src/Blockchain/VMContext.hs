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

import           Control.Arrow                      ((&&&))
import           Control.DeepSeq
import           Control.Lens                       hiding (Context(..))
import           Control.Monad.Catch
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
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
import qualified Data.NibbleString                  as N
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
import           Blockchain.Data.BlockSummary
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
import qualified Blockchain.TxRunResultCache        as TRC
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import           Executable.EVMFlags

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

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
                       , contextBlockHashRoot          :: BlockHashRoot
                       , contextGenesisRoot            :: GenesisRoot
                       , contextBestBlockRoot          :: BestBlockRoot
                       , contextBaggerState            :: !BaggerState
                       , contextKafkaState             :: K.KafkaState
                       , contextBestBlockInfo          :: ContextBestBlockInfo
                       , contextRedisPool              :: RBDB.RedisConnection
                       , contextTxResultQueue          :: Q.Seq TransactionResult
                       , contextLogDBQueue             :: [LogDB]
                       , contextHasBlockstanbul        :: Bool
                       , _contextBlockRequested        :: Bool
                       , contextCoinbaseQueue          :: Q.Seq ((Address,Word64), Address)
                       , contextTxRunResultsCache      :: TRC.Cache
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


instance Mod.Modifiable MP.StateRoot ContextM where
  get _    = gets (MP.stateRoot . contextStateDB)
  put _ sr = modify $ \c -> c{contextStateDB = (contextStateDB c){MP.stateRoot = sr}}

instance Mod.Modifiable BlockHashRoot ContextM where
  get _     = gets contextBlockHashRoot
  put _ bhr = modify $ \c -> c{contextBlockHashRoot = bhr}

instance Mod.Modifiable GenesisRoot ContextM where
  get _    = gets contextGenesisRoot
  put _ gr = modify $ \c -> c{contextGenesisRoot = gr}

instance Mod.Modifiable BestBlockRoot ContextM where
  get _     = gets contextBestBlockRoot
  put _ bbr = modify $ \c -> c{contextBestBlockRoot = bbr}

instance Mod.Modifiable K.KafkaState ContextM where
  get _    = gets contextKafkaState
  put _ ks = modify $ \c -> c{contextKafkaState = ks}

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets contextAddressStateTxDBMap
  putAddressStateTxDBMap theMap = modify $ \c -> c{contextAddressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = gets contextAddressStateBlockDBMap
  putAddressStateBlockDBMap theMap = modify $ \c -> c{contextAddressStateBlockDBMap=theMap}

instance (MP.StateRoot `A.Alters` MP.NodeData) ContextM where
  lookup _ = MP.genericLookupDB $ gets (MP.ldb . contextStateDB)
  insert _ = MP.genericInsertDB $ gets (MP.ldb . contextStateDB)
  delete _ = MP.genericDeleteDB $ gets (MP.ldb . contextStateDB)

instance (Address `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (SHA `A.Alters` DBCode) ContextM where
  lookup _ = genericLookupCodeDB $ gets contextCodeDB
  insert _ = genericInsertCodeDB $ gets contextCodeDB
  delete _ = genericDeleteCodeDB $ gets contextCodeDB

instance (N.NibbleString `A.Alters` N.NibbleString) ContextM where
  lookup _ = genericLookupHashDB $ gets contextHashDB
  insert _ = genericInsertHashDB $ gets contextHashDB
  delete _ = genericDeleteHashDB $ gets contextHashDB

instance HasMemRawStorageDB ContextM where
  getMemRawStorageTxDB = gets $ MP.ldb . contextStateDB &&& contextStorageTxMap
  putMemRawStorageTxMap theMap = modify $ \c -> c{contextStorageTxMap=theMap}
  getMemRawStorageBlockDB = gets $ MP.ldb . contextStateDB &&& contextStorageBlockMap
  putMemRawStorageBlockMap theMap = modify $ \c -> c{contextStorageBlockMap=theMap}

instance (RawStorageKey `A.Alters` RawStorageValue) ContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance (SHA `A.Alters` BlockSummary) ContextM where
  lookup _ = genericLookupBlockSummaryDB $ gets contextBlockSummaryDB
  insert _ = genericInsertBlockSummaryDB $ gets contextBlockSummaryDB
  delete _ = genericDeleteBlockSummaryDB $ gets contextBlockSummaryDB

instance MonadReader Config m => Mod.Accessible SQLDB m where
  access _ = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = gets contextRedisPool

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
        cache <- liftIO $ TRC.new 64
        flip runStateT (Context
                     MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "must set stateroot for test context"}
                     (HashDB hdb)
                     (CodeDB cdb)
                     (BlockSummaryDB blksumdb)
                     M.empty
                     M.empty
                     M.empty
                     M.empty
                     (BlockHashRoot MP.emptyTriePtr)
                     (GenesisRoot MP.emptyTriePtr)
                     (BestBlockRoot MP.emptyTriePtr)
                     defaultBaggerState
                     initialKafkaState
                     Unspecified
                     (RBDB.RedisConnection redisPool)
                     Q.empty []
                     False
                     False
                     Q.empty
                     cache) $ do
          MP.initializeBlank
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
          cache <- liftIO $ TRC.new 64
          runStateT f (Context
                       MP.MPDB{MP.ldb=sdb, MP.stateRoot=MP.emptyTriePtr}
                       (HashDB hdb)
                       (CodeDB cdb)
                       (BlockSummaryDB blksumdb)
                       M.empty
                       M.empty
                       M.empty
                       M.empty
                       (BlockHashRoot MP.emptyTriePtr)
                       (GenesisRoot MP.emptyTriePtr)
                       (BestBlockRoot MP.emptyTriePtr)
                       defaultBaggerState
                       initialKafkaState
                       Unspecified
                       (RBDB.RedisConnection redisPool)
                       Q.empty
                       []
                       flags_blockstanbul
                       False
                       Q.empty
                       cache)


evalContextM :: (MonadIO m, MonadUnliftIO m) => StateT Context (ReaderT Config (ResourceT m)) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadUnliftIO m) => StateT Context (ReaderT Config (ResourceT m)) a -> m Context
execContextM f = snd <$> runContextM f

incrementNonce :: (Address `A.Alters` AddressState) f => Address -> f ()
incrementNonce address = A.adjustWithDefault_ Mod.Proxy address $ \addressState ->
  pure addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress :: (MonadIO m, (Address `A.Alters` AddressState) m) => Address -> m Address
getNewAddress address = do
  nonce <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy address
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty address) ++ ", nonce=" ++ show nonce
  let newAddress = getNewAddress_unsafe address nonce
  incrementNonce address
  return newAddress

purgeStorageMap :: HasMemStorageDB m => Address -> m ()
purgeStorageMap address = do
  storageMap <- snd <$> getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.filterWithKey (const . (/= address) . fst) storageMap

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
