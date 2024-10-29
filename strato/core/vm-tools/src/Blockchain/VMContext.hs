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
    selfAddress,
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
    knownExpensiveTxs,
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
import Blockchain.Data.BlockHeader
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
-- import Blockchain.Stream.VMEvent
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VM.SolidException
import Blockchain.VMOptions
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (when)
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import Data.Binary
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
import Text.Format
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
      keccak256FromHex "5439d5802b32b50c29b4f26bb47a7cff3121229798dabed7e7ca7e6a5c0658f2",
      keccak256FromHex "f59c29a962da7bf265b9c0ff2b200ff4fa5f17896c790092d236e42d8e80c884",
      keccak256FromHex "33582d3e3859c4047193c49965167e73b83575d61848b9bbc537f34126d7c0d9",
      keccak256FromHex "718aee65da51f83ef0e31ee77fcf02c58dc4339b853d49f39fbe98476192738e",
      keccak256FromHex "7d6ebd0c64f1404a6eb9153dff9d204f8b2fdc258dc50d48d6bc2b7c078f3aa4",
      keccak256FromHex "5906242be98d41bf5ec6f21f94b7e93c9830f43ca13c37666a290065347b50f3",
      keccak256FromHex "52fc411fc568f9314dd52ffe23b644369aaf0bed15c3cf27055b5d93fe8eb731",
      keccak256FromHex "b95f4953deabd79ce2abc18fc64d6641a84946463d4dc5b01a107a3dc4194796",
      keccak256FromHex "92440499d2a2d3ed19b44515d27750dbdf195301cf89c348d2323e7559b86c74",
      keccak256FromHex "b4ee1bd7c806af5fb817873ac338bf6374d7285b207066ba13f04199426f44f3",
      keccak256FromHex "6018428ce30ad0dfc053469736e3374f46dd97467db4b6d4202fc316293cbb43",
      keccak256FromHex "0019cc77776f6835da7b4ee2a822f9510ac65ebe423babe4eef51635570996b0",
      keccak256FromHex "283a4486e5ee1b1e2f16ab27a676b83baeecc00c656087126f0bf4ffbf492ed7",
      keccak256FromHex "0ee96c0706187eb9f59ba4fe3dcce3f9c84b0d130dff966cbd93274ddfcf71cd",
      keccak256FromHex "5f249ecd62865555d993dfbd1e85a68de16418a3c674560c2854c68f651f777f",
      keccak256FromHex "e2ba53b360dc81ac9226baa2523bbb79a1ab0d2f8c4c5e6bfdb35f8572762469",
      keccak256FromHex "061b33ea6ee561f1f6467bd6f9d7b2f65d499ab2b62196777235d8c3f11a8d92",
      keccak256FromHex "059d1196cee01836852c5621a3d37ccde6688515f762008a699517d42e6d3eae",
      keccak256FromHex "337c66ec1208140e8d538abdd5ca8b6d1436fc922c565e74e714ef5f4ebaff80",
      keccak256FromHex "e0e417d3b173949df13ee0cac36398a6d5edc1e918d1214afd95c6b0bb887bb0",
      keccak256FromHex "3ebae33f0bbf50d49a5c9015401b669e374e0e4f38f51fb7b5985938bc315618",
      keccak256FromHex "57e8fccebf3438275582bd5994776fc933e1eef62140c9353753d630468376f9",
      keccak256FromHex "e588b6c2975d660e719b2f46c6dc963b4c7e613b5752ef220efda16446f0f6f9",
      keccak256FromHex "05e45c5c4f5598fdeaa93e40b0d166af3ae56d4b4e47e5d7bf30f63999ae4133",
      keccak256FromHex "00bcaccc40f2c32355d22f29383fdaa6440b688c310debc747d26809a6c684f1",
      keccak256FromHex "f818141314af1d0fa2f2908a12fb0a37a3da4442dfa54cb4931a1bc21af2e90f",
      keccak256FromHex "f04b93077e015f2aafa616d3491f19b9a88b3d06ee05ea28d3fbf525ff05d09c",
      keccak256FromHex "e0bc553fd4e009bb480fb51bbe5121b55353900df10990445eb475c7098fb589",
      keccak256FromHex "c8f7aeb55e0f9cf9312b1238d853d8a629bdfacf03ef6bbb4d36614de599bc20",
      keccak256FromHex "e74cb83e74fdee1aa4ac2f01128e88e9a920f254cefbb1ce634f129e81c99645",
      keccak256FromHex "9b2143670637006a95216f09032761abf270373a874e57a39a7f94a13d55578b",
      keccak256FromHex "dc5eed5de678da5fcf90c19ee3ef3b4d368414cd8e2b2d76a77fe81a0fd6e52b",
      keccak256FromHex "e7928fbb324da55279b71d976c9dce7e64d304aa2b61c9e11ca5ef66998ff863",
      keccak256FromHex "4913881b69c175962c8e7afb0a2e2475220b580edb72d92a68fee7edc6656412",
      keccak256FromHex "92703aebf69b9bacf33369b9d1b5be7910fd4ecf07edf7f2d634f0a60ceb9a67",
      keccak256FromHex "d89cfe01606f58ff99045f555c92cac65a62cdccf5820fa6a4eb625915f8e2f1",
      keccak256FromHex "4c389f7b7e93b9f52e83cd3f4635e77873854cacafb0a69e8af7cb225aa8b409",
      keccak256FromHex "f23e7c8bb1087cda43e9d604407ac1a27ed2c9afda715f859f10c3822bfdde88",
      keccak256FromHex "5ccd2bc4c8bb7912717d942522234d99e9133be0007bcd026bfeef13dca45b7f",
      keccak256FromHex "e47504255e10a27a376c1aff5495f57b070834efa07a10c9ab0c1bb6e0615034",
      keccak256FromHex "70da444467b4d36d5c21fe2fb6338dec51771e39a1f688832bf5ef20012ff547",
      keccak256FromHex "42cac6171f599749076235822bad4140838447f262977e8dc6f416a1beea88a5",
      keccak256FromHex "04a0f8d0ef60258380fab8130abb03d4ddd456353987c5b58812034d53519920",
      keccak256FromHex "dba5b36168c67c57d051231b8c7a2813d499743d909c491a486e2c3d8812308a",
      keccak256FromHex "43a8240bad9771985c90898b426c81a852c970714c7dd251758c942894b28110",
      keccak256FromHex "cb7b54fc81d19a1f0a00fb0a16a28fbd57f142e0c9450074cab88074b861b0be",
      keccak256FromHex "22978491368850ac9640461010e31a43f6661fa60ce787ec492cfeb32b01b17e",
      keccak256FromHex "edb69ffaaaec6ac68a9c1a72791f6e49cf633d7389ea360796e5cb4bd629a65a",
      keccak256FromHex "035070645dc8863624cec30573411883bb6a8e3a63c4470fe5d11c413cadfff8",
      keccak256FromHex "7adcd89d0e44cce9574832c688e0b4228e18e48be50ccec76eb69c97f5f67c41",
      keccak256FromHex "aac74a9f04f2fc585cc06950c4a5d304e6f099f39e568d73ad174ee20b5de24f",
      keccak256FromHex "f3ffe93eea8cb97ebcf25cb0b0f4e737348a92c02e4eed1d8bdb1526b080b997",
      keccak256FromHex "0a9f21eccf8eb35b1690c3ab0da01ef16d883f86111d1373deeb98de3fd2b7f0",
      keccak256FromHex "19f5c3f02eece1e5ac12fa83d6666d3ec4b73afbbc1dbba410b4debc5ebf77a0",
      keccak256FromHex "0e8c8612865ce10a7e5f07f4003e0dba081ae1260c1d99bce82ac9d88a29b483",
      keccak256FromHex "866ce8e521aee5a30284702dc38c4e8c160f40c9a17e52f4ba806dd22f0afed7"
    ]

{-# NOINLINE knownExpensiveTxs #-}
knownExpensiveTxs :: S.Set Keccak256
knownExpensiveTxs =
  S.fromList
    [
      keccak256FromHex "4f9e09efa40b1ddc9b9bbfb056161f87714f15bcb0d7fd7db3158528ed766065" -- testnet2 tx requiring ~1,000,000 gas
    ]

newtype CurrentBlockHash = CurrentBlockHash {unCurrentBlockHash :: Keccak256}
  deriving (Generic, NFData, Show)

newtype IsBlockstanbul = IsBlockstanbul {unIsBlockstanbul :: Bool}
  deriving (Generic, NFData, Show, Eq)

newtype GasCap = GasCap {unVmGasCap :: Gas}
  deriving (Generic, NFData, Show, Eq)

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo !Keccak256 !BlockHeader !Int
  deriving (Eq, Show, Generic, NFData)

instance Binary ContextBestBlockInfo

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
    _debugSettings :: !(Maybe DebugSettings),
    _selfAddress :: !Address
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
        _debugSettings = Nothing,
        _selfAddress = Address 0
      }

data QueueEvent
  = TXR TransactionResult
  | SD StateDiff
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
              _debugSettings = Nothing,
              _selfAddress = Address 0
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
  nonce' <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ format account ++ ", nonce=" ++ show nonce'
  let newAddress = getNewAddress_unsafe (account ^. accountAddress) nonce'
  incrementNonce account
  return $ (accountAddress .~ newAddress) account

getNewAddressWithSalt :: (MonadIO m, MonadLogger m, (Account `A.Alters` AddressState) m) => Account -> Value -> Keccak256 -> String -> m Account
getNewAddressWithSalt account salt hsh args = do
  nonce' <- addressStateNonce <$> A.lookupWithDefault Mod.Proxy account
  when flags_debug $ liftIO $ putStrLn $ "Creating new account: owner=" ++ format account ++ ", nonce=" ++ show nonce'
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
