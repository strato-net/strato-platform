{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Monad where

import BlockApps.Logging
import BlockApps.X509.Certificate as X509
import Blockchain.Bagger
import Blockchain.Bagger.BaggerState
import Blockchain.Blockstanbul
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB (setStateDBStateRoot)
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.AlternateTransaction as U
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB ()
import Blockchain.Data.BlockSummary
import Blockchain.Data.CirrusDefs
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisInfo
import Blockchain.Model.SyncTask
import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.Transaction (getSigVals, txAndTime2RawTX)
import Blockchain.Data.TransactionDef
import qualified Blockchain.Database.MerklePatricia as MP
import qualified "vm-runner" Blockchain.Event as VMEvent
import Blockchain.GenesisBlocks.Contracts.CertRegistry
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.MemVMContext hiding (contextGet, contextGets, contextModify, contextModify', contextPut, dbsGet, dbsGets, dbsModify, dbsModify', dbsPut, get, getMemContext, gets, modify, modify', put)
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Options
import qualified Blockchain.Sequencer as Seq
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Monad
import Blockchain.Slipstream.Processor
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer hiding (createPeer)
import Blockchain.Strato.Discovery.UDP
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.IContext (API (..), IndexerException (..), P2P (..))
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Indexer.P2PIndexer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.Model.Wei
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (ContextBestBlockInfo (..), GasCap (..), IsBlockstanbul (..), baggerState, lookupX509AddrFromCBHash, putContextBestBlockInfo, vmGasCap, withCurrentBlockHash)
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import qualified Control.Lens as Lens
import Control.Monad (forever, join, void, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.Identity
import Control.Monad.Reader
import qualified Control.Monad.State as State
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import qualified Control.Monad.Trans.State as StateT
import Crypto.Types.PubKey.ECC
import qualified Data.Aeson as Aeson
import Data.Bifunctor (first)
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.TMChan
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Either.Extra (eitherToMaybe)
import Data.Foldable (foldl', for_, toList, traverse_)
import Data.List (sortOn)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromJust, fromMaybe, isJust)
import qualified Data.NibbleString as N
import Data.Ord (Down(..))
import qualified Data.Set as Set
import qualified Data.Set.Ordered as S
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Time.Clock (UTCTime (..), addUTCTime, diffUTCTime, getCurrentTime)
import Data.Traversable (for)
import Debugger (DebugSettings, SourceMap(..))
import Executable.EthereumDiscovery
import Executable.EthereumVM2
import Executable.StratoP2P
import Executable.StratoP2PClient 
import Executable.StratoP2PServer (runEthServerConduit)
import Handlers.AccountInfo hiding (API, server)
import Handlers.BlkLast hiding (API, server)
import Handlers.Block hiding (API, server)
import Handlers.Stats hiding (API, server)
import Handlers.Storage hiding (API, server)
import Handlers.Transaction hiding (API, server)
import Handlers.TxLast hiding (API, server)
import Network.Socket
import SelectAccessible ()
import SolidVM.Model.CodeCollection hiding (Wei)
import Text.Read (readMaybe)
import UnliftIO
import Prelude hiding (round)

loggingFunc :: LoggingT m a -> m a
loggingFunc = runNoLoggingT

data VSocket = VSocket
  { _inbound :: TQueue B.ByteString,
    _outbound :: TQueue B.ByteString
  }

makeLenses ''VSocket

newVSocket :: IO VSocket
newVSocket = liftA2 VSocket newTQueueIO newTQueueIO

data Internet = Internet
  { _tcpPorts :: Map (Host, TCPPort) (TQueue (VSocket, Host)),
    _udpPorts :: Map (Host, UDPPort) (TQueue (B.ByteString, SockAddr))
  }

makeLenses ''Internet

preAlGoreInternet :: Internet
preAlGoreInternet = Internet M.empty M.empty

data P2PContext = P2PContext
  { _blockHeaders :: ([BlockHeader], UTCTime),
    _remainingBlockHeaders :: (RemainingBlockHeaders, UTCTime),
    _actionTimestamp :: ActionTimestamp,
    _peerAddr :: PeerAddress,
    _outboundPbftMessages :: S.OSet (Text, Keccak256)
  }

makeLenses ''P2PContext

instance Default P2PContext where
  def =
    P2PContext
      ([], jamshidBirth)
      (RemainingBlockHeaders [], jamshidBirth)
      emptyActionTimestamp
      (PeerAddress Nothing)
      S.empty

data TestContext = TestContext
  { _prvKey :: PrivateKey,
    _p2pWorldBestBlock :: WorldBestBlock,
    _bestBlock :: BestBlock,
    _bestSequencedBlock :: BestSequencedBlock,
    _canonicalBlockHashMap :: Map Integer (Canonical Keccak256),
    _p2pValidators :: Set.Set Validator,
    _blockHashRegistry :: Map Keccak256 OutputBlock,
    _x509certMap :: Map Address X509CertInfoState,
    _genesisBlockHash :: GenesisBlockHash,
    _pbftMessages :: S.OSet Keccak256,
    _sequencerContext :: SequencerContext,
    _dbeRegistry :: Map Keccak256 DBDB.DependentBlockEntry,
    _blockPeriod :: BlockPeriod,
    _roundPeriod :: RoundPeriod,
    _timeoutChan :: TMChan RoundNumber,
    _vmContext :: MemContext,
    _transactionResults :: [DataDefs.TransactionResult],
    _syncStatus :: SyncStatus,
    _syncTasks :: [SyncTask]
  }

makeLenses ''TestContext

type TestContextM = ReaderT P2PPeer (MemPeerDBM (ResourceT (LoggingT IO)))

type MonadTest m = ReaderT P2PPeer m

type MonadP2PTest m = ReaderT (IORef P2PContext) m

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState TestContext (MonadTest m) where
  state f =
    asks _p2pTestContext >>= \ctx -> liftIO . atomically $ do
      s <- readTVar ctx
      let (a, s') = f s
      writeTVar ctx s'
      pure a

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState P2PContext (MonadP2PTest m) where
  state f = ask >>= liftIO . flip atomicModifyIORef' (swap . f)
    where
      swap ~(a, b) = (b, a)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible PublicKey (MonadTest m) where
  access _ = fmap (derivePublicKey . _prvKey) $ asks _p2pTestContext >>= liftIO . atomically . readTVar

instance {-# OVERLAPPING #-} (Monad m, Mod.Accessible PublicKey m) => Mod.Accessible PublicKey (MonadP2PTest m) where
  access = lift . Mod.access

instance Monad m => (Keccak256 `A.Alters` A.Proxy (Inbound WireMessage)) (MonadP2PTest m) where
  lookup _ _ = pure Nothing
  insert _ _ _ = pure ()
  delete _ _ = pure ()

instance Monad m => ((Host, Keccak256) `A.Alters` A.Proxy (Outbound WireMessage)) (MonadP2PTest m) where
  lookup _ _ = pure Nothing
  insert _ _ _ = pure ()
  delete _ _ = pure ()

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [Validator] (MonadTest m) where
  access _ = bestSequencedBlockValidators <$> use bestSequencedBlock

instance {-# OVERLAPPING #-} (Monad m, Mod.Accessible [Validator] m) => Mod.Accessible [Validator] (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance MonadIO m => (Keccak256 `A.Alters` BlockHeader) (MonadTest m) where
  lookup _ k = fmap obBlockData . M.lookup k <$> use blockHashRegistry
  insert _ _ _ = error "insert asdlfkajwef" -- shaBlockDataMap %= M.insert k v
  delete _ _ = error "delete asdlfkajwef" -- shaBlockDataMap %= M.delete k

updateSyncStatus :: MonadIO m => MonadTest m ()
updateSyncStatus = do
  status <- unSyncStatus <$> use syncStatus
  nodeNumber <- bestBlockNumber <$> Mod.get (Mod.Proxy @BestBlock)
  worldNumber <- bestBlockNumber . unWorldBestBlock <$> Mod.get (Mod.Proxy @WorldBestBlock)
  case (status, nodeNumber, worldNumber) of
    (False, ntd, wtd) -> when (ntd >= wtd) (Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus True)
    (True, ntd, wtd) -> Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus (ntd >= wtd)

instance MonadIO m => Mod.Modifiable WorldBestBlock (MonadTest m) where
  get _ = use p2pWorldBestBlock
  put _ wbb = do
    assign p2pWorldBestBlock wbb
    updateSyncStatus

instance MonadIO m => Mod.Modifiable BestBlock (MonadTest m) where
  get _ = use bestBlock
  put _ bb = do
    assign bestBlock bb
    updateSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestSequencedBlock (MonadTest m) where
  get _ = use bestSequencedBlock
  put _ bsb = do
    assign bestSequencedBlock bsb
    updateSyncStatus

instance MonadIO m => Mod.Modifiable SyncStatus (MonadTest m) where
  get _ = use syncStatus
  put _ = assign syncStatus

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Integer (Canonical BlockHeader) (MonadTest m) where
  select _ i = M.lookup i <$> use canonicalBlockHashMap >>= \case
    Nothing -> pure Nothing
    Just (Canonical bh) -> fmap (Canonical . obBlockData) . M.lookup bh <$> use blockHashRegistry

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible GenesisBlockHash (MonadTest m) where
  access _ = use genesisBlockHash

instance MonadIO m => Mod.Modifiable ActionTimestamp (MonadP2PTest m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ActionTimestamp (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [BlockHeader] (MonadP2PTest m) where
  get _ = do
    (bHeaders, lastUpdateTS) <- use blockHeaders
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    if diffTime > fromInteger (fromIntegral flags_connectionTimeout)
      then do
        -- stale cache; override it
        Mod.put (Mod.Proxy @[BlockHeader]) []
        pure []
      else pure bHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    assign blockHeaders (k, now)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [BlockHeader] (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @[BlockHeader])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (MonadP2PTest m) where
  get _ = do
    (remBHeaders, lastUpdateTS) <- use remainingBlockHeaders
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    if diffTime > fromInteger (fromIntegral flags_connectionTimeout)
      then do
        -- stale cache; override it
        let emptyRBH = RemainingBlockHeaders []
        Mod.put (Mod.Proxy @RemainingBlockHeaders) emptyRBH
        pure emptyRBH
      else pure remBHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    assign remainingBlockHeaders (k, now)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RemainingBlockHeaders (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Modifiable PeerAddress (MonadP2PTest m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible PeerAddress (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance (Keccak256 `A.Alters` BlockHeader) m => (Keccak256 `A.Alters` BlockHeader) (MonadP2PTest m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance Mod.Modifiable WorldBestBlock m => Mod.Modifiable WorldBestBlock (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance Mod.Modifiable BestBlock m => Mod.Modifiable BestBlock (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance {-# OVERLAPPING #-} Mod.Modifiable BestSequencedBlock m => Mod.Modifiable BestSequencedBlock (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance Mod.Modifiable SyncStatus m => Mod.Modifiable SyncStatus (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance {-# OVERLAPPING #-} A.Selectable Integer (Canonical BlockHeader) m => A.Selectable Integer (Canonical BlockHeader) (MonadP2PTest m) where
  select p i = lift $ A.select p i

instance {-# OVERLAPPING #-} (Monad m, Mod.Accessible GenesisBlockHash m) => Mod.Accessible GenesisBlockHash (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance {-# OVERLAPPING #-} A.Selectable Address X509CertInfoState m => A.Selectable Address X509CertInfoState (MonadP2PTest m) where
  select p addr = lift $ A.select p addr

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (MonadTest m) where
  lookup _ k = use $ blockHashRegistry . at k
  insert _ k v = blockHashRegistry . at k ?= v
  delete _ k = blockHashRegistry . at k .= Nothing

instance (Keccak256 `A.Alters` OutputBlock) m => (Keccak256 `A.Alters` OutputBlock) (MonadP2PTest m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadIO m => (Address `A.Alters` X509CertInfoState) (MonadTest m) where
  lookup _ k = use $ x509certMap . at k
  insert _ k v = x509certMap . at k ?= v
  delete _ k = x509certMap . at k .= Nothing

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Address X509CertInfoState (MonadTest m) where
  select = A.lookup

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (MonadTest m) where
  lookup _ k = use $ dbeRegistry . at k
  insert _ k v = dbeRegistry . at k ?= v
  delete _ k = dbeRegistry . at k .= Nothing

instance MonadIO m => Mod.Modifiable SeenTransactionDB (MonadTest m) where
  get _ = use $ sequencerContext . seenTransactionDB
  put _ = assign $ sequencerContext . seenTransactionDB

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (IORef RoundNumber) (MonadTest m) where
  access _ = use $ sequencerContext . latestRoundNumber

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (TMChan RoundNumber) (MonadTest m) where
  access _ = use timeoutChan

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible BlockPeriod (MonadTest m) where
  access _ = use blockPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RoundPeriod (MonadTest m) where
  access _ = use roundPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible View (MonadTest m) where
  access _ = currentView

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` ()) (MonadTest m) where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance {-# OVERLAPPING #-} MonadIO m => HasBlockstanbulContext (MonadTest m) where
  getBlockstanbulContext = use $ sequencerContext . blockstanbulContext
  putBlockstanbulContext = assign (sequencerContext . blockstanbulContext . _Just)

instance {-# OVERLAPPING #-} MonadIO m => HasVault (MonadTest m) where
  sign bs = do
    pk <- use prvKey
    return $ signMsg pk bs

  getPub = do
    pk <- use prvKey
    return $ derivePublicKey pk

  getShared pub = do
    pk <- use prvKey
    return $ deriveSharedKey pk pub

instance {-# OVERLAPPING #-} HasVault m => HasVault (MonadP2PTest m) where
  sign bs = lift $ sign bs
  getPub = lift getPub
  getShared pub = lift $ getShared pub

instance {-# OVERLAPPING #-} HasVault IO where
  sign bs = newPrivateKey >>= \pk -> return $ signMsg pk bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

instance {-# OVERLAPPING #-} HasVault (ReaderT PrivateKey IO) where
  sign bs = ask >>= \pk -> return $ signMsg pk bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

getMemContext :: MonadIO m => MonadTest m MemContext
getMemContext = asks _p2pTestContext >>= fmap _vmContext . readTVarIO

get :: MonadIO m => MonadTest m ContextState
get = _state <$> getMemContext
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> MonadTest m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> MonadTest m ()
put c = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . state .~ c
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
modify f = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . state %~ f
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
modify' f = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . state %~ f
{-# INLINE modify' #-}

dbsGet :: MonadIO m => MonadTest m MemContextDBs
dbsGet = _dbs <$> getMemContext
{-# INLINE dbsGet #-}

dbsGets :: MonadIO m => (MemContextDBs -> a) -> MonadTest m a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MonadIO m => MemContextDBs -> (MonadTest m) ()
dbsPut c = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . dbs .~ c
{-# INLINE dbsPut #-}

dbsModify :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadTest m ()
dbsModify f = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . dbs %~ f
{-# INLINE dbsModify #-}

dbsModify' :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadTest m ()
dbsModify' f = asks _p2pTestContext >>= \i -> atomically . modifyTVar' i $ vmContext . dbs %~ f
{-# INLINE dbsModify' #-}

contextGet :: MonadIO m => MonadTest m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: MonadIO m => (ContextState -> a) -> MonadTest m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: MonadIO m => ContextState -> MonadTest m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance MonadIO m => Mod.Modifiable ContextState (MonadTest m) where
  get _ = get
  put _ = put

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemContext (MonadTest m) where
  access _ = getMemContext

instance MonadIO m => Mod.Modifiable (Maybe DebugSettings) (MonadTest m) where
  get _ = gets $ Lens.view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ContextState (MonadTest m) where
  access _ = get

instance MonadIO m => Mod.Modifiable GasCap (MonadTest m) where
  get _ = GasCap <$> gets (Lens.view vmGasCap)
  put _ (GasCap g) = modify $ vmGasCap .~ g

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemDBs (MonadTest m) where
  access _ = gets $ Lens.view memDBs

instance MonadIO m => Mod.Modifiable MemDBs (MonadTest m) where
  get _ = gets $ Lens.view memDBs
  put _ md = modify $ memDBs .~ md

instance MonadIO m => Mod.Modifiable BlockHashRoot (MonadTest m) where
  get _ = dbsGets $ Lens.view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance MonadIO m => Mod.Modifiable GenesisRoot (MonadTest m) where
  get _ = dbsGets $ Lens.view genesisRoot
  put _ gr = dbsModify' $ genesisRoot .~ gr

instance MonadIO m => Mod.Modifiable BestBlockRoot (MonadTest m) where
  get _ = dbsGets $ Lens.view bestBlockRoot
  put _ bbr = dbsModify' $ bestBlockRoot .~ bbr

instance MonadIO m => Mod.Modifiable CurrentBlockHash (MonadTest m) where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ Lens.view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance MonadIO m => HasMemAddressStateDB (MonadTest m) where
  getAddressStateTxDBMap = gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadIO m => HasMemAddressStateDB (StateT.StateT s (MonadTest m)) where
  getAddressStateTxDBMap = lift . gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = lift . modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = lift . gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = lift . modify $ memDBs . stateBlockMap .~ theMap

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MonadTest m) where
  lookup _ sr = dbsGets $ Lens.view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance (MonadIO m, MonadLogger m) => (Address `A.Alters` AddressState) (MonadTest m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Address AddressState (MonadTest m) where
  select _ = getAddressStateMaybe

instance (MonadIO m, MonadLogger m) => (Maybe Word256 `A.Alters` MP.StateRoot) (MonadTest m) where
  lookup _ chainId = do
    mBH <- gets $ Lens.view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> do
      mSR <- gets $ Lens.view $ memDBs . stateRoots . at (bh, chainId)
      case mSR of
        Just sr -> pure $ Just sr
        Nothing -> getChainStateRoot chainId bh
  insert _ chainId sr = do
    mBH <- gets $ Lens.view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
        putChainStateRoot chainId bh sr
  delete _ chainId = do
    mBH <- gets $ Lens.view $ memDBs . currentBlock
    case mBH of
      Nothing -> pure ()
      Just (CurrentBlockHash bh) -> do
        modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
        deleteChainStateRoot chainId bh

instance MonadIO m => (Keccak256 `A.Alters` DBCode) (MonadTest m) where
  lookup _ k = dbsGets $ Lens.view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => (Address `A.Selectable` X509.X509Certificate) (MonadTest m) where
  select _ k = do
    let certKey addr = (addr,) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (eitherToMaybe . bytesToCert) <$> A.lookup (A.Proxy) (certKey certAddress "certificateString")

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => ((Address, T.Text) `A.Selectable` X509.X509CertificateField) (MonadTest m) where
  select _ (k, t) = do
    let certKey addr = (addr,) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

instance MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (MonadTest m) where
  lookup _ n1 = dbsGets $ Lens.view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance MonadIO m => HasMemRawStorageDB (MonadTest m) where
  getMemRawStorageTxDB = gets $ Lens.view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ Lens.view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance (MonadIO m, MonadLogger m) => (RawStorageKey `A.Alters` RawStorageValue) (MonadTest m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance MonadIO m => (Keccak256 `A.Alters` BlockSummary) (MonadTest m) where
  lookup _ k = dbsGets $ Lens.view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestBlock) (MonadTest m) where
  access _ = Just <$> use bestBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MonadTest m) where
  access _ = dbsGets $ Lens.view worldBestBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe SyncStatus) (MonadTest m) where
  access _ = Just <$> use syncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible IsBlockstanbul (MonadTest m) where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance MonadIO m => Mod.Modifiable BaggerState (MonadTest m) where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TRC.Cache (MonadTest m) where
  access _ = contextGets _txRunResultsCache

instance MonadIO m => (MonadTest m) `Mod.Yields` DataDefs.TransactionResult where
  yield txr = transactionResults %= (txr:)

instance MonadIO m => (Keccak256 `A.Alters` API OutputTx) (MonadTest m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (MonadTest m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "OutputBlock"
  insert _ _ (P2P ob@OutputBlock{..}) = do
    let bh = blockHeaderHash obBlockData
    blockHashRegistry . at bh ?= ob
    canonicalBlockHashMap . at (number obBlockData) ?= Canonical bh

instance MonadIO m => Mod.Modifiable (P2P BestBlock) (MonadTest m) where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P bb) = bestBlock .= bb

instance {-# OVERLAPPING #-} MonadIO m => (MonadTest m) `Mod.Outputs` [IngestEvent] where
  output ies = do
    unseqSource <- asks _p2pPeerUnseqSource
    atomically . writeTQueue unseqSource $ UnseqEvents ies

instance (MonadLogger m, MonadReader P2PPeer m, HasMemPeerDB m) => RunsClient (MonadP2PTest m) where
  runClientConnection ipAsText@(Host ip) tcpPort@(TCPPort p) sSource f = do
    inet <- lift $ asks _p2pPeerInternet
    mSock <- M.lookup (ipAsText, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runClientConnection" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> do
        myIP <- accessEnvVar p2pMyIPAddress
        i <- liftIO $ newTQueueIO
        o <- liftIO $ newTQueueIO
        let pSource = sourceTQueue o
            pSink = sinkTQueue i
            v = VSocket i o
        atomically $ writeTQueue s (v, myIP)
        f $ P2pConduits pSource pSink sSource

instance (MonadUnliftIO m, MonadLogger m, MonadReader P2PPeer m, HasMemPeerDB m) => RunsServer (MonadP2PTest m) (LoggingT IO) where
  runServer tcpPort@(TCPPort p) runner f = runner $ \sSource -> do
    inet <- lift $ asks _p2pPeerInternet
    myIP@(Host ip) <- accessEnvVar p2pMyIPAddress
    mSock <- liftIO $ M.lookup (myIP, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runServer" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> forever $ do
        (VSocket i o, otherIP) <- atomically $ readTQueue s
        let pSource = sourceTQueue i
            pSink = sinkTQueue o
        void . async $ f (P2pConduits pSource pSink sSource) otherIP

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible TCPPort (MonadP2PTest m) where
  access _ = pure $ TCPPort 30303

instance {-# OVERLAPPING #-} Monad m => Mod.Accessible UDPPort (MonadP2PTest m) where
  access _ = pure $ UDPPort 30303

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Address Integer (MonadTest m) where
  select _ addr = A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> pure Nothing
    Just AddressState{..} -> pure $ Just addressStateNonce

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Address Contract (MonadTest m) where
  select _ addr = A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> pure Nothing
    Just AddressState{..} -> resolveCodePtr addressStateCodeHash >>= \case 
      Just (SolidVMCode name ch) -> A.lookup (A.Proxy @DBCode) ch >>= \case 
        Nothing -> pure Nothing
        Just (_, codeBS) -> case Aeson.decode' $ BL.fromStrict codeBS of
          Nothing -> case Text.decodeUtf8' codeBS of
            Left _ -> pure Nothing
            Right codeText -> compileSource False (M.singleton "" codeText) >>= \case
              Left _ -> pure Nothing
              Right CodeCollection{..} -> pure $ M.lookup name _contracts
          Just codeMap -> compileSource False codeMap >>= \case
            Left _ -> pure Nothing
            Right CodeCollection{..} -> pure $ M.lookup name _contracts
      _ -> pure Nothing

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Keccak256 SourceMap (MonadTest m) where
  select _ ch = A.lookup (A.Proxy @DBCode) ch >>= \case 
    Nothing -> pure Nothing
    Just (_, codeBS) -> case Aeson.decode' $ BL.fromStrict codeBS of
      Just codeMap -> pure . Just . SourceMap $ M.toList codeMap
      Nothing -> case Text.decodeUtf8' codeBS of
        Left _ -> pure Nothing
        Right codeText -> pure . Just $ SourceMap [("", codeText)]

instance {-# OVERLAPPING #-} MonadIO m => GetLastBlocks (MonadTest m) where
  getLastBlocks n = do
    lastBlockHashes <- map (unCanonical . snd) . take (fromInteger n) . sortOn (Down . fst) . M.toList <$> use canonicalBlockHashMap
    bhr <- use blockHashRegistry
    pure . catMaybes $ fmap outputBlockToBlock . flip M.lookup bhr <$> lastBlockHashes

instance {-# OVERLAPPING #-} MonadIO m => GetLastTransactions (MonadTest m) where
  getLastTransactions _ n = do
    lastBlockHashes <- map (unCanonical . snd) . sortOn (Down . fst) . M.toList <$> use canonicalBlockHashMap
    bhr <- use blockHashRegistry
    time <- liftIO getCurrentTime
    let toRawTx blkNum OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx blkNum time
        getRawTxs OutputBlock{..} = toRawTx (blockHeaderBlockNumber obBlockData) <$> reverse obReceiptTransactions
    pure . take (fromInteger n) . concat . catMaybes $ fmap getRawTxs . flip M.lookup bhr <$> lastBlockHashes

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [DataDefs.RawTransaction] (MonadTest m) where
  access _ = do
    bs <- Mod.get (Mod.Proxy @BaggerState)
    time <- liftIO getCurrentTime
    let toRawTx OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx (-1) time
    pure . sortOn (Down . DataDefs.rawTransactionNonce) . map toRawTx . concat $ (M.elems <$> M.elems (queued bs)) ++ (M.elems <$> M.elems (pending bs))

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable AccountsFilterParams [DataDefs.AddressStateRef] (MonadTest m) where
  select _ AccountsFilterParams{..} = case _qaAddress of
    Nothing -> pure $ Just []
    Just addr -> do
      bh <- bestBlockHash <$> use bestBlock
      withCurrentBlockHash bh $ A.lookup (A.Proxy @AddressState) addr >>= \case
        Nothing -> pure $ Just []
        Just AddressState{..} -> do
          let (mCH, mCN, mCPA) = case addressStateCodeHash of
                ExternallyOwned h -> (Just h, Nothing, Nothing) 
                SolidVMCode n h   -> (Just h, Just n, Nothing)
                CodeAtAccount a n -> (Nothing, Just n, Just a)
          pure . Just . (:[]) $ DataDefs.AddressStateRef
            { DataDefs.addressStateRefAddress = addr
            , DataDefs.addressStateRefNonce = addressStateNonce
            , DataDefs.addressStateRefBalance = addressStateBalance
            , DataDefs.addressStateRefContractRoot = addressStateContractRoot
            , DataDefs.addressStateRefCodeHash = mCH
            , DataDefs.addressStateRefContractName = mCN
            , DataDefs.addressStateRefCodePtrAddress = mCPA
            , DataDefs.addressStateRefLatestBlockDataRefNumber = -1
            }

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable BlocksFilterParams [Block] (MonadTest m) where
  select _ _ = Just <$> getLastBlocks 1000

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable StorageFilterParams [StorageAddress] (MonadTest m) where
  select _ _ = pure $ Just []

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable TxsFilterParams [DataDefs.RawTransaction] (MonadTest m) where
  select _ tfp = case qtHash tfp of
    Nothing -> Just <$> getLastTransactions Nothing 1000
    Just h -> do
      baggerTxs <- Mod.access (Mod.Proxy @[DataDefs.RawTransaction])
      time <- liftIO getCurrentTime
      let toRawTx OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx (-1) time
      blockTxs <- map toRawTx . concatMap obReceiptTransactions . M.elems <$> use blockHashRegistry
      pure . Just . filter (\r -> DataDefs.rawTransactionTxHash r == h) $ baggerTxs ++ blockTxs

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Selectable Keccak256 [DataDefs.TransactionResult] (MonadTest m) where
  select _ h = Just . filter ((==) h . DataDefs.transactionResultTransactionHash) <$> use transactionResults

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TransactionCount (MonadTest m) where
  access _ = TransactionCount . fromIntegral . length . concat . map obReceiptTransactions . M.elems <$> use blockHashRegistry

instance {-# OVERLAPPING #-} Mod.Accessible IdentityData (MonadTest m) where
  access _ = error "strato-lite: Accessing IdentityData"

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address Certificate (MonadTest m) where
  select _ _ = pure Nothing

instance {-# OVERLAPPING #-} ((Host, TCPPort) `A.Alters` ActivityState) m => ((Host, TCPPort) `A.Alters` ActivityState) (MonadTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} ((Host, TCPPort) `A.Alters` ActivityState) m => ((Host, TCPPort) `A.Alters` ActivityState) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

sockAddrToIpAndPort :: SockAddr -> Maybe (Host, UDPPort)
sockAddrToIpAndPort (SockAddrInet port host) = case hostAddressToTuple host of
  (a, b, c, d) ->
    let ipStr =
          concat
            [ show a,
              ".",
              show b,
              ".",
              show c,
              ".",
              show d
            ]
        ip = Host $ T.pack ipStr
        udpPort = UDPPort $ fromIntegral port
     in Just (ip, udpPort)
sockAddrToIpAndPort _ = Nothing

ipAndPortToSockAddr :: Host -> UDPPort -> Maybe SockAddr
ipAndPortToSockAddr (Host ip) (UDPPort port) =
  case traverse readMaybe (T.unpack <$> T.splitOn "." ip) of
    Just [(a :: Int), b, c, d] ->
      let addr =
            (fromIntegral a)
              .|. (fromIntegral b `shiftL` 8)
              .|. (fromIntegral c `shiftL` 16)
              .|. (fromIntegral d `shiftL` 24)
       in Just $ SockAddrInet (fromIntegral port) addr
    _ -> Nothing

instance {-# OVERLAPPING #-} (MonadReader P2PPeer m, HasMemPeerDB m) => A.Selectable (Maybe Host, UDPPort) SockAddr (MonadP2PTest m) where
  select _ (Just ip, udpPort) = pure $ ipAndPortToSockAddr ip udpPort
  select _ (Nothing, udpPort) = do
    myIP <- accessEnvVar p2pMyIPAddress
    pure $ ipAndPortToSockAddr myIP udpPort

instance {-# OVERLAPPING #-}
  ( MonadLogger m,
    MonadReader P2PPeer m,
    HasMemPeerDB m
  ) =>
  A.Replaceable SockAddr B.ByteString (MonadP2PTest m)
  where
  replace _ addr msg = case sockAddrToIpAndPort addr of
    Nothing -> $logErrorS "Replaceable SockAddr BS" $ "Could not decode " <> T.pack (show addr)
    Just (ip@(Host ipText), udpPort@(UDPPort port')) -> do
      inet <- lift $ asks _p2pPeerInternet
      mSock <- liftIO $ M.lookup (ip, udpPort) . _udpPorts <$> readTVarIO inet
      case mSock of
        Nothing -> $logErrorS "runServer" $ "No socket exists for " <> ipText <> ":" <> T.pack (show port')
        Just s -> do
          ip' <- accessEnvVar p2pMyIPAddress
          case ipAndPortToSockAddr ip' (UDPPort 30303) of
            Nothing -> pure ()
            Just myAddr -> atomically $ writeTQueue s (msg, myAddr)

instance {-# OVERLAPPING #-}
  ( MonadUnliftIO m,
    MonadLogger m,
    MonadReader P2PPeer m
  ) =>
  A.Selectable () (B.ByteString, SockAddr) (MonadP2PTest m)
  where
  select _ _ = do
    s <- lift $ asks _p2pMyUDPSocket
    mMsg <- timeout 10000000 . atomically $ readTQueue s
    pure mMsg

instance {-# OVERLAPPING #-}
  ( MonadUnliftIO m,
    MonadLogger m,
    MonadReader P2PPeer m,
    HasMemPeerDB m
  ) =>
  A.Selectable (Host, UDPPort, B.ByteString) Point (MonadP2PTest m)
  where
  select _ (ip@(Host ip'), port@(UDPPort p), bs) = do
    inet <- lift $ asks _p2pPeerInternet
    mSock <- M.lookup (ip, port) . _udpPorts <$> readTVarIO inet
    myIP@(Host myip) <- accessEnvVar p2pMyIPAddress
    case mSock of
      Nothing -> do
        $logWarnS "getPubKey" $ "No socket exists for " <> ip' <> ":" <> T.pack (show p)
        pure Nothing
      Just s -> do
        myS <- lift $ asks _p2pMyUDPSocket
        case ipAndPortToSockAddr myIP (UDPPort 30303) of
          Nothing -> do
            $logWarnS "strato-lite/getPubKey" $ "Could not get SockAddr for our IP address: " <> myip <> ":" <> T.pack (show p)
            pure Nothing
          Just addr -> do
            atomically $ writeTQueue s (bs, addr)
            mResp <- timeout 5000000 . atomically $ readTQueue myS
            pure $ secPubKeyToPoint . processDataStream' . fst <$> mResp

------------------ extra stuff for HasPeerDB??

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ValidatorAddresses (MonadTest m) where
  access _ = do
    validatorSet <- use p2pValidators
    x509s <- M.elems <$> use x509certMap
    let valAdds = map userAddress $ filter ((`Set.member` validatorSet) . Validator . T.pack . commonName) x509s
    return $ ValidatorAddresses valAdds

instance {-# OVERLAPPING #-} (Monad m, Mod.Accessible ValidatorAddresses m) => Mod.Accessible ValidatorAddresses (MonadP2PTest m) where
  access = lift . Mod.access

instance {-# OVERLAPPING #-} MonadIO m => HasSyncDB (MonadTest m) where
  clearAllSyncTasks host = syncTasks %= map (\st@(SyncTask i t h s) -> if h == host then SyncTask i t (Host "") s else st)
  getCurrentSyncTask host = do
    let assignedByHost (SyncTask _ _ h s) = h == host && s == Assigned
    tasks <- filter assignedByHost <$> use syncTasks
    case tasks of
      [t] -> pure $ Just t
      [] -> pure Nothing
      _ -> error $ "multiple sync tasks found in call to getCurrentSyncTask:\n" ++ unlines (show <$> tasks)
  getNewSyncTask "127.0.0.1" _ = pure Nothing
  getNewSyncTask host _ = do -- TODO: Figure out what highestBlockNum (second parameter) is used for
    now <- liftIO getCurrentTime
    let oneMinuteAgo = addUTCTime (-60) now
    unsortedTasks <- use syncTasks
    let sortedTasks = sortOn (\(SyncTask _ t _ _) -> t) unsortedTasks
        foldTasks (Nothing, tasks) st@(SyncTask i t _ s) =
          if t < oneMinuteAgo && s /= Finished
            then let newTask = SyncTask i now host s
                  in (Just newTask, newTask:tasks)
            else (Nothing, st:tasks)
        foldTasks (newTask, tasks) st = (newTask, st:tasks)
        (mNewTask, updatedTasks) = foldl' foldTasks (Nothing, []) sortedTasks
    case mNewTask of
      Nothing -> do
        let newTask = SyncTask (1 + maximum (0:((\(SyncTask i _ _ _) -> i) <$> updatedTasks))) now host Assigned
        syncTasks .= newTask : updatedTasks
        pure $ Just newTask
      Just newTask -> do
        syncTasks .= updatedTasks
        pure $ Just newTask
  setSyncTaskFinished host = syncTasks %= map (\st@(SyncTask i t h _) -> if h == host then SyncTask i t h Finished else st)
  setSyncTaskNotReady host = syncTasks %= map (\st@(SyncTask i t h s) -> if h == host && s == Assigned then SyncTask i t h NotReady else st)

instance {-# OVERLAPPING #-} (MonadIO m, HasSyncDB m) => HasSyncDB (MonadP2PTest m) where
  clearAllSyncTasks   = lift . clearAllSyncTasks
  getCurrentSyncTask  = lift . getCurrentSyncTask
  getNewSyncTask    h = lift . getNewSyncTask h
  setSyncTaskFinished = lift . setSyncTaskFinished
  setSyncTaskNotReady = lift . setSyncTaskNotReady

startingCheckpoint :: [Validator] -> Checkpoint
startingCheckpoint as = def {checkpointValidators = as}

newBlockstanbulContext :: Text -> [Validator] -> Bool -> BlockstanbulContext
newBlockstanbulContext chainm as valBehav =
  let ckpt = startingCheckpoint as
   in newContext "strato-lite" ckpt Nothing valBehav (Just $ CommonName "" "" chainm True)

emptyBlockstanbulContext :: BlockstanbulContext
emptyBlockstanbulContext = newBlockstanbulContext undefined [] True

newSequencerContext :: MonadIO m => BlockstanbulContext -> m SequencerContext
newSequencerContext bc = do
  -- loopCh <- atomically newTMChan
  latestRound <- newIORef 0
  pure $
    SequencerContext
      { _seenTransactionDB = mkSeenTxDB 1024,
        _blockstanbulContext = Just bc,
        _latestRoundNumber = latestRound
      }

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
testContext ::
  PrivateKey ->
  TMChan RoundNumber ->
  SequencerContext ->
  MemContext ->
  TestContext
testContext prv rNum seqCtx vmCtx =
  TestContext
    { _prvKey = prv,
      _p2pWorldBestBlock = WorldBestBlock (BestBlock zeroHash (-1)),
      _bestBlock = BestBlock zeroHash (-1),
      _bestSequencedBlock = BestSequencedBlock zeroHash (-1) [],
      _canonicalBlockHashMap = M.empty,
      _p2pValidators = Set.empty,
      _blockHashRegistry = M.empty,
      _x509certMap = M.empty,
      _genesisBlockHash = GenesisBlockHash zeroHash,
      _pbftMessages = S.empty,
      _sequencerContext = seqCtx,
      _dbeRegistry = M.empty,
      _blockPeriod = BlockPeriod 1,
      _roundPeriod = RoundPeriod 10,
      _timeoutChan = rNum,
      _vmContext = vmCtx,
      _transactionResults = [],
      _syncStatus = SyncStatus False,
      _syncTasks = []
    }

data P2PPeer = P2PPeer
  { _p2pPeerPrivKey :: PrivateKey,
    _p2pPeerPPeer :: PPeer,
    _p2pPeerUnseqSource :: TQueue SeqLoopEvent,
    _p2pPeerSeqP2pSource :: TMChan P2pEvent,
    _p2pPeerSeqVmSource :: TQueue [VmEvent],
    _p2pPeerApiIndexSource :: TQueue [IndexEvent],
    _p2pPeerP2pIndexSource :: TQueue [IndexEvent],
    _p2pPeerSlipstreamSource :: TQueue [VMEvent],
    _p2pPeerUnseqSink :: [IngestEvent] -> TestContextM (),
    _p2pPeerName :: String,
    _p2pTestContext :: TVar TestContext,
    _p2pPeerDB :: MemPeerDBEnv,
    _p2pPeerInternet :: TVar Internet,
    _p2pMyUDPSocket :: TQueue (B.ByteString, SockAddr),
    _p2pPeerSeqTimerSource :: TestContextM (),
    _p2pPeerSequencer :: TestContextM (),
    _p2pPeerVm :: TestContextM (),
    _p2pPeerApiIndexer :: TestContextM (),
    _p2pPeerP2pIndexer :: TestContextM (),
    _p2pPeerSlipstream :: TestContextM ()
  }

makeLenses ''P2PPeer

runMonad :: MonadUnliftIO m =>
            P2PPeer -> ReaderT P2PPeer (ReaderT MemPeerDBEnv (ResourceT (LoggingT m))) a -> m a
runMonad p = loggingFunc . runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p

runNodeWithoutP2P :: P2PPeer -> IO ()
runNodeWithoutP2P p = do
  concurrently_
    ( concurrently_
        ( concurrently_
            (runMonad p (p ^. p2pPeerSequencer))
            (runMonad p (p ^. p2pPeerSeqTimerSource))
        )
        (runMonad p (p ^. p2pPeerVm))
    )
    ( concurrently_
        ( concurrently_
            (runMonad p (p ^. p2pPeerApiIndexer))
            (runMonad p (p ^. p2pPeerP2pIndexer))
        )
        (runMonad p (p ^. p2pPeerSlipstream))
    )

runNode :: P2PPeer -> IO ()
runNode p = do
  let s = do
        seqP2pSource <- lift . lift $ asks _p2pPeerSeqP2pSource
        chan <- atomically $ dupTMChan seqP2pSource
        sourceTMChan chan
  ctx <- newIORef (def :: P2PContext)
  concurrently_
    (runNodeWithoutP2P p)
    ( concurrently_
        (loggingFunc $ stratoP2P (\f -> runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p $ runReaderT (f s) ctx))
        (loggingFunc $ ethereumDiscovery (\f -> runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p $ runReaderT (f 100) ctx))
    )

postEvent :: SeqLoopEvent -> P2PPeer -> IO ()
postEvent e p = atomically $ writeTQueue (_p2pPeerUnseqSource p) e

postEvents :: [SeqLoopEvent] -> P2PPeer -> IO ()
postEvents es p = atomically $ traverse_ (writeTQueue $ _p2pPeerUnseqSource p) es

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Map MP.StateRoot MP.NodeData)) where
  lookup _ k = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k = State.modify' $ \(a, b) -> (a, M.delete k b)

type CertMap = Map Address X509CertInfoState

addValidatorsToCertMap :: [(Address, Text)] -> CertMap -> CertMap
addValidatorsToCertMap vals m =
  let cmpsToXcis a n = X509CertInfoState a rootCert True [] "" Nothing (T.unpack n)
      insertValidatorInfo (a, b) = M.insert a (cmpsToXcis a b)
   in foldr insertValidatorInfo m vals

createPeer' :: PrivateKey -> Text -> [(Address, Text)] -> [X509Certificate] -> T.Text -> T.Text -> IO P2PPeer
createPeer' pk identity as certs n ip = do
  inet <- newTVarIO preAlGoreInternet
  createPeer pk identity as certs inet n (Host ip) (TCPPort 30303) (UDPPort 30303) [] True

createNonvalPeer :: PrivateKey -> Text -> [(Address, Text)] -> [X509Certificate] -> T.Text -> T.Text -> IO P2PPeer
createNonvalPeer pk identity as certs n ip = do
  inet <- newTVarIO preAlGoreInternet
  createPeer pk identity as certs inet n (Host ip) (TCPPort 30303) (UDPPort 30303) [] False

createPeer ::
  PrivateKey ->
  Text ->
  [(Address, Text)] ->
  [X509Certificate] ->
  TVar Internet ->
  Text ->
  Host ->
  TCPPort ->
  UDPPort ->
  [Host] ->
  Bool ->
  IO P2PPeer
createPeer privKey selfId initialValidators' extraCerts inet name ipAsText tcpPort udpPort bootNodes valBehav = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  slipstreamSource <- newTQueueIO
  cht <- atomically newTMChan
  tcpVSock <- newTQueueIO
  udpVSock <- newTQueueIO
  atomically $ do
    modifyTVar inet $ tcpPorts . at (ipAsText, tcpPort) ?~ tcpVSock
    modifyTVar inet $ udpPorts . at (ipAsText, udpPort) ?~ udpVSock
  seqCtx <- newSequencerContext $ newBlockstanbulContext selfId (Validator . snd <$> initialValidators') valBehav
  cache <- TRC.new 64
  let vals' = snd <$> initialValidators'
      vals = Validator <$> vals'
      gi = insertMercataGovernanceContract vals (take 1 vals') $ insertCertRegistryContract extraCerts defaultGenesisInfo
      (stateRoot, mpMap) = flip State.execState (MP.emptyTriePtr, M.empty :: Map MP.StateRoot MP.NodeData) $ do
        MP.initializeBlank
        for_ initialValidators' $ \(addr, _) -> do
          sr <- State.gets fst
          let key = addressAsNibbleString addr
              val =
                rlpEncode . rlpSerialize . rlpEncode $
                  blankAddressState
                    { addressStateBalance = 1000000000000000000000000
                    }
          sr' <- MP.putKeyVal sr key val
          State.modify' $ \(_, b) -> (sr', b)
        for_ (genesisInfoAccountInfo gi) $ \case
          NonContract address balance' -> do
            sr <- State.gets fst
            let key = addressAsNibbleString address
                val = rlpEncode . rlpSerialize . rlpEncode $ blankAddressState {addressStateBalance = balance'}
            sr' <- MP.putKeyVal sr key val
            State.modify' $ \(_, b) -> (sr', b)
          ContractNoStorage address balance' codeHash' -> do
            sr <- State.gets fst
            let key = addressAsNibbleString address
                val =
                  rlpEncode . rlpSerialize . rlpEncode $
                    blankAddressState
                      { addressStateBalance = balance',
                        addressStateCodeHash = codeHash'
                      }
            sr' <- MP.putKeyVal sr key val
            State.modify' $ \(_, b) -> (sr', b)
          ContractWithStorage address balance' codeHash' slots -> do
            let (contractRoot', storageMap) = flip State.execState (MP.emptyTriePtr, M.empty :: Map MP.StateRoot MP.NodeData) $ do
                  MP.initializeBlank
                  for_ slots $ \(key, val) -> do
                    sr <- State.gets fst
                    sr' <- MP.putKeyVal sr (N.EvenNibbleString $ word256ToBytes key) (rlpEncode . rlpSerialize $ rlpEncode val)
                    State.modify' $ \(_, b) -> (sr', b)
            sr <- State.gets fst
            let key = addressAsNibbleString address
                val =
                  rlpEncode . rlpSerialize . rlpEncode $
                    blankAddressState
                      { addressStateBalance = balance',
                        addressStateCodeHash = codeHash',
                        addressStateContractRoot = contractRoot'
                      }
            sr' <- MP.putKeyVal sr key val
            State.modify' $ \(_, b) -> (sr', b <> storageMap)
          SolidVMContractWithStorage address balance' codeHash' slots -> do
            let (contractRoot', storageMap) = flip State.execState (MP.emptyTriePtr, M.empty :: Map MP.StateRoot MP.NodeData) $ do
                  MP.initializeBlank
                  for_ slots $ \(key, val) -> do
                    sr <- State.gets fst
                    sr' <- MP.putKeyVal sr (N.EvenNibbleString key) (rlpEncode val)
                    State.modify' $ \(_, b) -> (sr', b)
            sr <- State.gets fst
            let key = addressAsNibbleString address
                val =
                  rlpEncode . rlpSerialize . rlpEncode $
                    blankAddressState
                      { addressStateBalance = balance',
                        addressStateCodeHash = codeHash',
                        addressStateContractRoot = contractRoot'
                      }
            sr' <- MP.putKeyVal sr key val
            State.modify' $ \(_, b) -> (sr', b <> storageMap)
  let cstate = def & txRunResultsCache .~ cache
      vmCtx = MemContext def cstate
      genesisBlock =
        BlockHeader
          zeroHash
          zeroHash
          emptyChainMember
          stateRoot
          MP.emptyTriePtr
          MP.emptyTriePtr
          ""
          1
          0
          100000000000000000000000000
          1
          jamshidBirth
          ""
          zeroHash
          12345
      genHash = rlpHash genesisBlock
      genesisOutputBlock =
        OutputBlock
          { obOrigin = Origin.API,
            obBlockData = genesisBlock,
            obReceiptTransactions = [],
            obBlockUncles = []
          }
  testContextTVar <- newTVarIO $ testContext privKey cht seqCtx vmCtx
                               & p2pValidators .~ Set.fromList vals
                               & x509certMap %~ addValidatorsToCertMap initialValidators'
  let seqTimerSource = runConduit $ sourceTMChan cht .| mapC TimerFire .| sinkTQueue unseqSource
  let sequencer = do
        DBDB.bootstrapGenesisBlock genHash
        for_ extraCerts $ \c -> do
          let cis = x509CertToCertInfoState c
              ua = userAddress cis
          A.insert (A.Proxy @X509CertInfoState) ua cis
        atomically $ writeTQueue seqVmSource [VmCreateBlockCommand]
        createFirstTimer
        runConduit $
          sourceTQueue unseqSource
            .| Seq.eventHandler
            .| awaitForever (atomically . either (traverse_ $ writeTMChan seqP2pSource) (writeTQueue seqVmSource))
  let vm = do
        MP.initializeBlank
        setStateDBStateRoot Nothing stateRoot
        writeBlockSummary genesisOutputBlock
        for_ (M.toList mpMap) $ \(k, v) -> A.insert (A.Proxy @MP.NodeData) k v
        for_ (genesisInfoCodeInfo gi) $ \(CodeInfo src _) -> addCode SolidVM $ Text.encodeUtf8 src
        (BlockHashRoot bhr) <- bootstrapChainDB genHash [(Nothing, stateRoot)]
        putContextBestBlockInfo $ ContextBestBlockInfo genHash genesisBlock 0
        Mod.put (Mod.Proxy @BlockHashRoot) $ BlockHashRoot bhr
        processNewBestBlock genHash genesisBlock [] -- bootstrap Bagger with genesis block
        runConduit $
          sourceTQueue seqVmSource
            .| (awaitForever $ yield . foldr VMEvent.insertInBatch VMEvent.newInBatch)
            .| handleVmEvents
            .| (awaitForever $ yield . flip VMEvent.insertOutBatch VMEvent.newOutBatch)
            .| ( awaitForever $ \b -> do
                   $logInfoS (name <> "/vm") . T.pack $ show $ toList (VMEvent.outEvents b)
                   atomically $ do
                     writeTQueue unseqSource . UnseqEvents $ concat
                       [ IEBlock . blockToIngestBlock Origin.Quarry . outputBlockToBlock <$> toList (VMEvent.outBlocks b)
                       , IEPreprepareResponse <$> toList (VMEvent.outPreprepareResponses b)
                       ]
                     writeTQueue apiIndexerSource $ toList (VMEvent.outIndexEvents b)
                     writeTQueue p2pIndexerSource $ toList (VMEvent.outIndexEvents b)
                     writeTQueue slipstreamSource . concat $ toList (VMEvent.outVMEvents b)
               )
      apiIndexer' = do
        A.insert (A.Proxy @(API OutputBlock)) genHash $ API genesisOutputBlock
        runConduit $
          sourceTQueue apiIndexerSource
            .| ( awaitForever $ \evs -> do
                   $logInfoS (name <> "/testApiIndexer") . T.pack $ show evs
                   lift $ indexAPI evs
               )
      p2pIndexer' = do
        A.insert (A.Proxy @(P2P OutputBlock)) genHash $ P2P genesisOutputBlock
        runConduit $
          sourceTQueue p2pIndexerSource
            .| ( awaitForever $ \evs -> do
                   $logInfoS (name <> "/testP2pIndexer") . T.pack $ show evs
                   lift $ indexP2P evs
               )
      slipstream = do
        runConduit $
          sourceTQueue slipstreamSource
            .| ( awaitForever $ \evs -> do
                   $logInfoS (name <> "/slipstream") . T.pack $ show evs
                   processTheMessages evs
               )
            .| ( awaitForever $ \case
                 Left txr -> lift $ Mod.yield txr
                 Right cmds  -> traverse_ ($logInfoS (name <> "/slipstream/cmds")) $ concatMap T.lines cmds
               )
      pubkeystr = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False $ derivePublicKey privKey
      ppeer =
        buildPeer
          ( Just pubkeystr,
            ipAsText,
            30303
          )
      unseq ies = do
        atomically . writeTQueue unseqSource $ UnseqEvents ies

  memPeerDBEnv <- createMemPeerDBEnv ipAsText $ map (\ip -> buildPeer (Nothing, ip, 30303)) bootNodes
        
  pure $
    P2PPeer
      privKey
      ppeer
      unseqSource
      seqP2pSource
      seqVmSource
      apiIndexerSource
      p2pIndexerSource
      slipstreamSource
      unseq
      (T.unpack name)
      testContextTVar
      memPeerDBEnv
      inet
      udpVSock
      seqTimerSource
      sequencer
      vm
      apiIndexer'
      p2pIndexer'
      slipstream

data P2PConnection = P2PConnection
  { _serverToClient :: TQueue B.ByteString,
    _clientToServer :: TQueue B.ByteString,
    _serverP2PPeer :: P2PPeer,
    _clientP2PPeer :: P2PPeer,
    _server :: TestContextM (Maybe SomeException),
    _client :: TestContextM (Maybe SomeException),
    _serverException :: TVar (Maybe SomeException),
    _clientException :: TVar (Maybe SomeException)
  }

makeLenses ''P2PConnection

createConnection ::
  P2PPeer ->
  P2PPeer ->
  IO P2PConnection
createConnection server' client' = createConnectionWithModifications server' client' id id

createConnectionWithModifications ::
  P2PPeer ->
  P2PPeer ->
  (P2pEvent -> P2pEvent) ->
  (P2pEvent -> P2pEvent) ->
  IO P2PConnection
createConnectionWithModifications server' client' modifyServerMsgs modifyClientMsgs = do
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource server'
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client'
  serverCtx <- newIORef (def :: P2PContext)
  clientCtx <- newIORef (def :: P2PContext)
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let rServer = runEthServerConduit
                  (_p2pPeerPPeer client')             
                  (sourceTQueue clientToServerTQueue) 
                  (sinkTQueue serverToClientTQueue)   
                  (sourceTMChan serverSeqSource .| (awaitForever $ yield . modifyServerMsgs ))
                  ("Me: " ++ _p2pPeerName server' ++ ", Them: " ++ _p2pPeerName client')
  let rClient = runEthClientConduit         
                  (_p2pPeerPPeer server')   
                  (sourceTQueue serverToClientTQueue)
                  (sinkTQueue clientToServerTQueue)
                  (sourceTMChan clientSeqSource .| (awaitForever $ yield . modifyClientMsgs ))
                  ("Me: " ++ _p2pPeerName client' ++ ", Them: " ++ _p2pPeerName server')
  pure $
    P2PConnection
      serverToClientTQueue
      clientToServerTQueue
      server'
      client'
      (runReaderT rServer serverCtx)
      (runReaderT rClient clientCtx)
      serverExceptionTVar
      clientExceptionTVar

createGermophobicConnection ::
  P2PPeer ->
  P2PPeer ->
  IO P2PConnection
createGermophobicConnection server' client' = do
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client'
  serverCtx <- newIORef (def :: P2PContext)
  clientCtx <- newIORef (def :: P2PContext)
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let rServer = pure Nothing -- server is germophobic; will not conduct handshake
  let rClient = runEthClientConduit         
                  (_p2pPeerPPeer server')   
                  (sourceTQueue serverToClientTQueue)
                  (sinkTQueue clientToServerTQueue)
                  (sourceTMChan clientSeqSource)
                  ("Me: " ++ _p2pPeerName client' ++ ", Them: " ++ _p2pPeerName server')
  pure $
    P2PConnection
      serverToClientTQueue
      clientToServerTQueue
      server'
      client'
      (runReaderT rServer serverCtx)
      (runReaderT rClient clientCtx)
      serverExceptionTVar
      clientExceptionTVar

makeValidators :: [(PrivateKey, a)] -> [(Address, a)]
makeValidators = map (first fromPrivateKey)

mkSignedTx :: PrivateKey -> U.UnsignedTransaction -> Map Text Text -> Transaction
mkSignedTx privKey utx md =
  let Nonce n = U.unsignedTransactionNonce utx
      Gas gl = U.unsignedTransactionGasLimit utx
      cId = unChainId <$> U.unsignedTransactionChainId utx
      Wei gp = U.unsignedTransactionGasPrice utx
      Wei val = U.unsignedTransactionValue utx
      (r', s', v') = getSigVals . signMsg privKey $ U.rlpHash utx
   in if isJust $ U.unsignedTransactionTo utx
        then -- then let Code c = U.unsignedTransactionInitOrData utx

          let c = case U.unsignedTransactionInitOrData utx of
                Code c' -> c'
                _ -> error "mkSignedTx: impossible"
           in MessageTX
                { transactionNonce = fromIntegral n,
                  transactionGasPrice = fromIntegral gp,
                  transactionGasLimit = fromIntegral gl,
                  transactionTo = fromJust $ U.unsignedTransactionTo utx,
                  transactionValue = fromIntegral val,
                  transactionData = c,
                  transactionChainId = cId,
                  transactionR = fromIntegral r',
                  transactionS = fromIntegral s',
                  transactionV = v',
                  transactionMetadata = Just $ M.singleton "VM" "SolidVM" <> md
                }
        else
          ContractCreationTX
            { transactionNonce = fromIntegral n,
              transactionGasPrice = fromIntegral gp,
              transactionGasLimit = fromIntegral gl,
              transactionValue = fromIntegral val,
              transactionInit = U.unsignedTransactionInitOrData utx,
              transactionChainId = cId,
              transactionR = fromIntegral r',
              transactionS = fromIntegral s',
              transactionV = v',
              transactionMetadata = Just $ M.singleton "VM" "SolidVM" <> md
            }

runConnection ::
  P2PConnection ->
  IO ()
runConnection connection = do
  let rServer = do
        mEx <- runMonad (connection ^. serverP2PPeer) $ connection ^. server
        atomically $ writeTVar (connection ^. serverException) mEx
      rClient = do
        mEx <- runMonad (connection ^. clientP2PPeer) $ connection ^. client
        atomically $ writeTVar (connection ^. clientException) mEx
  concurrently_ rServer rClient

data Network = Network
  { _nodes :: Map Text P2PPeer,
    _connections :: Map (Text, Text) P2PConnection,
    _internet :: TVar Internet
  }

makeLenses ''Network

data ThreadPool = ThreadPool
  { _nodeThreads :: Map Text (Async ()),
    _connectionThreads :: Map (Text, Text) (Async ())
  }

makeLenses ''ThreadPool

data NetworkManager = NetworkManager
  { _threads :: TVar ThreadPool,
    _network :: TVar Network,
    _initialCerts :: [X509Certificate],
    _initialValidators :: [(Address, Text)]
  }

makeLenses ''NetworkManager

createNode :: Text -> Text -> Host -> TCPPort -> UDPPort -> [Host] -> TVar Internet -> ReaderT NetworkManager IO P2PPeer
createNode nodeLabel identity ipAddr tcpPort udpPort bootNodes inet = do
  certs <- asks _initialCerts
  vals <- asks _initialValidators
  pKey <- liftIO $ newPrivateKey
  liftIO $ createPeer pKey identity vals certs inet nodeLabel ipAddr tcpPort udpPort bootNodes True

addNode :: Text -> Text -> Host -> TCPPort -> UDPPort -> [Host] -> ReaderT NetworkManager IO Bool
addNode nodeLabel identity ipAddr tcpPort udpPort bootNodes = do
  mgr <- ask
  inet <- _internet <$> readTVarIO (mgr ^. network)
  node <- createNode nodeLabel identity ipAddr tcpPort udpPort bootNodes inet
  didCreate <- liftIO . atomically $ do
    net <- readTVar $ mgr ^. network
    case M.lookup nodeLabel $ net ^. nodes of
      Nothing -> do
        writeTVar (mgr ^. network) $ net & nodes . at nodeLabel ?~ node
        pure True
      _ -> pure False
  when didCreate . liftIO $ do
    a <- async $ runNode node
    atomically $ modifyTVar (mgr ^. threads) $ nodeThreads . at nodeLabel ?~ a
  pure didCreate

removeNode :: Text -> ReaderT NetworkManager IO Bool
removeNode nodeLabel = do
  mgr <- ask
  mAsync <- liftIO . atomically $ do
    modifyTVar (mgr ^. network) $ nodes . at nodeLabel .~ Nothing
    ma <- (^. nodeThreads . at nodeLabel) <$> readTVar (mgr ^. threads)
    modifyTVar (mgr ^. threads) $ nodeThreads . at nodeLabel .~ Nothing
    pure ma
  liftIO $ traverse_ cancel mAsync
  pure $ isJust mAsync

addConnection :: Text -> Text -> ReaderT NetworkManager IO Bool
addConnection serverLabel clientLabel = do
  mgr <- ask
  mPeers <- liftIO . atomically $ do
    net <- readTVar $ mgr ^. network
    case ( M.lookup serverLabel $ net ^. nodes,
           M.lookup clientLabel $ net ^. nodes,
           M.lookup (serverLabel, clientLabel) $ net ^. connections
         ) of
      (Just server', Just client', Nothing) -> pure $ Just (server', client')
      _ -> pure Nothing
  case mPeers of
    Nothing -> pure False
    Just (server', client') ->
      liftIO $ do
        connection <- createConnection server' client'
        a <- async $ runConnection connection
        atomically $ modifyTVar (mgr ^. threads) $ connectionThreads . at (serverLabel, clientLabel) ?~ a
        pure True

removeConnection :: Text -> Text -> ReaderT NetworkManager IO Bool
removeConnection serverLabel clientLabel = do
  mgr <- ask
  mAsync <- liftIO . atomically $ do
    modifyTVar (mgr ^. network) $ connections . at (serverLabel, clientLabel) .~ Nothing
    ma <- (^. connectionThreads . at (serverLabel, clientLabel)) <$> readTVar (mgr ^. threads)
    modifyTVar (mgr ^. threads) $ connectionThreads . at (serverLabel, clientLabel) .~ Nothing
    pure ma
  liftIO $ traverse_ cancel mAsync
  pure $ isJust mAsync

selfSignCert :: PrivateKey -> Text -> IO X509Certificate
selfSignCert pk c = flip runReaderT pk $ do
  let iss = Issuer (T.unpack c) "" Nothing Nothing
      sub = Subject (T.unpack c) "" Nothing Nothing (derivePublicKey pk)
  makeSignedCert Nothing Nothing iss sub

runNetwork :: [(Text, (Text, Host, TCPPort, UDPPort))] -> (forall a. [a] -> [a]) -> IO NetworkManager
runNetwork nodesList validatorsFilter = do
  privKeys <- traverse (const newPrivateKey) nodesList
  let identities = (\(_, (c, _, _, _)) -> c) <$> nodesList
      privAndIds = zip privKeys identities
      validatorsPrivKeys = validatorsFilter privAndIds
      validators' = makeValidators validatorsPrivKeys
  certs <- traverse (uncurry selfSignCert) privAndIds
  inet <- newTVarIO preAlGoreInternet
  let bootNodes = (\(_, (_, i, _, _)) -> i) <$> nodesList
  peers <- traverse (\(p, (n, (c, i, t, u))) -> createPeer p c validators' certs inet n i t u bootNodes True) $ zip privKeys nodesList
  let nodesMap = M.fromList $ zip (fst <$> nodesList) peers
      network' = Network nodesMap M.empty inet
  nodeThreads' <- for nodesMap $ async . runNode
  let threadPool = ThreadPool nodeThreads' M.empty
  networkTVar <- newTVarIO network'
  threadsTVar <- newTVarIO threadPool
  pure $ NetworkManager threadsTVar networkTVar certs validators'

runNetworkWithStaticConnections :: [(Text, Host, Text)] -> [(Text, Text)] -> (forall a. [a] -> [a]) -> IO (Either Text NetworkManager)
runNetworkWithStaticConnections nodesList connectionsList validatorsFilter = do
  privKeys <- traverse (const newPrivateKey) nodesList
  let identities = (\(_, _, c) -> c) <$> nodesList
      privAndIds = zip privKeys identities
      validatorsPrivKeys = validatorsFilter privAndIds
      validators' = makeValidators validatorsPrivKeys
  certs <- traverse (uncurry selfSignCert) privAndIds
  inet <- newTVarIO preAlGoreInternet
  peers <- traverse (\(p, (n, i, c)) -> createPeer p c validators' certs inet n i (TCPPort 30303) (UDPPort 30303) [] True) $ zip privKeys nodesList
  let nodesMap = M.fromList $ zip ((\(a, _, _) -> a) <$> nodesList) peers
  eConnections <- runExceptT . for connectionsList $ \(server', client') -> do
    serverPeer <- maybeToExceptT ("Couldn't find server " <> server') . MaybeT . pure $ M.lookup server' nodesMap
    clientPeer <- maybeToExceptT ("Couldn't find client " <> client') . MaybeT . pure $ M.lookup client' nodesMap
    liftIO $ createConnection serverPeer clientPeer
  for eConnections $ \connections' -> do
    let connectionsMap = M.fromList $ zip connectionsList connections'
        network' = Network nodesMap connectionsMap inet
    nodeThreads' <- for nodesMap $ async . runNodeWithoutP2P
    connectionThreads' <- for connectionsMap $ async . runConnection
    let threadPool = ThreadPool nodeThreads' connectionThreads'
    networkTVar <- newTVarIO network'
    threadsTVar <- newTVarIO threadPool
    pure $ NetworkManager threadsTVar networkTVar certs validators'

runNetworkOld :: [P2PPeer] -> [P2PConnection] -> IO ()
runNetworkOld nodes' connections' =
  concurrently_
    (mapConcurrently runNode nodes')
    (mapConcurrently runConnection connections')
