{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.VMContext
  ( CurrentBlockHash (..),
    IsBlockstanbul (..),
    withCurrentBlockHash,
    VMBase,
    ContextDBs (..),
    MemDBs (..),
    ContextState (..),
    QueueEvent (..),
    Context (..),
    ContextBestBlockInfo (..),
    ContextM,
    GasCap (..),
    stateDB,
    hashDB,
    codeDB,
    blockSummaryDB,
    redisPool,
    sqldb,
    stateTxMap,
    stateBlockMap,
    storageTxMap,
    storageBlockMap,
    stateRoots,
    currentBlock,
    memDBs,
    baggerState,
    bestBlockInfo,
    vmGasCap,
    hasBlockstanbul,
    blockRequested,
    runningTests,
    txRunResultsCache,
    debugSettings,
    dbs,
    state,
    stateDiffQueue,
    runTestContextM,
    initContext,
    runContextM,
    runContextM',
    evalContextM,
    evalContextM',
    execContextM,
    execContextM',
    incrementNonce,
    getNewAddress,
    getNewAddressWithSalt,
    purgeStorageMap,
    getContextBestBlockInfo,
    putContextBestBlockInfo,
    checkIfRunningTests,
    lookupX509AddrFromCBHash,
    knownFailedTxs,
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Bagger.BaggerState (BaggerState, defaultBaggerState)
import Blockchain.Constants
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.StateDiff (StateDiff)
import Blockchain.Stream.VMEvent
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VM.SolidException
import Blockchain.VMOptions
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.Default
import qualified Data.Map as M
import qualified Data.NibbleString as N
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import qualified Database.LevelDB as DB
import qualified Database.Persist.Sqlite as Lite
import qualified Database.Redis as Redis
import Debugger
import Executable.EVMFlags
import GHC.Generics
import SolidVM.Model.Storable
import SolidVM.Model.Value
import System.Directory
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))
import UnliftIO

{-# NOINLINE knownFailedTxs #-}
knownFailedTxs :: S.Set Keccak256
knownFailedTxs =
  S.fromList
    [ keccak256FromHex "d924cd206a64fe1a6acd77af0a25f2acc4acd23d5a169caf2e701cb9cfc3d7d8",
      keccak256FromHex "3058b1027e6e69d6faa9e13fb897c10343ae8cd0d302404a70aee9d2bad316da",
      keccak256FromHex "283b2bb2fc3a9ad81fae7286ad89115979474ae953b55fef627f39aa409c2133",
      keccak256FromHex "b9335249f18645559cc84493071c3d0641c35232cd7814f45eb04d990afae921",
      keccak256FromHex "a257f8fa9ef7a7b4de81ddf518b3492e1716894879dec8c37be3ec6a4beef553",
      keccak256FromHex "2f719b6227fa0316cb71c033183b2f282ed06ae42ca8f50e1c1cead57840134c",
      keccak256FromHex "2637c3b60b6bd1d098adc109877ba1b1c40c59889f2e8ef6d03fb5657836f70f",
      keccak256FromHex "5439d5802b32b50c29b4f26bb47a7cff3121229798dabed7e7ca7e6a5c0658f2"
    ]

newtype CurrentBlockHash = CurrentBlockHash {unCurrentBlockHash :: Keccak256}
  deriving (Generic, NFData, Show)

newtype IsBlockstanbul = IsBlockstanbul {unIsBlockstanbul :: Bool}
  deriving (Generic, NFData, Show, Eq)

newtype GasCap = GasCap {unVmGasCap :: Gas}
  deriving (Generic, NFData, Show, Eq)

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo !Keccak256 !BlockData !Integer !Int !Int
  deriving (Eq, Read, Show, Generic, NFData)

data ContextDBs = ContextDBs
  { _stateDB :: MP.StateDB,
    _hashDB :: HashDB,
    _codeDB :: CodeDB,
    _blockSummaryDB :: BlockSummaryDB,
    _redisPool :: RBDB.RedisConnection,
    _sqldb :: SQLDB
  }
  deriving (Generic, NFData)

makeLenses ''ContextDBs

data MemDBs = MemDBs
  { _stateTxMap :: !(M.Map Account AddressStateModification),
    _stateBlockMap :: !(M.Map Account AddressStateModification),
    _storageTxMap :: !(M.Map (Account, B.ByteString) B.ByteString),
    _storageBlockMap :: !(M.Map (Account, B.ByteString) B.ByteString),
    _stateRoots :: !(M.Map (Keccak256, Maybe Word256) MP.StateRoot),
    _currentBlock :: !(Maybe CurrentBlockHash)
  }
  deriving (Generic, NFData, Show)

makeLenses ''MemDBs

instance Default MemDBs where
  def =
    MemDBs
      { _stateTxMap = M.empty,
        _stateBlockMap = M.empty,
        _storageTxMap = M.empty,
        _storageBlockMap = M.empty,
        _stateRoots = M.empty,
        _currentBlock = Nothing
      }

data ContextState = ContextState
  { _memDBs :: !MemDBs,
    _baggerState :: !BaggerState,
    _bestBlockInfo :: !ContextBestBlockInfo,
    _vmGasCap :: !Gas,
    _hasBlockstanbul :: !Bool,
    _blockRequested :: !Bool,
    _runningTests :: !Bool,
    _txRunResultsCache :: TRC.Cache,
    _debugSettings :: !(Maybe DebugSettings)
  }
  deriving (Generic, NFData)

makeLenses ''ContextState

instance Default ContextState where
  def =
    ContextState
      { _memDBs = def,
        _baggerState = defaultBaggerState,
        _bestBlockInfo = Unspecified,
        _vmGasCap = Gas flags_gasLimit,
        _hasBlockstanbul = True,
        _blockRequested = False,
        _runningTests = False,
        _txRunResultsCache = error "Default ContextState: accessing uninitialized txRunResultsCache",
        _debugSettings = Nothing
      }

data QueueEvent
  = TXR TransactionResult
  | SD StateDiff
  | VME [VMEvent]
  | Flush

data Context = Context
  { _dbs :: ContextDBs,
    _state :: IORef ContextState,
    _stateDiffQueue :: (TQueue QueueEvent)
  }
  deriving (Generic)

makeLenses ''Context

type ContextM = ReaderT Context (ResourceT (LoggingT IO))

type VMBase m =
  ( MonadIO m,
    MonadCatch m,
    MonadUnliftIO m,
    MonadLogger m,
    Mod.Modifiable (Maybe DebugSettings) m,
    Mod.Modifiable ContextState m,
    Mod.Accessible ContextState m,
    Mod.Modifiable MemDBs m,
    Mod.Accessible MemDBs m,
    Mod.Modifiable BlockHashRoot m,
    Mod.Modifiable GenesisRoot m,
    Mod.Modifiable BestBlockRoot m,
    Mod.Modifiable CurrentBlockHash m,
    Mod.Modifiable GasCap m,
    HasMemAddressStateDB m,
    A.Selectable Word256 ParentChainIds m,
    A.Selectable Account AddressState m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Account `A.Alters` AddressState) m,
    (Keccak256 `A.Alters` DBCode) m,
    (N.NibbleString `A.Alters` N.NibbleString) m,
    HasMemRawStorageDB m,
    (RawStorageKey `A.Alters` RawStorageValue) m,
    (Keccak256 `A.Alters` BlockSummary) m,
    Mod.Accessible (Maybe WorldBestBlock) m,
    (A.Selectable (Address, T.Text) X509CertificateField) m,
    (A.Selectable Address X509Certificate) m
  )

withCurrentBlockHash ::
  ( MonadLogger m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable CurrentBlockHash m,
    HasMemAddressStateDB m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Account `A.Alters` AddressState) m,
    (N.NibbleString `A.Alters` N.NibbleString) m,
    HasMemRawStorageDB m,
    (RawStorageKey `A.Alters` RawStorageValue) m
  ) =>
  Keccak256 ->
  m a ->
  m a
withCurrentBlockHash bh f = do
  cbh <- Mod.get (Mod.Proxy @CurrentBlockHash)
  Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bh)
  a <- f
  flushMemStorageDB
  flushMemAddressStateDB
  Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ stateRoots .= M.empty
  Mod.put (Mod.Proxy @CurrentBlockHash) cbh
  pure a


instance Show Context where
  show = const "<context>"

lookupX509AddrFromCBHash ::
  ( MonadLogger m,
    (A.Alters (Account, B.ByteString) B.ByteString) m
  ) =>
  Address ->
  m (Maybe Address)
lookupX509AddrFromCBHash k = do
  let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
      certRegistryKey = certKey (Address 0x509)
  mAccount <- fmap (rlpDecode . rlpDeserialize) <$> A.lookup (A.Proxy) (certRegistryKey . T.pack $ ".addressToCertMap<a:" <> show k <> ">")
  $logDebugS "lookupX509AddrFromCBHash" $ T.pack $ "Looking up certificate for address: " ++ (show mAccount)
  case mAccount of
    Just (BAccount a) -> pure . Just $ a ^. namedAccountAddress
    _ -> pure Nothing

runTestContextM ::
  ( MonadUnliftIO m,
    HasStateDB (ReaderT Context (ResourceT m))
  ) =>
  ReaderT Context (ResourceT m) a ->
  m (a, ContextState)
runTestContextM f = withSystemTempDirectory "test_evm_context" $ \tmpdir ->
  withTempFile tmpdir "evm.sqlite" $ \filepath _ ->
    runResourceT $ do
      conn <- runNoLoggingT $ Lite.createSqlitePool (T.pack filepath) 20
      let ldbOptions =
            DB.defaultOptions
              { DB.createIfMissing = True,
                DB.cacheSize = flags_ldbCacheSize,
                DB.blockSize = flags_ldbBlockSize
              }
      let openDB base = DB.open (tmpdir ++ base) ldbOptions
      sdb <- openDB stateDBPath
      hdb <- openDB hashDBPath
      cdb <- openDB codeDBPath
      blksumdb <- openDB blockSummaryCacheDBPath
      rPool <-
        liftIO . Redis.connect $
          Redis.defaultConnectInfo
            { Redis.connectHost = "localhost",
              Redis.connectPort = Redis.PortNumber 2023,
              Redis.connectDatabase = 0
            }
      cache <- liftIO $ TRC.new 64

      let cdbs =
            ContextDBs
              { _stateDB = MP.StateDB sdb,
                _hashDB = HashDB hdb,
                _codeDB = CodeDB cdb,
                _blockSummaryDB = BlockSummaryDB blksumdb,
                _redisPool = RBDB.RedisConnection rPool,
                _sqldb = SQLDB conn
              }

      let cmemDBs =
            MemDBs
              { _stateTxMap = M.empty,
                _stateBlockMap = M.empty,
                _storageTxMap = M.empty,
                _storageBlockMap = M.empty,
                _stateRoots = M.empty,
                _currentBlock = Nothing
              }

      cstate <-
        newIORef $
          ContextState
            { _memDBs = cmemDBs,
              _baggerState = defaultBaggerState,
              _bestBlockInfo = Unspecified,
              _hasBlockstanbul = False,
              _vmGasCap = 100000,
              _blockRequested = False,
              _runningTests = True,
              _txRunResultsCache = cache,
              _debugSettings = Nothing
            }
      que <- newTQueueIO
      let ctx =
            Context
              { _dbs = cdbs,
                _state = cstate,
                _stateDiffQueue = que
              }
      a <- flip runReaderT ctx $ do
        MP.initializeBlank
        setStateDBStateRoot Nothing MP.emptyTriePtr
        f
      cstate' <- readIORef cstate
      return (a, cstate')

initContext ::
  (MonadUnliftIO m, MonadLoggerIO m, MonadResource m) =>
  Maybe DebugSettings ->
  m Context
initContext dSettings = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  conn <- createPostgresqlPool connStr 20
  let ldbOptions =
        DB.defaultOptions
          { DB.createIfMissing = True,
            DB.cacheSize = flags_ldbCacheSize,
            DB.blockSize = flags_ldbBlockSize
          }
  sdb <- DB.open (dbDir "h" ++ stateDBPath) ldbOptions
  hdb <- DB.open (dbDir "h" ++ hashDBPath) ldbOptions
  cdb <- DB.open (dbDir "h" ++ codeDBPath) ldbOptions
  blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
  rPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
  cache <- liftIO $ TRC.new 64

  let cdbs =
        ContextDBs
          { _stateDB = MP.StateDB sdb,
            _hashDB = HashDB hdb,
            _codeDB = CodeDB cdb,
            _blockSummaryDB = BlockSummaryDB blksumdb,
            _redisPool = RBDB.RedisConnection rPool,
            _sqldb = conn
          }

  cstate <-
    newIORef $
      def
        & txRunResultsCache .~ cache
        & debugSettings .~ dSettings
        & hasBlockstanbul .~ flags_blockstanbul
  que <- newTQueueIO
  pure
    Context
      { _dbs = cdbs,
        _state = cstate,
        _stateDiffQueue = que
      }

runContextM ::
  (MonadUnliftIO m, MonadLoggerIO m) =>
  Maybe DebugSettings ->
  ReaderT Context (ResourceT m) a ->
  m (a, ContextState)
runContextM dSettings f = do
  liftIO $ createDirectoryIfMissing False $ dbDir "h"
  runResourceT $ do
    ctx <- initContext dSettings
    runContextM' ctx f

runContextM' ::
  MonadUnliftIO m =>
  Context ->
  ReaderT Context m a ->
  m (a, ContextState)
runContextM' ctx f = do
  a <- runReaderT f ctx
  cstate' <- readIORef $ ctx ^. state
  return (a, cstate')

evalContextM ::
  (MonadUnliftIO m, MonadLoggerIO m) =>
  Maybe DebugSettings ->
  ReaderT Context (ResourceT m) a ->
  m a
evalContextM d f = fst <$> runContextM d f

evalContextM' ::
  MonadUnliftIO m =>
  Context ->
  ReaderT Context m a ->
  m a
evalContextM' ctx f = fst <$> runContextM' ctx f

execContextM ::
  (MonadUnliftIO m, MonadLoggerIO m) =>
  Maybe DebugSettings ->
  ReaderT Context (ResourceT m) a ->
  m ContextState
execContextM d f = snd <$> runContextM d f

execContextM' ::
  MonadUnliftIO m =>
  Context ->
  ReaderT Context m a ->
  m ContextState
execContextM' ctx f = snd <$> runContextM' ctx f

incrementNonce :: (Account `A.Alters` AddressState) f => Account -> f ()
incrementNonce account = A.adjustWithDefault_ Mod.Proxy account $ \addressState ->
  pure addressState {addressStateNonce = addressStateNonce addressState + 1}

getNewAddress :: (MonadIO m, (Account `A.Alters` AddressState) m) => Account -> m Account
getNewAddress account = do
  nonce <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty account) ++ ", nonce=" ++ show nonce
  let newAddress = getNewAddress_unsafe (account ^. accountAddress) nonce
  incrementNonce account
  return $ (accountAddress .~ newAddress) account

getNewAddressWithSalt :: (MonadIO m, MonadLogger m, (Account `A.Alters` AddressState) m) => Account -> Value -> Keccak256 -> String -> m Account
getNewAddressWithSalt account salt hsh args = do
  nonce <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ show (pretty account) ++ ", nonce=" ++ show nonce
  let saltAsString = case salt of
        (SString s) -> s
        _ -> invalidArguments "big major bad" salt
  let newAddress = getNewAddressWithSalt_unsafe (account ^. accountAddress) saltAsString (keccak256ToByteString hsh) args
  $logDebugS "getNewAddressWithSalt" $ T.pack $ (show $ account ^. accountAddress) ++ " " ++ saltAsString ++ " " ++ (show $ keccak256ToByteString hsh) ++ " " ++ args
  doesAddressAlreadyExist <- A.lookup (Mod.Proxy @AddressState) $ Account newAddress (_accountChainId account)
  case doesAddressAlreadyExist of
    Just _ -> duplicateContract $ "The address " ++ (show newAddress) ++ " already exists. Try using a different salt or constructor arguments."
    Nothing -> do
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

checkIfRunningTests :: (Functor m, Mod.Accessible ContextState m) => m Bool
checkIfRunningTests = _runningTests <$> Mod.access Mod.Proxy

