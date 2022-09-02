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
    , IsBlockstanbul(..)
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
    , certTxMap
    , certBlockMap
    , stateRoots
    , currentBlock
    , memDBs
    , baggerState
    , bestBlockInfo
    , hasBlockstanbul
    , blockRequested
    , coinbaseQueue
    , txRunResultsCache
    , debugSettings
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
    , getNewAddressWithSalt
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
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                    as B
import           Data.Default
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

import           BlockApps.Init()
import           BlockApps.Logging
import           Blockchain.Bagger.BaggerState      (BaggerState, defaultBaggerState)
import           Blockchain.Blockstanbul.Authentication as Auth
import           Blockchain.Constants
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.Block
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
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
import           Blockchain.DB.X509CertDB
import           Blockchain.EthConf
import           Blockchain.Strato.Model.CodePtr()
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import           Blockchain.Data.RLP
import qualified Blockchain.TxRunResultCache        as TRC
import           Blockchain.VM.SolidException
import           Blockchain.VMOptions

import           SolidVM.Model.Value

import           Executable.EVMFlags

import           UnliftIO

newtype CurrentBlockHash = CurrentBlockHash { unCurrentBlockHash :: Keccak256 }
  deriving (Generic, NFData, Show)

newtype IsBlockstanbul = IsBlockstanbul { unIsBlockstanbul :: Bool }
  deriving (Generic, NFData, Show, Eq)

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
  , _certTxMap       :: M.Map Address CertModification
  , _certBlockMap    :: M.Map Address CertModification
  , _stateRoots      :: M.Map (Keccak256, Maybe Word256) MP.StateRoot
  , _currentBlock    :: Maybe CurrentBlockHash
  } deriving (Generic, NFData, Show)
makeLenses ''MemDBs

instance Default MemDBs where
  def = MemDBs
    { _stateTxMap      = M.empty
    , _stateBlockMap   = M.empty
    , _storageTxMap    = M.empty
    , _storageBlockMap = M.empty
    , _certTxMap       = M.empty
    , _certBlockMap    = M.empty
    , _stateRoots      = M.empty
    , _currentBlock    = Nothing
    }

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

instance Default ContextState where
  def = ContextState
    { _memDBs            = def
    , _baggerState       = defaultBaggerState
    , _bestBlockInfo     = Unspecified
    , _hasBlockstanbul   = True
    , _blockRequested    = False
    , _coinbaseQueue     = Q.empty
    , _txRunResultsCache = error "Default ContextState: accessing uninitialized txRunResultsCache"
    , _debugSettings     = Nothing
    }

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
                , Mod.Modifiable (Maybe DebugSettings) m
                , Mod.Modifiable ContextState m
                , Mod.Accessible ContextState m
                , Mod.Modifiable MemDBs m
                , Mod.Accessible MemDBs m
                , Mod.Modifiable BlockHashRoot m
                , Mod.Modifiable GenesisRoot m
                , Mod.Modifiable BestBlockRoot m
                , Mod.Modifiable CertRoot m
                , Mod.Modifiable CurrentBlockHash m
                , HasMemAddressStateDB m
                , HasMemCertDB m
                , A.Selectable (Maybe Word256) ParentChainId m
                , (Maybe Word256 `A.Alters` MP.StateRoot) m
                , (MP.StateRoot `A.Alters` MP.NodeData) m
                , (Account `A.Alters` AddressState) m
                , (Keccak256 `A.Alters` DBCode) m
                , HasX509CertDB m
                , (N.NibbleString `A.Alters` N.NibbleString) m
                , HasMemRawStorageDB m
                , (RawStorageKey `A.Alters` RawStorageValue) m
                , (Keccak256 `A.Alters` BlockSummary) m
                , Mod.Accessible (Maybe WorldBestBlock) m
                )

withCurrentBlockHash :: ( MonadLogger m
                        , Mod.Modifiable MemDBs m
                        , Mod.Modifiable CurrentBlockHash m
                        , HasMemAddressStateDB m
                        , (Maybe Word256 `A.Alters` MP.StateRoot) m
                        , (MP.StateRoot `A.Alters` MP.NodeData) m
                        , (Account `A.Alters` AddressState) m
                        , (N.NibbleString `A.Alters` N.NibbleString) m
                        , HasMemRawStorageDB m
                        , (RawStorageKey `A.Alters` RawStorageValue) m
                        )
                     => Keccak256 -> m a -> m a
withCurrentBlockHash bh f = do
  cbh <- Mod.get (Mod.Proxy @CurrentBlockHash)
  Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bh)
  a <- f
  flushMemStorageDB
  flushMemAddressStateDB
  Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ stateRoots .= M.empty
  Mod.put (Mod.Proxy @CurrentBlockHash) cbh
  pure a

getStateDB :: ContextM DB.DB
getStateDB = fmap MP.unStateDB . view $ dbs . stateDB

getHashDB :: ContextM HashDB
getHashDB = view $ dbs . hashDB

getCodeDB :: ContextM CodeDB
getCodeDB = view $ dbs . codeDB

getBlockSummaryDB :: ContextM BlockSummaryDB
getBlockSummaryDB = view $ dbs . blockSummaryDB

get :: ContextM ContextState
get = readIORef =<< view state
{-# INLINE get #-}

gets :: (ContextState -> a) -> ContextM a
gets f = f <$> get
{-# INLINE gets #-}

put :: ContextState -> ContextM ()
put c = view state >>= \i -> atomicModifyIORef' i (const (c, ()))
{-# INLINE put #-}

modify :: (ContextState -> ContextState) -> ContextM ()
modify f = view state >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
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

instance Mod.Modifiable ContextState ContextM where
  get _ = get
  put _ = put

instance Mod.Accessible Context ContextM where
  access _ = ask

instance Mod.Modifiable (Maybe DebugSettings) ContextM where
  get _    = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance Mod.Accessible ContextState ContextM where
  access _ = get

instance Mod.Accessible MemDBs ContextM where
  access _ = gets $ view memDBs

instance Mod.Modifiable MemDBs ContextM where
  get _    = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

instance Mod.Accessible IsBlockstanbul ContextM where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance Mod.Modifiable BaggerState ContextM where
  get _   = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance Mod.Accessible TRC.Cache ContextM where
  access _ = contextGets _txRunResultsCache

instance ContextM `Mod.Yields` TransactionResult where
  yield = void . putTransactionResult

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

vmCertRootKey :: B.ByteString
vmCertRootKey = "cert_root"

instance Mod.Modifiable BlockHashRoot ContextM where
  get _ = do
    db <- getStateDB
    BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBlockHashRootKey
  put _ (BlockHashRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBlockHashRootKey sr

instance Mod.Modifiable GenesisRoot ContextM where
  get _ = do
    db <- getStateDB
    GenesisRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmGenesisRootKey
  put _ (GenesisRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmGenesisRootKey sr

instance Mod.Modifiable BestBlockRoot ContextM where
  get _ = do
    db <- getStateDB
    BestBlockRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBestBlockRootKey
  put _ (BestBlockRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmBestBlockRootKey sr

instance Mod.Modifiable CertRoot ContextM where
  get _ = do
    db <- getStateDB
    CertRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmCertRootKey
  put _ (CertRoot (MP.StateRoot sr)) = do
    db <- getStateDB
    DB.put db def vmCertRootKey sr

instance Mod.Modifiable K.KafkaState ContextM where
  get _    = readIORef =<< view (dbs . kafkaState)
  put _ ks = view (dbs . kafkaState) >>= flip writeIORef ks

instance Mod.Modifiable CurrentBlockHash ContextM where
  get _    = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance HasMemCertDB ContextM where
  getCertTxDBMap = gets $ view $ memDBs . certTxMap
  putCertTxDBMap theMap = modify $ memDBs . certTxMap .~ theMap
  getCertBlockDBMap = gets $ view $ memDBs . certBlockMap
  putCertBlockDBMap theMap = modify $ memDBs . certBlockMap .~ theMap

instance (MP.StateRoot `A.Alters` MP.NodeData) ContextM where
  lookup _ = MP.genericLookupDB $ getStateDB
  insert _ = MP.genericInsertDB $ getStateDB
  delete _ = MP.genericDeleteDB $ getStateDB

instance (Account `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (Maybe Word256 `A.Alters` MP.StateRoot) ContextM where
  lookup _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> do
      mSR <- gets $ view $ memDBs . stateRoots . at (bh, chainId)
      case mSR of
        Just sr -> pure $ Just sr
        Nothing -> getChainStateRoot chainId bh
  insert _ chainId sr = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
        putChainStateRoot chainId bh sr
  delete _ chainId = do
    mBH <- gets $ view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh

instance A.Selectable (Maybe Word256) ParentChainId ContextM where
  select _ chainId = fmap (\(_,_,p) -> ParentChainId p) <$> getChainGenesisInfo chainId

instance (Keccak256 `A.Alters` DBCode) ContextM where
  lookup _ = genericLookupCodeDB $ getCodeDB
  insert _ = genericInsertCodeDB $ getCodeDB
  delete _ = genericDeleteCodeDB $ getCodeDB

instance (Address `A.Alters` X509Certificate) ContextM where
  lookup _ k = do
    mBH <- gets $ view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> getCertMaybe k bh
  insert _ = putCert
  delete _ = deleteCert

instance (N.NibbleString `A.Alters` N.NibbleString) ContextM where
  lookup _ = genericLookupHashDB $ getHashDB
  insert _ = genericInsertHashDB $ getHashDB
  delete _ = genericDeleteHashDB $ getHashDB

instance HasMemRawStorageDB ContextM where
  getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (RawStorageKey `A.Alters` RawStorageValue) ContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` BlockSummary) ContextM where
  lookup _ = genericLookupBlockSummaryDB $ getBlockSummaryDB
  insert _ = genericInsertBlockSummaryDB $ getBlockSummaryDB
  delete _ = genericDeleteBlockSummaryDB $ getBlockSummaryDB

instance MonadReader Context m => Mod.Accessible SQLDB m where
  access _ = view $ dbs . sqldb

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = view $ dbs . redisPool

instance Mod.Accessible (Maybe WorldBestBlock) ContextM where
  access _ = do
    mRBB <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
    for mRBB $ \(RedisBestBlock sha num diff) ->
      return . WorldBestBlock $ BestBlock sha num diff

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
            , _certTxMap       = M.empty
            , _certBlockMap    = M.empty
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

runContextM :: (MonadIO m, MonadUnliftIO m, MonadLoggerIO m)
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

      cstate <- newIORef $ def
                         & txRunResultsCache .~ cache
                         & debugSettings .~ dSettings
                         & hasBlockstanbul .~ flags_blockstanbul

      let ctx = Context
            { _dbs   = cdbs
            , _state = cstate
            }
      a <- runReaderT f ctx
      cstate' <- readIORef cstate
      return (a, cstate')


evalContextM :: (MonadIO m, MonadUnliftIO m, MonadLoggerIO m)
             => Maybe DebugSettings
             -> ReaderT Context (ResourceT m) a
             -> m a
evalContextM d f = fst <$> runContextM d f

execContextM :: (MonadIO m, MonadUnliftIO m, MonadLoggerIO m)
             => Maybe DebugSettings
             -> ReaderT Context (ResourceT m) a
             -> m ContextState
execContextM d f = snd <$> runContextM d f

incrementNonce :: (Account `A.Alters` AddressState) f => Account -> f ()
incrementNonce account = A.adjustWithDefault_ Mod.Proxy account $ \addressState ->
  pure addressState{ addressStateNonce = addressStateNonce addressState + 1 }

getNewAddress :: (MonadIO m, (Account `A.Alters` AddressState) m) => Account -> m Account
getNewAddress account = do
  nonce <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty account) ++ ", nonce=" ++ show nonce
  let newAddress = getNewAddress_unsafe (account ^. accountAddress) nonce
  incrementNonce account
  return $ (accountAddress .~ newAddress) account

getNewAddressWithSalt :: (MonadIO m, (Account `A.Alters` AddressState) m) => Account -> Value -> String -> Keccak256 -> m Account
getNewAddressWithSalt account salt cname hsh = do
  nonce <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty account) ++ ", nonce=" ++ show nonce
  let rlpEncodedSalt = case salt of
          (SInteger i) -> rlpEncode i
          (SString s) -> rlpEncode s
          _ -> invalidArguments "big major bad" salt
  let newAddress = getNewAddressWithSalt_unsafe (account ^. accountAddress) rlpEncodedSalt cname $ keccak256ToByteString hsh
  incrementNonce account
  return $ (accountAddress .~ newAddress) account

purgeStorageMap :: HasMemStorageDB m => Account -> m ()
purgeStorageMap account = do
  storageMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.filterWithKey (const . (/= account) . fst) storageMap

getContextBestBlockInfo :: (Functor m, Mod.Accessible ContextState m) => m ContextBestBlockInfo
getContextBestBlockInfo = _bestBlockInfo <$> Mod.access Mod.Proxy

putContextBestBlockInfo :: Mod.Modifiable ContextState m => ContextBestBlockInfo -> m ()
putContextBestBlockInfo new = Mod.modifyStatefully_ Mod.Proxy $ assign bestBlockInfo new

queuePendingVote :: ( MonadLogger m
                    , Mod.Modifiable ContextState m
                    )
                 => Address -> Bool -> Address -> m ()
queuePendingVote a r s = do
  let voteDir = case r of
        True -> maxBound
        False -> 0
      newVote = ((a, voteDir), s)
  $logInfoLS "queuePendingVote" newVote
  Mod.modifyStatefully_ (Mod.Proxy @ContextState) $ coinbaseQueue %= (newVote Q.<|)

-- (Coinbase, Vote Direction) to be applied on a constructed block
-- When no pending votes are available, supplies the default coinbase (0x0)
peekPendingVote :: ( MonadLogger m
                   , Mod.Accessible ContextState m
                   )
                => m (Address, Word64)
peekPendingVote = do
  ctx <- Mod.access (Mod.Proxy @ContextState)
  case Q.viewl $ _coinbaseQueue ctx of
    Q.EmptyL -> return (0,0)
    ( v Q.:< _) -> do
      $logInfoLS "peekPendingVote" v
      return $ fst v

-- If the Block was sent out by us and contains our vote,
-- mark the vote as committed and remove it from the queue.
clearPendingVote :: ( MonadLogger m
                    , Mod.Modifiable ContextState m
                    )
                 => Block -> m ()
clearPendingVote b = Mod.modifyStatefully_ (Mod.Proxy @ContextState) $ do
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
