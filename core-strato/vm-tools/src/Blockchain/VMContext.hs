{-# LANGUAGE ConstraintKinds       #-}
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


module Blockchain.VMContext
    ( VMBase
    , ContextDBs(..)
    , MemDBs(..)
    , ContextState(..)
    , Context(..)
    , ContextBestBlockInfo(..)
    , ContextM
    , stateDB
    , hashDB
    , codeDB
    , blockSummaryDB
    , kafkaState
    , redisPool
    , sqldb
    , stateTxMap
    , stateBlockMap
    , storageTxMap
    , storageBlockMap
    , stateRoot
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
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
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
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockSummary
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
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import qualified Blockchain.TxRunResultCache        as TRC
import           Blockchain.VMOptions

import           Executable.EVMFlags

import           UnliftIO

instance NFData RBDB.RedisConnection where
  rnf (RBDB.RedisConnection c) = c `seq` ()

data ContextBestBlockInfo = Unspecified | ContextBestBlockInfo (SHA, BlockData, Integer, Int, Int)
    deriving (Eq, Read, Show, Generic, NFData)

data ContextDBs = ContextDBs
  { _stateDB        :: MP.StateDB
  , _hashDB         :: HashDB
  , _codeDB         :: CodeDB
  , _blockSummaryDB :: BlockSummaryDB
  , _kafkaState     :: IORef K.KafkaState
  , _redisPool      :: RBDB.RedisConnection
  , _sqldb          :: SQLDB
  } deriving (Generic, NFData)
makeLenses ''ContextDBs

data MemDBs = MemDBs
  { _stateTxMap      :: M.Map Address AddressStateModification
  , _stateBlockMap   :: M.Map Address AddressStateModification
  , _storageTxMap    :: M.Map (Address, B.ByteString) B.ByteString
  , _storageBlockMap :: M.Map (Address, B.ByteString) B.ByteString
  , _stateRoot       :: MP.StateRoot
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
  } deriving (Generic, NFData)
makeLenses ''ContextState

data Context = Context
  { _dbs   :: ContextDBs
  , _state :: IORef ContextState
  } deriving (Generic, NFData)
makeLenses ''Context

type ContextM = ReaderT Context (ResourceT (LoggingT IO))

type VMBase m = ( MonadIO m
                , MonadUnliftIO m
                , MonadLogger m
                , Mod.Modifiable ContextState m
                , Mod.Accessible ContextState m
                , Mod.Modifiable MemDBs m
                , Mod.Accessible MemDBs m
                , Mod.Modifiable MP.StateRoot m
                , Mod.Modifiable BlockHashRoot m
                , Mod.Modifiable GenesisRoot m
                , Mod.Modifiable BestBlockRoot m
                , HasMemAddressStateDB m
                , (MP.StateRoot `A.Alters` MP.NodeData) m
                , (Address `A.Alters` AddressState) m
                , (SHA `A.Alters` DBCode) m
                , (N.NibbleString `A.Alters` N.NibbleString) m
                , HasMemRawStorageDB m
                , (RawStorageKey `A.Alters` RawStorageValue) m
                , (SHA `A.Alters` BlockSummary) m
                , Mod.Accessible (Maybe WorldBestBlock) m
                )

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

instance Mod.Modifiable ContextState ContextM where
  get _ = get
  put _ = put

instance Mod.Accessible Context ContextM where
  access _ = ask

instance Mod.Accessible ContextState ContextM where
  access _ = get

instance Mod.Modifiable MP.StateRoot ContextM where
  get _    = gets . view $ memDBs . stateRoot
  put _ sr = modify $ memDBs . stateRoot .~ sr

instance Mod.Accessible MemDBs ContextM where
  access _ = gets $ view memDBs

instance Mod.Modifiable MemDBs ContextM where
  get _    = gets $ view memDBs
  put _ md = modify $ memDBs .~ md

vmBlockHashRootKey :: B.ByteString
vmBlockHashRootKey = "block_hash_root"

vmGenesisRootKey :: B.ByteString
vmGenesisRootKey = "genesis_root"

vmBestBlockRootKey :: B.ByteString
vmBestBlockRootKey = "best_block_root"

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

instance Mod.Modifiable K.KafkaState ContextM where
  get _    = readIORef =<< view (dbs . kafkaState)
  put _ ks = view (dbs . kafkaState) >>= flip writeIORef ks

instance HasMemAddressStateDB ContextM where
  getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance (MP.StateRoot `A.Alters` MP.NodeData) ContextM where
  lookup _ = MP.genericLookupDB $ getStateDB
  insert _ = MP.genericInsertDB $ getStateDB
  delete _ = MP.genericDeleteDB $ getStateDB

instance (Address `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (SHA `A.Alters` DBCode) ContextM where
  lookup _ = genericLookupCodeDB $ getCodeDB
  insert _ = genericInsertCodeDB $ getCodeDB
  delete _ = genericDeleteCodeDB $ getCodeDB

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

instance (SHA `A.Alters` BlockSummary) ContextM where
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
            , _stateRoot       = error "must set stateroot for test context"
            }

      cstate <- newIORef $ ContextState
            { _memDBs            = cmemDBs
            , _baggerState       = defaultBaggerState
            , _bestBlockInfo     = Unspecified
            , _hasBlockstanbul   = False
            , _blockRequested    = False
            , _coinbaseQueue     = Q.empty
            , _txRunResultsCache = cache
            }

      let ctx = Context
            { _dbs   = cdbs
            , _state = cstate
            }
      a <- flip runReaderT ctx $ do
        MP.initializeBlank
        setStateDBStateRoot MP.emptyTriePtr
        f
      cstate' <- readIORef cstate
      return (a, cstate')

runContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m) =>
                ReaderT Context (ResourceT m) a -> m (a, ContextState)
runContextM f = do
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
      blksumdb <- DB.open (dbDir "h" ++ blockSummaryCacheDBPath) ldbOptions
      rPool <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
      kafkaStateRef <- newIORef $ mkConfiguredKafkaState "ethereum-vm"
      cache <- liftIO $ TRC.new 64

      let cdbs = ContextDBs
            { _stateDB        = MP.StateDB sdb
            , _hashDB         = HashDB hdb
            , _codeDB         = CodeDB cdb
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
            , _stateRoot       = MP.emptyTriePtr
            }

      cstate <- newIORef $ ContextState
            { _memDBs            = cmemDBs
            , _baggerState       = defaultBaggerState
            , _bestBlockInfo     = Unspecified
            , _hasBlockstanbul   = flags_blockstanbul
            , _blockRequested    = False
            , _coinbaseQueue     = Q.empty
            , _txRunResultsCache = cache
            }

      let ctx = Context
            { _dbs   = cdbs
            , _state = cstate
            }
      a <- runReaderT f ctx
      cstate' <- readIORef cstate
      return (a, cstate')


evalContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m) => ReaderT Context (ResourceT m) a -> m a
evalContextM f = fst <$> runContextM f

execContextM :: (MonadIO m, MonadUnliftIO m, MonadLogger m) => ReaderT Context (ResourceT m) a -> m ContextState
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
  storageMap <- getMemRawStorageTxDB
  putMemRawStorageTxMap $ M.filterWithKey (const . (/= address) . fst) storageMap

getContextBestBlockInfo :: (Functor m, Mod.Accessible ContextState m) => m ContextBestBlockInfo
getContextBestBlockInfo = _bestBlockInfo <$> Mod.access Mod.Proxy

putContextBestBlockInfo :: Mod.Modifiable ContextState m => ContextBestBlockInfo -> m ()
putContextBestBlockInfo new = Mod.modifyStatefully_ Mod.Proxy $ assign bestBlockInfo new

queuePendingVote :: ( MonadLogger m
                    , Mod.Modifiable ContextState m
                    )
                 => Address -> Bool -> Address -> m ()
queuePendingVote a r s = do
  let nonce = case r of
        True -> maxBound
        False -> 0
      newVote = ((a, nonce), s)
  $logInfoLS "queuePendingVote" newVote
  Mod.modifyStatefully_ (Mod.Proxy @ContextState) $ coinbaseQueue %= (newVote Q.<|)

-- (Coinbase, Nonce) to be applied on a constructed block
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
