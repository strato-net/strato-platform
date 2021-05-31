{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE StandaloneDeriving    #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS_GHC -fno-warn-type-defaults #-}
{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.VMContext
    ( CurrentBlockHash(..)
    , withCurrentBlockHash
    , VMBase
    , ContextDBs(..)
    , MemDBs(..)
    , ContextState(..)
    , Context(..)
    , ContextBestBlockInfo(..)
    , ContextM
    , stateDB
    , hashDB
    , codeDB
    , x509CertDB
    , blockSummaryDB
    , kafkaState
    , redisPool
    , sqldb
    , stateTxMap
    , stateBlockMap
    , storageTxMap
    , storageBlockMap
    , stateRoots
    , currentBlock
    , memDBs
    , baggerState
    , bestBlockInfo
    , hasBlockstanbul
    , blockRequested
    , coinbaseQueue
    , txRunResultsCache
    , dbs
    , state
    , contextGet
    , contextGets
    , contextPut
    , contextModify
    , contextModify'
    , runTestContextM
    , runContextM
    , evalContextM
    , execContextM
    , incrementNonce
    , getNewAddress
    , purgeStorageMap
    , getContextBestBlockInfo
    , putContextBestBlockInfo
    , queuePendingVote
    , peekPendingVote
    , clearPendingVote
    , compactContextM
    ) where

import           Control.DeepSeq
import           Control.Lens                       hiding (Context(..))
import           Control.Monad.Catch                (MonadCatch)
import           Control.Monad.FT                   hiding (get, gets, modify, modify_, put)
import qualified Control.Monad.FT                   as FT
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                    as B
import           Data.Default                       (def)
import qualified Data.Map                           as M
import           Data.Maybe                         (fromMaybe)
import qualified Data.NibbleString                  as N
import qualified Data.Sequence                      as Q
import           Data.Word
import qualified Data.Text                          as T
import           Data.Traversable                   (for)
import qualified Database.LevelDB                   as DB
import qualified Database.Persist.Sqlite            as Lite
import qualified Database.Redis                     as Redis
import           Debugger
import           GHC.Generics
import qualified Network.Kafka                      as K
import qualified Network.Kafka.Protocol             as K
import           System.Directory
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), (</>))
import           Prometheus

import           Blockchain.Bagger.BaggerState      (BaggerState, defaultBaggerState)
import           Blockchain.Blockstanbul.Authentication as Auth
import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.Block
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
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
import           Blockchain.DB.X509CertDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import qualified Blockchain.TxRunResultCache        as TRC
import           Blockchain.VMOptions

import           Executable.EVMFlags

import           UnliftIO

newtype CurrentBlockHash = CurrentBlockHash { unCurrentBlockHash :: Keccak256 }
  deriving (Generic, NFData, Show)

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo (Keccak256, BlockData, Integer, Int, Int)
    deriving (Eq, Read, Show, Generic, NFData)

data ContextDBs = ContextDBs
  { _stateDB        :: MP.StateDB
  , _hashDB         :: HashDB
  , _codeDB         :: CodeDB
  , _x509CertDB     :: X509CertDB
  , _blockSummaryDB :: BlockSummaryDB
  , _kafkaState     :: IORef K.KafkaState
  , _redisPool      :: RBDB.RedisConnection
  , _sqldb          :: SQLDB
  } deriving (Generic, NFData)
makeLenses ''ContextDBs

data MemDBs = MemDBs
  { _stateTxMap      :: M.Map Account AddressStateModification
  , _stateBlockMap   :: M.Map Account AddressStateModification
  , _storageTxMap    :: M.Map (Account, B.ByteString) B.ByteString
  , _storageBlockMap :: M.Map (Account, B.ByteString) B.ByteString
  , _stateRoots      :: M.Map (Keccak256, Maybe Word256) MP.StateRoot
  , _currentBlock    :: Maybe CurrentBlockHash
  } deriving (Generic, NFData, Show)
makeLenses ''MemDBs

data ContextState = ContextState
  { _memDBs            :: MemDBs
  , _baggerState       :: !BaggerState
  , _bestBlockInfo     :: ContextBestBlockInfo
  , _hasBlockstanbul   :: Bool
  , _blockRequested    :: Bool
  , _coinbaseQueue     :: Q.Seq ((Address,Word64), Address)
  , _txRunResultsCache :: TRC.Cache
  , _debugSettings     :: Maybe DebugSettings
  } deriving (Generic, NFData)
makeLenses ''ContextState

data Context = Context
  { _dbs   :: ContextDBs
  , _state :: IORef ContextState
  } deriving (Generic, NFData)
makeLenses ''Context

type ContextM = ReaderT Context (ResourceT (LoggingT IO))

type VMBase m = ( MonadIO m
                , MonadCatch m
                , MonadUnliftIO m
                , MonadLogger m
                , Modifiable (Maybe DebugSettings) m
                , Modifiable ContextState m
                , Modifiable MemDBs m
                , Modifiable BlockHashRoot m
                , Modifiable GenesisRoot m
                , Modifiable BestBlockRoot m
                , Modifiable CurrentBlockHash m
                , HasMemAddressStateDB m
                , (Maybe Word256 `Selects` ParentChainId) m
                , (Maybe Word256 `Alters` MP.StateRoot) m
                , (MP.StateRoot `Alters` MP.NodeData) m
                , (Account `Alters` AddressState) m
                , (Keccak256 `Alters` DBCode) m
                , HasX509CertDB m
                , (N.NibbleString `Alters` N.NibbleString) m
                , HasMemRawStorageDB m
                , (RawStorageKey `Alters` RawStorageValue) m
                , (Keccak256 `Alters` BlockSummary) m
                , Gettable (Maybe WorldBestBlock) m
                )

withCurrentBlockHash :: ( MonadLogger m
                        , Modifiable MemDBs m
                        , Modifiable CurrentBlockHash m
                        , HasMemAddressStateDB m
                        , (Maybe Word256 `Alters` MP.StateRoot) m
                        , (MP.StateRoot `Alters` MP.NodeData) m
                        , (Account `Alters` AddressState) m
                        , (N.NibbleString `Alters` N.NibbleString) m
                        , HasMemRawStorageDB m
                        , (RawStorageKey `Alters` RawStorageValue) m
                        )
                     => Keccak256 -> m a -> m a
withCurrentBlockHash bh f = do
  cbh <- FT.get @CurrentBlockHash
  FT.put @CurrentBlockHash (CurrentBlockHash bh)
  a <- f
  flushMemStorageDB
  flushMemAddressStateDB
  modifyStatefully_ @MemDBs $ stateRoots .= M.empty
  FT.put @CurrentBlockHash cbh
  pure a

getStateDB :: ContextM DB.DB
getStateDB = fmap MP.unStateDB . view $ dbs . stateDB

getHashDB :: ContextM HashDB
getHashDB = view $ dbs . hashDB

getCodeDB :: ContextM CodeDB
getCodeDB = view $ dbs . codeDB

getX509CertDB :: ContextM X509CertDB
getX509CertDB = view $ dbs . x509CertDB

getBlockSummaryDB :: ContextM BlockSummaryDB
getBlockSummaryDB = view $ dbs . blockSummaryDB

get :: ContextM ContextState
get = readIORef =<< view state
{-# INLINE get #-}

gets :: (ContextState -> a) -> ContextM a
gets f = f <$> get
{-# INLINE gets #-}

put :: ContextState -> ContextM ()
put c = view state >>= \i -> atomicWriteIORef i c
{-# INLINE put #-}

modify :: (ContextState -> ContextState) -> ContextM ()
modify f = view state >>= \i -> atomicModifyIORef i (\a -> (f a, ()))
{-# INLINE modify #-}

modify' :: (ContextState -> ContextState) -> ContextM ()
modify' f = view state >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify' #-}

contextGet :: ContextM ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: (ContextState -> a) -> ContextM a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: ContextState -> ContextM ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: (ContextState -> ContextState) -> ContextM ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: (ContextState -> ContextState) -> ContextM ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance Show Context where
  show = const "<context>"

instance Gettable ContextState ContextM where
  get = get
instance Puttable ContextState ContextM where
  put = put
instance Modifiable ContextState ContextM where

instance Gettable Context ContextM where
  get = ask

instance Gettable (Maybe DebugSettings) ContextM where
  get    = gets $ view debugSettings
instance Puttable (Maybe DebugSettings) ContextM where
  put ds = modify $ debugSettings .~ ds
instance Modifiable (Maybe DebugSettings) ContextM where

instance Gettable MemDBs ContextM where
  get    = gets $ view memDBs
instance Puttable MemDBs ContextM where
  put md = modify $ memDBs .~ md
instance Modifiable MemDBs ContextM where

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

instance Gettable BlockHashRoot ContextM where
  get = do
    db <- getStateDB
    BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBlockHashRootKey
instance Puttable BlockHashRoot ContextM where
  put (BlockHashRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBlockHashRootKey sr
instance Modifiable BlockHashRoot ContextM where

instance Gettable GenesisRoot ContextM where
  get = do
    db <- getStateDB
    GenesisRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmGenesisRootKey
instance Puttable GenesisRoot ContextM where
  put (GenesisRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmGenesisRootKey sr
instance Modifiable GenesisRoot ContextM where

instance Gettable BestBlockRoot ContextM where
  get = do
    db <- getStateDB
    BestBlockRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBestBlockRootKey
instance Puttable BestBlockRoot ContextM where
  put (BestBlockRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBestBlockRootKey sr
instance Modifiable BestBlockRoot ContextM where

instance Gettable K.KafkaState ContextM where
  get    = readIORef =<< view (dbs . kafkaState)
instance Puttable K.KafkaState ContextM where
  put ks = view (dbs . kafkaState) >>= flip writeIORef ks
instance Modifiable K.KafkaState ContextM where

instance Gettable CurrentBlockHash ContextM where
  get    = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
instance Puttable CurrentBlockHash ContextM where
  put bh = modify $ memDBs . currentBlock ?~ bh
instance Modifiable CurrentBlockHash ContextM where

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance Selectable MP.NodeData MP.StateRoot ContextM where
  select = MP.genericLookupDB $ getStateDB
instance Insertable MP.NodeData MP.StateRoot ContextM where
  insert = MP.genericInsertDB $ getStateDB
instance Deletable  MP.NodeData MP.StateRoot ContextM where
  delete = MP.genericDeleteDB $ getStateDB
instance Alterable  MP.NodeData MP.StateRoot ContextM where

instance Selectable AddressState Account ContextM where
  select = getAddressStateMaybe
instance Insertable AddressState Account ContextM where
  insert = putAddressState
instance Deletable  AddressState Account ContextM where
  delete = deleteAddressState
instance Alterable  AddressState Account ContextM where

instance Selectable MP.StateRoot (Maybe Word256) ContextM where
  select chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> do
      mSR <- gets $ view $ memDBs . stateRoots . at (bh, chainId)
      case mSR of
        Just sr -> pure $ Just sr
        Nothing -> getChainStateRoot chainId bh
instance Insertable MP.StateRoot (Maybe Word256) ContextM where
  insert chainId sr = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
        putChainStateRoot chainId bh sr
instance Deletable  MP.StateRoot (Maybe Word256) ContextM where
  delete chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh
instance Alterable  MP.StateRoot (Maybe Word256) ContextM where

instance Selectable ParentChainId (Maybe Word256) ContextM where
  select chainId = fmap (\(_,_,p) -> ParentChainId p) <$> getChainGenesisInfo chainId

instance Selectable DBCode Keccak256 ContextM where
  select = genericLookupCodeDB $ getCodeDB
instance Insertable DBCode Keccak256 ContextM where
  insert = genericInsertCodeDB $ getCodeDB
instance Deletable  DBCode Keccak256 ContextM where
  delete = genericDeleteCodeDB $ getCodeDB
instance Alterable  DBCode Keccak256 ContextM where

instance Selectable X509Certificate Account ContextM where
  select = genericLookupX509CertDB $ getX509CertDB
instance Insertable X509Certificate Account ContextM where
  insert = genericInsertX509CertDB $ getX509CertDB
instance Deletable  X509Certificate Account ContextM where
  delete = genericDeleteX509CertDB $ getX509CertDB
instance Alterable  X509Certificate Account ContextM where

instance Selectable N.NibbleString N.NibbleString ContextM where
  select = genericLookupHashDB $ getHashDB
instance Insertable N.NibbleString N.NibbleString ContextM where
  insert = genericInsertHashDB $ getHashDB
instance Deletable  N.NibbleString N.NibbleString ContextM where
  delete = genericDeleteHashDB $ getHashDB
instance Alterable  N.NibbleString N.NibbleString ContextM where

instance HasMemRawStorageDB ContextM where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance Selectable RawStorageValue RawStorageKey ContextM where
  select = genericLookupRawStorageDB
  selectWithFallback = genericLookupWithFallbackRawStorageDB
instance Insertable RawStorageValue RawStorageKey ContextM where
  insert = genericInsertRawStorageDB
instance Deletable  RawStorageValue RawStorageKey ContextM where
  delete = genericDeleteRawStorageDB
instance Alterable  RawStorageValue RawStorageKey ContextM where

instance Selectable BlockSummary Keccak256 ContextM where
  select = genericLookupBlockSummaryDB $ getBlockSummaryDB
instance Insertable BlockSummary Keccak256 ContextM where
  insert = genericInsertBlockSummaryDB $ getBlockSummaryDB
instance Deletable  BlockSummary Keccak256 ContextM where
  delete = genericDeleteBlockSummaryDB $ getBlockSummaryDB
instance Alterable  BlockSummary Keccak256 ContextM where

instance (Monad m, MonadReader Context m) => Gettable SQLDB m where
  get = view $ dbs . sqldb

instance Gettable RBDB.RedisConnection ContextM where
  get = view $ dbs . redisPool

instance Gettable (Maybe WorldBestBlock) ContextM where
  get = do
    mRBB <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
    for mRBB $ \(RedisBestBlock sha num diff) ->
      return . WorldBestBlock $ BestBlock sha num diff

instance MonadMonitor (ResourceT (LoggingT IO)) where
    doIO = liftIO

runTestContextM :: ( MonadIO m
                   , MonadUnliftIO m
                   , HasStateDB (ReaderT Context (ResourceT m))
                   )
                => ReaderT Context (ResourceT m) a
                -> m (a, ContextState)
runTestContextM f = withSystemTempDirectory "test_evm_context" $ \tmpdir ->
  withTempFile tmpdir "evm.sqlite" $ \filepath _ ->
    runResourceT $ do
      conn <- runNoLoggingT $ Lite.createSqlitePool (T.pack filepath) 20
      let ldbOptions = DB.defaultOptions {
        DB.createIfMissing = True,
        DB.cacheSize = flags_ldbCacheSize,
        DB.blockSize = flags_ldbBlockSize
      }
      let openDB base = DB.open (tmpdir ++ base) ldbOptions
      sdb <- openDB stateDBPath
      hdb <- openDB hashDBPath
      cdb <- openDB codeDBPath
      x509db <- openDB x509CertDBPath
      blksumdb <- openDB blockSummaryCacheDBPath
      rPool <- liftIO . Redis.connect $ Redis.defaultConnectInfo {
        Redis.connectHost = "localhost",
        Redis.connectPort = Redis.PortNumber 2023,
        Redis.connectDatabase = 0
      }
      initialKafkaState <- newIORef $ K.mkKafkaState
                                        (K.KString "fake_client")
                                        (K.Host (K.KString "localhost"), K.Port 1234132)
      cache <- liftIO $ TRC.new 64

      let cdbs = ContextDBs
            { _stateDB        = MP.StateDB sdb
            , _hashDB         = HashDB hdb
            , _codeDB         = CodeDB cdb
            , _x509CertDB     = X509CertDB x509db
            , _blockSummaryDB = BlockSummaryDB blksumdb
            , _kafkaState     = initialKafkaState
            , _redisPool      = RBDB.RedisConnection rPool
            , _sqldb          = SQLDB conn
            }

      let cmemDBs = MemDBs
            { _stateTxMap      = M.empty
            , _stateBlockMap   = M.empty
            , _storageTxMap    = M.empty
            , _storageBlockMap = M.empty
            , _stateRoots      = M.empty
            , _currentBlock    = Nothing
            }

      cstate <- newIORef $ ContextState
            { _memDBs            = cmemDBs
            , _baggerState       = defaultBaggerState
            , _bestBlockInfo     = Unspecified
            , _hasBlockstanbul   = False
            , _blockRequested    = False
            , _coinbaseQueue     = Q.empty
            , _txRunResultsCache = cache
            , _debugSettings     = Nothing
            }

      let ctx = Context
            { _dbs   = cdbs
            , _state = cstate
            }
      a <- flip runReaderT ctx $ do
        MP.initializeBlank
        setStateDBStateRoot Nothing MP.emptyTriePtr
        f
      cstate' <- readIORef cstate
      return (a, cstate')

runContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m)
            => Maybe DebugSettings
            -> ReaderT Context (ResourceT m) a
            -> m (a, ContextState)
runContextM dSettings f = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    runResourceT $ do
      conn <- createPostgresqlPool connStr 20
      let ldbOptions = DB.defaultOptions
            { DB.createIfMissing = True
            , DB.cacheSize       = flags_ldbCacheSize
            , DB.blockSize       = flags_ldbBlockSize
            }
      sdb <- DB.open (dbDir "h" ++ stateDBPath) ldbOptions
      hdb <- DB.open (dbDir "h" ++ hashDBPath)  ldbOptions
      cdb <- DB.open (dbDir "h" ++ codeDBPath)  ldbOptions
      x509db <- DB.open (dbDir "h" ++ x509CertDBPath) ldbOptions
      blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
      rPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
      kafkaStateRef <- newIORef $ mkConfiguredKafkaState "ethereum-vm"
      cache <- liftIO $ TRC.new 64

      let cdbs = ContextDBs
            { _stateDB        = MP.StateDB sdb
            , _hashDB         = HashDB hdb
            , _codeDB         = CodeDB cdb
            , _x509CertDB     = X509CertDB x509db
            , _blockSummaryDB = BlockSummaryDB blksumdb
            , _kafkaState     = kafkaStateRef
            , _redisPool      = RBDB.RedisConnection rPool
            , _sqldb          = conn
            }

      let cmemDBs = MemDBs
            { _stateTxMap      = M.empty
            , _stateBlockMap   = M.empty
            , _storageTxMap    = M.empty
            , _storageBlockMap = M.empty
            , _stateRoots      = M.empty
            , _currentBlock    = Nothing
            }

      cstate <- newIORef $ ContextState
            { _memDBs            = cmemDBs
            , _baggerState       = defaultBaggerState
            , _bestBlockInfo     = Unspecified
            , _hasBlockstanbul   = flags_blockstanbul
            , _blockRequested    = False
            , _coinbaseQueue     = Q.empty
            , _txRunResultsCache = cache
            , _debugSettings     = dSettings
            }

      let ctx = Context
            { _dbs   = cdbs
            , _state = cstate
            }
      a <- runReaderT f ctx
      cstate' <- readIORef cstate
      return (a, cstate')


evalContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m)
             => Maybe DebugSettings
             -> ReaderT Context (ResourceT m) a
             -> m a
evalContextM d f = fst <$> runContextM d f

execContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m)
             => Maybe DebugSettings
             -> ReaderT Context (ResourceT m) a
             -> m ContextState
execContextM d f = snd <$> runContextM d f

incrementNonce :: (Account `Alters` AddressState) f => Account -> f ()
incrementNonce account = adjustWithDefault_ account $ \addressState ->
  pure addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress :: (MonadIO m, (Account `Alters` AddressState) m) => Account -> m Account
getNewAddress account = do
  nonce <- addressStateNonce <$> selectWithDefault account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty account) ++ ", nonce=" ++ show nonce
  let newAddress = getNewAddress_unsafe (account ^. accountAddress) nonce
  incrementNonce account
  return $ (accountAddress .~ newAddress) account

purgeStorageMap :: HasMemStorageDB m => Account -> m ()
purgeStorageMap account = do
  storageMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.filterWithKey (const . (/= account) . fst) storageMap

getContextBestBlockInfo :: Gettable ContextState m => m ContextBestBlockInfo
getContextBestBlockInfo = _bestBlockInfo <$> FT.get

putContextBestBlockInfo :: Modifiable ContextState m => ContextBestBlockInfo -> m ()
putContextBestBlockInfo new = modifyStatefully_ $ assign bestBlockInfo new

queuePendingVote :: ( MonadLogger m
                    , Modifiable ContextState m
                    )
                 => Address -> Bool -> Address -> m ()
queuePendingVote a r s = do
  let nonce = case r of
        True -> maxBound
        False -> 0
      newVote = ((a, nonce), s)
  $logInfoLS "queuePendingVote" newVote
  modifyStatefully_ @ContextState $ coinbaseQueue %= (newVote Q.<|)

-- (Coinbase, Nonce) to be applied on a constructed block
-- When no pending votes are available, supplies the default coinbase (0x0)
peekPendingVote :: ( MonadLogger m
                   , Gettable ContextState m
                   )
                => m (Address, Word64)
peekPendingVote = do
  ctx <- FT.get @ContextState
  case Q.viewl $ _coinbaseQueue ctx of
    Q.EmptyL -> return (0,0)
    ( v Q.:< _) -> do
      $logInfoLS "peekPendingVote" v
      return $ fst v

-- If the Block was sent out by us and contains our vote,
-- mark the vote as committed and remove it from the queue.
clearPendingVote :: ( MonadLogger m
                    , Modifiable ContextState m
                    )
                 => Block -> m ()
clearPendingVote b = modifyStatefully_ @ContextState $ do
  let bd = blockBlockData b
      currentBlockData = (blockDataCoinbase bd, blockDataNonce bd)
      sender = fromMaybe 0x0 $ Auth.verifyProposerSeal b =<< Auth.getProposerSeal b
  ctxCoinbaseQ <- use coinbaseQueue
  let newCoinbaseQ = case Q.elemIndexL (currentBlockData, sender) ctxCoinbaseQ of
        Just i -> Q.deleteAt i ctxCoinbaseQ
        Nothing -> ctxCoinbaseQ
  $logInfoLS "clearPendingVote" currentBlockData
  assign coinbaseQueue newCoinbaseQ

compactContextM :: ContextM ()
compactContextM = modify' force
