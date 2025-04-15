{-# LANGUAGE ConstraintKinds #-}
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

module Strato.Lite.Core where

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
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB ()
import Blockchain.Data.BlockSummary
import Blockchain.Data.CirrusDefs
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisBlock
import Blockchain.Data.GenesisInfo
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import qualified "vm-runner" Blockchain.Event as VMEvent
import Blockchain.Generation
import Blockchain.GenesisBlock
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
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.IContext (API (..), P2P (..))
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Indexer.P2PIndexer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (ContextBestBlockInfo (..), GasCap (..), IsBlockstanbul (..), baggerState, lookupX509AddrFromCBHash, putContextBestBlockInfo, vmGasCap, withCurrentBlockHash)
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import qualified Control.Lens as Lens
import Control.Monad (join)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Identity
import Control.Monad.Reader
import qualified Control.Monad.State as State
import qualified Control.Monad.Trans.State as StateT
import Core.API
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.TMChan
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Either.Extra (eitherToMaybe)
import Data.Foldable (for_, toList, traverse_)
import Data.List (sortOn)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import Data.Ord (Down(..))
import qualified Data.Set.Ordered as S
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Time.Clock (UTCTime (..), diffUTCTime, getCurrentTime)
import Data.Traversable (for)
import Debugger (DebugSettings, SourceMap(..))
import Executable.EthereumDiscovery
import Executable.EthereumVM2
import Executable.StratoP2P
import SelectAccessible ()
import SolidVM.Model.CodeCollection hiding (Wei)
import Strato.Lite.Base
import Text.Read (readMaybe)
import UnliftIO
import Prelude hiding (round)

type m ~> n = forall a. m a -> n a

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

data CoreContext = CoreContext
  { _genesisBlock :: Block
  , _genesisBlockHash :: GenesisBlockHash
  , _sequencerContext :: SequencerContext
  , _blockPeriod :: BlockPeriod
  , _roundPeriod :: RoundPeriod
  , _vmContextState :: ContextState
  }

makeLenses ''CoreContext

data CorePeer = CorePeer
  { _corePeerName :: Text
  , _corePeerGenesisInfo :: GenesisInfo
  , _corePeerTimerChan :: TMChan RoundNumber
  , _corePeerUnseqSource :: TQueue SeqLoopEvent
  , _corePeerSeqP2pSource :: TMChan P2pEvent
  , _corePeerSeqVmSource :: TQueue [VmEvent]
  , _corePeerApiIndexSource :: TQueue [IndexEvent]
  , _corePeerP2pIndexSource :: TQueue [IndexEvent]
  , _corePeerSlipstreamSource :: TQueue [VMEvent]
  , _corePeerContext :: TVar CoreContext
  }

makeLenses ''CorePeer

type MonadCoreP2P m = ReaderT (IORef P2PContext) m

type CoreT m = ReaderT CorePeer m

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` OutputBlock) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` OutputBlock) (MonadCoreP2P m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState CoreContext (CoreT m) where
  state f =
    asks _corePeerContext >>= \ctx -> liftIO . atomically $ do
      s <- readTVar ctx
      let (a, s') = f s
      writeTVar ctx s'
      pure a

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState P2PContext (MonadCoreP2P m) where
  state f = ask >>= liftIO . flip atomicModifyIORef' (swap . f)
    where
      swap ~(a, b) = (b, a)

instance {-# OVERLAPPING #-} MonadBase m => Mod.Accessible PublicKey (CoreT m) where
  access = lift . Mod.access

instance {-# OVERLAPPING #-} MonadBase m => Mod.Accessible PublicKey (MonadCoreP2P m) where
  access = lift . Mod.access

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` BlockHeader) (CoreT m) where
  lookup _ k   = fmap (fmap obBlockData) . lift $ A.lookup (A.Proxy @OutputBlock) k
  insert _ _ _ = pure ()
  delete _ _   = pure ()

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable WorldBestBlock (CoreT m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable BestBlock (CoreT m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable BestSequencedBlock (CoreT m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable BestSequencedBlock (MonadCoreP2P m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable SyncStatus (CoreT m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible GenesisBlockHash (CoreT m) where
  access _ = use genesisBlockHash

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable ActionTimestamp (MonadCoreP2P m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ActionTimestamp (MonadCoreP2P m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable [BlockHeader] (MonadCoreP2P m) where
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

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [BlockHeader] (MonadCoreP2P m) where
  access _ = Mod.get (Mod.Proxy @[BlockHeader])

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable RemainingBlockHeaders (MonadCoreP2P m) where
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

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RemainingBlockHeaders (MonadCoreP2P m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable PeerAddress (MonadCoreP2P m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible PeerAddress (MonadCoreP2P m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance {-# OVERLAPPING #-} MonadBase m => (Host `A.Alters` PPeer) (CoreT m) where
  lookup p h    = lift $ A.lookup p h
  insert p h pp = lift $ A.insert p h pp
  delete p h    = lift $ A.delete p h

instance {-# OVERLAPPING #-} MonadBase m => (Host `A.Alters` PPeer) (MonadCoreP2P m) where
  lookup p h    = lift $ A.lookup p h
  insert p h pp = lift $ A.insert p h pp
  delete p h    = lift $ A.delete p h

instance {-# OVERLAPPING #-} (Keccak256 `A.Alters` BlockHeader) m => (Keccak256 `A.Alters` BlockHeader) (MonadCoreP2P m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance {-# OVERLAPPING #-} Mod.Modifiable WorldBestBlock m => Mod.Modifiable WorldBestBlock (MonadCoreP2P m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance {-# OVERLAPPING #-} Mod.Modifiable BestBlock m => Mod.Modifiable BestBlock (MonadCoreP2P m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SequencerContext (CoreT m) where
  get _ = use sequencerContext
  put _ = assign sequencerContext

instance {-# OVERLAPPING #-} MonadBase m => (Address `A.Alters` X509CertInfoState) (CoreT m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => A.Selectable Address X509CertInfoState (CoreT m) where
  select = A.lookup

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (CoreT m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SeenTransactionDB (CoreT m) where
  get _ = use $ sequencerContext . seenTransactionDB
  put _ = assign $ sequencerContext . seenTransactionDB

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (IORef RoundNumber) (CoreT m) where
  access _ = use $ sequencerContext . latestRoundNumber

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (TMChan RoundNumber) (CoreT m) where
  access _ = asks _corePeerTimerChan

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible BlockPeriod (CoreT m) where
  access _ = use blockPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RoundPeriod (CoreT m) where
  access _ = use roundPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible View (CoreT m) where
  access _ = currentView

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` ()) (CoreT m) where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance {-# OVERLAPPING #-} MonadIO m => HasBlockstanbulContext (CoreT m) where
  getBlockstanbulContext = use $ sequencerContext . blockstanbulContext
  putBlockstanbulContext = assign (sequencerContext . blockstanbulContext . _Just)

instance {-# OVERLAPPING #-} HasVault m => HasVault (CoreT m) where
  sign bs = lift $ sign bs
  getPub = lift getPub
  getShared pub = lift $ getShared pub

instance {-# OVERLAPPING #-} HasVault m => HasVault (MonadCoreP2P m) where
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

getContextState :: MonadIO m => CoreT m ContextState
getContextState = asks _corePeerContext >>= fmap _vmContextState . readTVarIO

get :: MonadIO m => CoreT m ContextState
get = getContextState
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> CoreT m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> CoreT m ()
put c = asks _corePeerContext >>= \i -> atomically . modifyTVar' i $ vmContextState .~ c
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
modify f = asks _corePeerContext >>= \i -> atomically . modifyTVar' i $ vmContextState %~ f
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
modify' f = asks _corePeerContext >>= \i -> atomically . modifyTVar' i $ vmContextState %~ f
{-# INLINE modify' #-}

contextGet :: MonadIO m => CoreT m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: MonadIO m => (ContextState -> a) -> CoreT m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: MonadIO m => ContextState -> CoreT m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable ContextState (CoreT m) where
  get _ = get
  put _ = put

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable (Maybe DebugSettings) (CoreT m) where
  get _ = gets $ Lens.view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ContextState (CoreT m) where
  access _ = get

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable GasCap (CoreT m) where
  get _ = GasCap <$> gets (Lens.view vmGasCap)
  put _ (GasCap g) = modify $ vmGasCap .~ g

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible MemDBs (CoreT m) where
  access _ = gets $ Lens.view memDBs

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable MemDBs (CoreT m) where
  get _ = gets $ Lens.view memDBs
  put _ md = modify $ memDBs .~ md

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable CurrentBlockHash (CoreT m) where
  get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ Lens.view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance {-# OVERLAPPING #-} MonadIO m => HasMemAddressStateDB (CoreT m) where
  getAddressStateTxDBMap = gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance {-# OVERLAPPING #-} MonadIO m => HasMemAddressStateDB (StateT.StateT s (CoreT m)) where
  getAddressStateTxDBMap = lift . gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = lift . modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = lift . gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = lift . modify $ memDBs . stateBlockMap .~ theMap

instance {-# OVERLAPPING #-} MonadBase m => (Address `A.Alters` AddressState) (CoreT m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance {-# OVERLAPPING #-} MonadBase m => A.Selectable Address AddressState (CoreT m) where
  select _ = getAddressStateMaybe

instance {-# OVERLAPPING #-} MonadBase m => (Maybe Word256 `A.Alters` MP.StateRoot) (CoreT m) where
  lookup _ chainId = do
    bh <- fmap (maybe zeroHash unCurrentBlockHash) . gets $ Lens.view $ memDBs . currentBlock
    mSR <- gets $ Lens.view $ memDBs . stateRoots . at (bh, chainId)
    case mSR of
      Just sr -> pure $ Just sr
      Nothing -> getChainStateRoot chainId bh
  insert _ chainId sr = do
    bh <- fmap (maybe zeroHash unCurrentBlockHash) . gets $ Lens.view $ memDBs . currentBlock
    modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
    putChainStateRoot chainId bh sr
  delete _ chainId = do
    bh <- fmap (maybe zeroHash unCurrentBlockHash) . gets $ Lens.view $ memDBs . currentBlock
    modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
    deleteChainStateRoot chainId bh

instance {-# OVERLAPPING #-} MonadBase m => (Address `A.Selectable` X509.X509Certificate) (CoreT m) where
  select _ k = do
    let certKey addr = (addr,) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (eitherToMaybe . bytesToCert) <$> A.lookup (A.Proxy) (certKey certAddress "certificateString")

instance {-# OVERLAPPING #-} MonadBase m => ((Address, T.Text) `A.Selectable` X509.X509CertificateField) (CoreT m) where
  select _ (k, t) = do
    let certKey addr = (addr,) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

instance {-# OVERLAPPING #-} MonadIO m => HasMemRawStorageDB (CoreT m) where
  getMemRawStorageTxDB = gets $ Lens.view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ Lens.view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance {-# OVERLAPPING #-} MonadBase m => (RawStorageKey `A.Alters` RawStorageValue) (CoreT m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable BlockHashRoot (CoreT m) where
  get p = lift $ Mod.get p
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable GenesisRoot (CoreT m) where
  get p = lift $ Mod.get p
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable BestBlockRoot (CoreT m) where
  get p = lift $ Mod.get p
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadBase m => (MP.StateRoot `A.Alters` MP.NodeData) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` DBCode) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (N.NibbleString `A.Alters` N.NibbleString) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` BlockSummary) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible IsBlockstanbul (CoreT m) where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BaggerState (CoreT m) where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TRC.Cache (CoreT m) where
  access _ = contextGets _txRunResultsCache

instance {-# OVERLAPPING #-} MonadBase m => (CoreT m) `Mod.Yields` DataDefs.TransactionResult where
  yield = lift . Mod.yield

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` API OutputTx) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` API OutputBlock) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` P2P OutputBlock) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => Mod.Modifiable (P2P BestBlock) (CoreT m) where
  get p = lift $ Mod.get p
  put p = lift . Mod.put p

instance {-# OVERLAPPING #-} MonadIO m => (CoreT m) `Mod.Outputs` [IngestEvent] where
  output ies = do
    seqSrc <- asks _corePeerUnseqSource
    atomically . writeTQueue seqSrc $ UnseqEvents ies

transP2pConduits :: Monad m => (m ~> n) -> P2pConduits m -> P2pConduits n
transP2pConduits f (P2pConduits a b c) = P2pConduits (transPipe f a) (transPipe f b) (transPipe f c)

instance {-# OVERLAPPING #-} (Monad m, RunsClient m) => RunsClient (MonadCoreP2P m) where
  runClientConnection i p a f = do
    c <- ask
    lift $ runClientConnection i p (transPipe (flip runReaderT c) a) (flip runReaderT c . f . transP2pConduits lift)

instance {-# OVERLAPPING #-} (Monad m, RunsClient m) => RunsClient (CoreT m) where
  runClientConnection i p a f = do
    c <- ask
    lift $ runClientConnection i p (transPipe (flip runReaderT c) a) (flip runReaderT c . f . transP2pConduits lift)

instance {-# OVERLAPPING #-} (MonadIO m, RunsServer m (LoggingT IO)) => RunsServer (MonadCoreP2P m) (LoggingT IO) where
  runServer p runner f = runner $ \_ -> do
    c <- ask
    liftIO . runLoggingT $ runServer p (\g -> runner $ \s -> lift . g $ transPipe (flip runReaderT c) s) (\a b -> flip runReaderT c $ f (transP2pConduits lift a) b)
    pure ()

instance {-# OVERLAPPING #-} (MonadIO m, RunsServer m (LoggingT IO)) => RunsServer (CoreT m) (LoggingT IO) where
  runServer p runner f = runner $ \_ -> do
    c <- ask
    liftIO . runLoggingT $ runServer p (\g -> runner $ \s -> lift . g $ transPipe (flip runReaderT c) s) (\a b -> flip runReaderT c $ f (transP2pConduits lift a) b)
    pure ()

instance {-# OVERLAPPING #-} MonadBase m => ((Host, TCPPort) `A.Alters` ActivityState) (CoreT m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => ((Host, TCPPort) `A.Alters` ActivityState) (MonadCoreP2P m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadBase m => HasSyncDB (CoreT m) where
  clearAllSyncTasks   = lift . clearAllSyncTasks
  getCurrentSyncTask  = lift . getCurrentSyncTask
  getNewSyncTask    h = lift . getNewSyncTask h
  setSyncTaskFinished = lift . setSyncTaskFinished
  setSyncTaskNotReady = lift . setSyncTaskNotReady

instance {-# OVERLAPPING #-} MonadBase m => HasSyncDB (MonadCoreP2P m) where
  clearAllSyncTasks   = lift . clearAllSyncTasks
  getCurrentSyncTask  = lift . getCurrentSyncTask
  getNewSyncTask    h = lift . getNewSyncTask h
  setSyncTaskFinished = lift . setSyncTaskFinished
  setSyncTaskNotReady = lift . setSyncTaskNotReady

-------------------- END extra stuff for HasPeerDB??

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` (A.Proxy (Inbound WireMessage))) (MonadCoreP2P (CoreT m)) where
  lookup _ _   = pure Nothing
  insert _ _ _ = pure ()
  delete _ _   = pure ()

instance {-# OVERLAPPING #-} MonadIO m => ((Host, Keccak256) `A.Alters` (A.Proxy (Outbound WireMessage))) (MonadCoreP2P (CoreT m)) where
  lookup _ _   = pure Nothing
  insert _ _ _ = pure ()
  delete _ _   = pure ()

instance {-# OVERLAPPING #-} MonadBase m => GetLastBlocks (CoreT m) where
  getLastBlocks n = lift $ getLastBlocks n

instance {-# OVERLAPPING #-} MonadBase m => GetLastTransactions (CoreT m) where
  getLastTransactions a b = lift $ getLastTransactions a b

instance {-# OVERLAPPING #-} MonadBase m => A.Selectable Address Integer (CoreT m) where
  select _ addr = A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> pure Nothing
    Just AddressState{..} -> pure $ Just addressStateNonce

instance {-# OVERLAPPING #-} MonadBase m => A.Selectable Address Contract (CoreT m) where
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

instance {-# OVERLAPPING #-} MonadBase m => A.Selectable Keccak256 SourceMap (CoreT m) where
  select _ ch = A.lookup (A.Proxy @DBCode) ch >>= \case 
    Nothing -> pure Nothing
    Just (_, codeBS) -> case Aeson.decode' $ BL.fromStrict codeBS of
      Just codeMap -> pure . Just . SourceMap $ M.toList codeMap
      Nothing -> case Text.decodeUtf8' codeBS of
        Left _ -> pure Nothing
        Right codeText -> pure . Just $ SourceMap [("", codeText)]

instance {-# OVERLAPPING #-} MonadBase m => Mod.Accessible [DataDefs.RawTransaction] (CoreT m) where
  access _ = do
    bs <- Mod.get (Mod.Proxy @BaggerState)
    time <- liftIO getCurrentTime
    let toRawTx OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx (-1) time
    pure . sortOn (Down . DataDefs.rawTransactionNonce) . map toRawTx . concat $ (M.elems <$> M.elems (queued bs)) ++ (M.elems <$> M.elems (pending bs))

instance {-# OVERLAPPING #-} Mod.Accessible IdentityData (CoreT m) where
  access _ = error "strato-lite: Accessing IdentityData"

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address Certificate (CoreT m) where
  select _ _ = pure Nothing

startingCheckpoint :: [Validator] -> Checkpoint
startingCheckpoint as = def {checkpointValidators = as}

newBlockstanbulContext :: String -> Validator -> [Validator] -> Bool -> BlockstanbulContext
newBlockstanbulContext network' selfValidator as valBehav =
  let ckpt = startingCheckpoint as
   in newContext network' ckpt Nothing valBehav (Just $ validatorToChainMemberParsedSet selfValidator)

emptyBlockstanbulContext :: BlockstanbulContext
emptyBlockstanbulContext = newBlockstanbulContext "" undefined [] True

newSequencerContext :: MonadIO m => BlockstanbulContext -> m SequencerContext
newSequencerContext bc = do
  latestRound <- newIORef 0
  pure $
    SequencerContext
      { _seenTransactionDB = mkSeenTxDB 1024,
        _blockstanbulContext = Just bc,
        _latestRoundNumber = latestRound
      }

-- coreContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
coreContext ::
  SequencerContext ->
  ContextState ->
  CoreContext
coreContext seqCtx vmCtx =
  CoreContext
    { _genesisBlock = error "CORE CONTEXT GENESIS BLOCK"
    , _genesisBlockHash = GenesisBlockHash zeroHash
    , _sequencerContext = seqCtx
    , _blockPeriod = BlockPeriod 1
    , _roundPeriod = RoundPeriod 10
    , _vmContextState = vmCtx
    }

runMonad :: (m ~> BaseM) -> CorePeer -> CoreT m a -> BaseM a
runMonad hoist p = hoist . flip runReaderT p

runNodeWithoutP2P :: MonadBase m => (m ~> BaseM) -> CorePeer -> BaseM ()
runNodeWithoutP2P hoist p = do
  runMonad hoist p corePeerSetup
  concurrently_
    ( concurrently_
        ( concurrently_
            (runMonad hoist p corePeerSequencer)
            (runMonad hoist p corePeerSeqTimerSource)
        )
        (runMonad hoist p corePeerVm)
    )
    ( concurrently_
        ( concurrently_
            (runMonad hoist p corePeerApiIndexer)
            (runMonad hoist p corePeerP2pIndexer)
        )
        (runMonad hoist p corePeerSlipstream)
    )

runNode :: MonadBase m => (m ~> BaseM) -> (m ~> m) -> CorePeer -> BaseM ()
runNode hoist initDiscovery p =
  concurrently_
    (runNodeWithoutP2P hoist p)
    ( concurrently_
        (liftIO . runLoggingT $ stratoP2P (\f -> do
          ctx <- newIORef (def :: P2PContext)
          runResourceT . hoist . flip runReaderT p $ do
            let s = do
                  seqP2pSource <- lift . lift $ asks _corePeerSeqP2pSource
                  chan <- atomically $ dupTMChan seqP2pSource
                  sourceTMChan chan
            runReaderT (f s) ctx
        ))
        (liftIO . runLoggingT . runResourceT $ ethereumDiscovery (\f -> do
          ctx <- newIORef (def :: P2PContext)
          hoist . initDiscovery . flip runReaderT p $ runReaderT (f 100) ctx
        ))
    )

postEvent :: SeqLoopEvent -> CorePeer -> IO ()
postEvent e p = atomically $ writeTQueue (_corePeerUnseqSource p) e

postEvents :: [SeqLoopEvent] -> CorePeer -> IO ()
postEvents es p = atomically $ traverse_ (writeTQueue $ _corePeerUnseqSource p) es

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Map MP.StateRoot MP.NodeData)) where
  lookup _ k = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k = State.modify' $ \(a, b) -> (a, M.delete k b)

type CertMap = Map Address X509CertInfoState

addValidatorsToCertMap :: [(Address, Validator)] -> CertMap -> CertMap
addValidatorsToCertMap vals m =
  let valToXcis a (Validator n) = X509CertInfoState a rootCert True [] "" (Just "") (T.unpack n)
      insertValidatorInfo (a, b) = M.insert a (valToXcis a b)
   in foldr insertValidatorInfo m vals

createCorePeer ::
  String ->
  String ->
  Validator ->
  GenesisInfo ->
  Bool ->
  IO CorePeer
createCorePeer network' name selfValidator genesisInfo valBehav = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  slipstreamSource <- newTQueueIO
  timerChan <- atomically newTMChan
  let validators = readValidatorsFromGenesisInfo genesisInfo
  --     extraCerts = readCertsFromGenesisInfo genesisInfo
  --     certMap = M.fromList $ (userAddress &&& id) . x509CertToCertInfoState <$> extraCerts
  seqCtx <- newSequencerContext $ newBlockstanbulContext network' selfValidator validators valBehav
  cache <- TRC.new 64
  let cstate = def & txRunResultsCache .~ cache
  coreContextTVar <- newTVarIO $ coreContext seqCtx cstate

  pure $
    CorePeer
      (T.pack name)
      genesisInfo
      timerChan
      unseqSource
      seqP2pSource
      seqVmSource
      apiIndexerSource
      p2pIndexerSource
      slipstreamSource
      coreContextTVar

corePeerUnseqSink :: MonadBase m => [IngestEvent] -> CoreT m ()
corePeerUnseqSink ies = do
  unseqSource <- asks _corePeerUnseqSource
  atomically . writeTQueue unseqSource $ UnseqEvents ies

corePeerSeqTimerSource :: MonadBase m => CoreT m ()
corePeerSeqTimerSource = do
  timerChan <- asks _corePeerTimerChan
  unseqSource <- asks _corePeerUnseqSource
  runConduit $ sourceTMChan timerChan
            .| mapC TimerFire
            .| sinkTQueue unseqSource

corePeerSetup :: MonadBase m => CoreT m ()
corePeerSetup = do
  genesisInfo <- asks _corePeerGenesisInfo
  (srcInfo, gb) <- genesisInfoToGenesisBlock genesisInfo
  let genHash = rlpHash $ blockBlockData gb
  genesisBlock .= gb
  genesisBlockHash .= GenesisBlockHash genHash
  A.insert (A.Proxy @OutputBlock) genHash $ OutputBlock Origin.API (blockBlockData gb) [] []
  let bb = BestBlock genHash 0
      bsb = BestSequencedBlock genHash 0 []
  Mod.put (Mod.Proxy @WorldBestBlock) $ WorldBestBlock bb
  Mod.put (Mod.Proxy @BestBlock) bb
  Mod.put (Mod.Proxy @BestSequencedBlock) bsb
  A.replace (A.Proxy @(Canonical BlockHeader)) (0 :: Integer) (Canonical $ blockBlockData gb)
  DBDB.bootstrapGenesisBlock genHash
  let genHeader = blockBlockData gb
      genesisOutputBlock =
        OutputBlock
          { obOrigin = Origin.API,
            obBlockData = genHeader,
            obReceiptTransactions = [],
            obBlockUncles = []
          }
  MP.initializeBlank
  withCurrentBlockHash genHash $ setStateDBStateRoot Nothing $ stateRoot genHeader
  writeBlockSummary genesisOutputBlock
  -- for_ (M.toList mpMap) $ \(k, v) -> A.insert (A.Proxy @MP.NodeData) k v
  -- for_ (genesisInfoCodeInfo genesisInfo) $ \(CodeInfo _ src _) -> addCode SolidVM $ Text.encodeUtf8 src
  (BlockHashRoot bhr) <- bootstrapChainDB genHash [(Nothing, stateRoot genHeader)]
  putContextBestBlockInfo $ ContextBestBlockInfo genHash genHeader 0
  Mod.put (Mod.Proxy @BlockHashRoot) $ BlockHashRoot bhr
  processNewBestBlock genHash genHeader [] -- bootstrap Bagger with genesis block
  let extraCerts = readCertsFromGenesisInfo genesisInfo
  for_ extraCerts $ \c -> do
    let cis = x509CertToCertInfoState c
        ua = userAddress cis
    A.insert (A.Proxy @X509CertInfoState) ua cis
  
  let hashAndMd (_, CodeInfo src name) =
        ( hash $ Text.encodeUtf8 src,
          M.fromList $
            [("src", src)]
              ++ case name of
                Nothing -> []
                Just n -> [("name", n)]
        )
      metadatas = M.fromList $ hashAndMd <$> srcInfo
      findMetadata = flip M.lookup metadatas
  slip <- asks _corePeerSlipstreamSource
  sdsAndVMEs <- withCurrentBlockHash genHash $ populateStorageDBs' findMetadata genesisInfo gb Nothing (stateRoot genHeader)
  for_ sdsAndVMEs $ \(_, vmes) -> do -- TODO: statediff
    atomically $ writeTQueue slip vmes

corePeerSequencer :: MonadBase m => CoreT m ()
corePeerSequencer = do
  unseqSource <- asks _corePeerUnseqSource
  seqVmSource <- asks _corePeerSeqVmSource
  seqP2pSource <- asks _corePeerSeqP2pSource
  atomically $ writeTQueue seqVmSource [VmCreateBlockCommand]
  createFirstTimer
  runConduit $
    sourceTQueue unseqSource
      .| Seq.eventHandler
      .| awaitForever (atomically . either (traverse_ $ writeTMChan seqP2pSource) (writeTQueue seqVmSource))

corePeerVm :: MonadBase m => CoreT m ()
corePeerVm = do
  name <- asks _corePeerName
  seqVmSource <- asks _corePeerSeqVmSource
  unseqSource <- asks _corePeerUnseqSource
  apiIndexerSource <- asks _corePeerApiIndexSource
  p2pIndexerSource <- asks _corePeerP2pIndexSource
  slipstreamSource <- asks _corePeerSlipstreamSource
  runConduit $
    sourceTQueue seqVmSource
      .| (awaitForever $ yield . foldr VMEvent.insertInBatch VMEvent.newInBatch)
      .| handleVmEvents
      .| (awaitForever $ yield . flip VMEvent.insertOutBatch VMEvent.newOutBatch)
      .| ( awaitForever $ \b -> do
             $logInfoS (name <> "/vm") . T.pack $ show $ toList (VMEvent.outEvents b)
             atomically $ do
               writeTQueue unseqSource . UnseqEvents $ IEBlock . blockToIngestBlock Origin.Quarry . outputBlockToBlock <$> toList (VMEvent.outBlocks b)
               writeTQueue unseqSource . UnseqEvents $ IEPreprepareResponse <$> toList (VMEvent.outPreprepareResponses b)
               writeTQueue apiIndexerSource $ toList (VMEvent.outIndexEvents b)
               writeTQueue p2pIndexerSource $ toList (VMEvent.outIndexEvents b)
               writeTQueue slipstreamSource . concat $ toList (VMEvent.outVMEvents b)
         )

corePeerApiIndexer :: MonadBase m => CoreT m ()
corePeerApiIndexer = do
  name <- asks _corePeerName
  apiIndexerSource <- asks _corePeerApiIndexSource
  runConduit $
    sourceTQueue apiIndexerSource
      .| ( awaitForever $ \evs -> do
             $logInfoS (name <> "/testApiIndexer") . T.pack $ show evs
             lift $ indexAPI evs
         )

corePeerP2pIndexer :: MonadBase m => CoreT m ()
corePeerP2pIndexer = do
  name <- asks _corePeerName
  p2pIndexerSource <- asks _corePeerP2pIndexSource
  runConduit $
    sourceTQueue p2pIndexerSource
      .| ( awaitForever $ \evs -> do
             $logInfoS (name <> "/testP2pIndexer") . T.pack $ show evs
             lift $ indexP2P evs
         )

corePeerSlipstream :: MonadBase m => CoreT m ()
corePeerSlipstream = do
  name <- asks _corePeerName
  slipstreamSource <- asks _corePeerSlipstreamSource
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