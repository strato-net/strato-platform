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
import Blockchain.Bagger
import Blockchain.Bagger.BaggerState
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.StateMachine (validators)
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB (setStateDBStateRoot)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader as BH
import Blockchain.Data.BlockDB ()
import Blockchain.Data.BlockSummary
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisBlock
import Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.TXOrigin as Origin
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
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.Processor
import Blockchain.Strato.Discovery.Data.MemPeerDB ()
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.IContext (API (..), P2P (..))
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Indexer.P2PIndexer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (ContextBestBlockInfo (..), GasCap (..), baggerState, putContextBestBlockInfo, vmGasCap, withCurrentBlockHash)
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import qualified Control.Lens as Lens
import Control.Monad (forever, join, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import qualified Control.Monad.State as State
import qualified Control.Monad.Trans.State as StateT
-- import Core.API
import Data.Conduit.TMChan
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Foldable (toList, traverse_)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Set as Set
import qualified Data.Set.Ordered as S
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock (UTCTime (..), diffUTCTime, getCurrentTime)
import Debugger (DebugSettings)
import Executable.EthereumDiscovery
import Executable.EthereumVM2
import Executable.StratoP2P
import GHC.Conc (ThreadId, myThreadId)
import Strato.Lite.Base
import Text.Format
import UnliftIO
import Prelude hiding (round, sequence)

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
  { _genesisBlock :: TVar Block
  , _genesisBlockHash :: TVar GenesisBlockHash
  , _sequencerContext :: TVar SequencerContext
  , _vmContextState :: TVar ContextState
  }

makeLenses ''CoreContext

data CorePeer = CorePeer
  { _corePeerName :: Text
  , _corePeerGenesisInfo :: GenesisInfo
  , _corePeerBlockPeriod :: BlockPeriod
  , _corePeerRoundPeriod :: RoundPeriod
  , _corePeerTimerChan :: TMChan RoundNumber
  , _corePeerUnseqSource :: TQueue SeqLoopEvent
  , _corePeerSeqP2pSource :: TMChan P2pEvent
  , _corePeerSeqVmSource :: TQueue [VmEvent]
  , _corePeerApiIndexSource :: TQueue [IndexEvent]
  , _corePeerP2pIndexSource :: TQueue [IndexEvent]
  , _corePeerSlipstreamSource :: TQueue [VMEvent]
  , _corePeerNodeDataReqs :: TVar (Map MP.StateRoot (TMChan MP.NodeData))
  , _corePeerContext :: CoreContext
  , _corePeerLoggingFunc :: Text -> LoggingT IO () -> IO ()
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

-- instance {-# OVERLAPPING #-} MonadIO m => State.MonadState CoreContext (CoreT m) where
--   state f =
--     asks _corePeerContext >>= \ctx -> liftIO . atomically $ do
--       s <- readTVar ctx
--       let (a, s') = f s
--       writeTVar ctx s'
--       pure a

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState P2PContext (MonadCoreP2P m) where
  state f = ask >>= liftIO . flip atomicModifyIORef' (swap . f)
    where
      swap (a, b) = (b, a)

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
  access _ = asks (_genesisBlockHash . _corePeerContext) >>= readTVarIO

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
  get _   = asks (_sequencerContext . _corePeerContext) >>= readTVarIO
  put _ s = asks (_sequencerContext . _corePeerContext) >>= atomically . flip writeTVar s

instance {-# OVERLAPPING #-} MonadBase m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (CoreT m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SeenTransactionDB (CoreT m) where
  get _   = asks (_sequencerContext . _corePeerContext) >>= fmap _seenTransactionDB . readTVarIO
  put _ s = asks (_sequencerContext . _corePeerContext) >>= atomically . flip modifyTVar' (seenTransactionDB .~ s)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (IORef (View, Maybe Block)) (CoreT m) where
  access _   = asks (_sequencerContext . _corePeerContext) >>= fmap _latestViewAndProposal . readTVarIO

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (TMChan RoundNumber) (CoreT m) where
  access _ = asks _corePeerTimerChan

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible BlockPeriod (CoreT m) where
  access _ = asks _corePeerBlockPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible RoundPeriod (CoreT m) where
  access _ = asks _corePeerRoundPeriod

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible View (CoreT m) where
  access _ = currentView

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` ()) (CoreT m) where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance {-# OVERLAPPING #-} MonadIO m => HasBlockstanbulContext (CoreT m) where
  getBlockstanbulContext = do
    i <- asks $ _sequencerContext . _corePeerContext
    liftIO $ _blockstanbulContext <$> readTVarIO i
  putBlockstanbulContext s = do
    i <- asks $ _sequencerContext . _corePeerContext
    liftIO $ atomically $ modifyTVar' i (blockstanbulContext .~ s)

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
getContextState = asks (_vmContextState . _corePeerContext) >>= readTVarIO

get :: MonadIO m => CoreT m ContextState
get = getContextState
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> CoreT m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> CoreT m ()
put c = asks (_vmContextState . _corePeerContext) >>= atomically . flip writeTVar c
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
modify f = asks (_vmContextState . _corePeerContext) >>= atomically . flip modifyTVar' f
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> CoreT m ()
modify' f = asks (_vmContextState . _corePeerContext) >>= atomically . flip modifyTVar' f
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
  lookupWithDefault p k = lift $ A.lookupWithDefault p k
  lookup p k = lift (A.lookup p k) >>= \case
    Just v -> pure $ Just v
    Nothing -> do
      $logWarnS "A.lookup NodeData" . T.pack $ "Couldn't find " ++ format k ++ " locally. Fetching from network"
      ndReqsVar <- asks _corePeerNodeDataReqs
      ndReqs <- atomically $ readTVar ndReqsVar
      case M.lookup k ndReqs of
        Just chan -> do
          $logWarnS "A.lookup NodeData" . T.pack $ "Channel already exists for " ++ format k ++ ". Duplicating and waiting for response"
          mValue <- atomically (dupTMChan chan) >>= atomically . readTMChan
          $logWarnS "A.lookup NodeData" . T.pack $ "Got value for " ++ format k ++ ": " ++ maybe "Nothing" format mValue
          pure mValue
        Nothing -> do
          $logWarnS "A.lookup NodeData" . T.pack $ "No channel found for " ++ format k ++ ". Creating a new one"
          seqP2pSrc <- asks _corePeerSeqP2pSource
          chan <- atomically $ do
            bChan <- newBroadcastTMChan
            modifyTVar ndReqsVar $ M.insert k bChan
            writeTMChan seqP2pSrc $ P2pGetMPNodes [k]
            dupTMChan bChan
          $logWarnS "A.lookup NodeData" . T.pack $ "Created a channel for " ++ format k ++ " and dispatched a GetMPNodes request"
          mmResp <- timeout 2000000 . atomically $ readTMChan chan
          atomically $ closeTMChan chan
          $logWarnS "A.lookup NodeData" . T.pack $ "Got value for " ++ format k ++ ": " ++ maybe "Nothing" format mmResp
          pure $ join mmResp
  insert p k v = do
    ndReqsVar <- asks _corePeerNodeDataReqs
    wrote <- atomically $ do
      ndReqs <- readTVar ndReqsVar
      case M.lookup k ndReqs of
        Just chan -> do
          writeTMChan chan v
          modifyTVar ndReqsVar $ M.delete k
          pure True
        Nothing -> pure False
    when wrote $ do
      $logWarnS "A.insert NodeData" . T.pack $ "Found channel for " ++ format k ++ ". Writing value " ++ format v ++ " to channel"
    lift $ A.insert p k v
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

instance {-# OVERLAPPING #-} (MonadIO m, RunsServer m) => RunsServer (MonadCoreP2P m) where
  runServer p runner f = runner $ \_ -> do
    c <- ask
    liftIO $ runServer p (\g -> runner $ \s -> lift . g $ transPipe (flip runReaderT c) s) (\a b -> flip runReaderT c $ f (transP2pConduits lift a) b)

instance {-# OVERLAPPING #-} (MonadIO m, RunsServer m) => RunsServer (CoreT m) where
  runServer p runner f = runner $ \_ -> do
    c <- ask
    liftIO $ runServer p (\g -> runner $ \s -> lift . g $ transPipe (flip runReaderT c) s) (\a b -> flip runReaderT c $ f (transP2pConduits lift a) b)

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

startingCheckpoint :: [Validator] -> Checkpoint
startingCheckpoint as = def {checkpointValidators = as}

newBlockstanbulContext :: String -> [Validator] -> Bool -> BlockstanbulContext
newBlockstanbulContext network' as valBehav =
  let ckpt = startingCheckpoint as
   in newContext network' ckpt Nothing valBehav

newSequencerContext :: MonadIO m => BlockstanbulContext -> m SequencerContext
newSequencerContext bc = do
  latestVAndP <- newIORef (View 0 0, Nothing)
  pure $
    SequencerContext
      { _seenTransactionDB = mkSeenTxDB 1024,
        _blockstanbulContext = bc,
        _latestViewAndProposal = latestVAndP
      }

-- coreContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
coreContextIO ::
  SequencerContext ->
  ContextState ->
  IO CoreContext
coreContextIO seqCtx vmCtx = do
  gb <- newTVarIO (error "CORE CONTEXT GENESIS BLOCK")
  gh <- newTVarIO (GenesisBlockHash zeroHash)
  sc <- newTVarIO seqCtx
  vc <- newTVarIO vmCtx
  pure $ CoreContext
    { _genesisBlock = gb
    , _genesisBlockHash = gh
    , _sequencerContext = sc
    , _vmContextState = vc
    }

runMonad :: (m ~> BaseM) -> CorePeer -> CoreT m a -> BaseM a
runMonad hoist p = hoist . flip runReaderT p

runNodeWithoutP2P :: MonadBase m => (m ~> BaseM) -> CorePeer -> IO [Async ()]
runNodeWithoutP2P hoist p = do
  tid <- myThreadId
  traverse (uncurry asyncOn) . zip [0..] $ nonP2pThreads hoist p tid

runBase :: Text -> CorePeer -> BaseM () -> IO ()
runBase name p f = do
  let logF = (p ^. corePeerLoggingFunc) name
  logF $ runResourceT f

runMonitored :: Text -> ThreadId -> CorePeer -> BaseM () -> IO ()
runMonitored name tid p f = do
  let logF = (p ^. corePeerLoggingFunc) name
  catch (runBase name p f) $ \(e :: SomeException) -> logF $ do
    $logErrorS (name <> " ERROR") . T.pack $ show e
    throwTo tid e

nonP2pThreads :: MonadBase m => (m ~> BaseM) -> CorePeer -> ThreadId -> [IO ()]
nonP2pThreads hoist p tid =
  [ runMonitored "strato-sequencer"   tid p $ runMonad hoist p corePeerSequencer
  , runMonitored "seq-timer"          tid p $ runMonad hoist p corePeerSeqTimerSource
  , runMonitored "vm-runner"          tid p $ runMonad hoist p corePeerVm
  , runMonitored "strato-api-indexer" tid p $ runMonad hoist p corePeerApiIndexer
  , runMonitored "strato-p2p-indexer" tid p $ runMonad hoist p corePeerP2pIndexer
  , runMonitored "slipstream"         tid p $ runMonad hoist p corePeerSlipstream
  ]

runNode :: MonadBase m => (m ~> BaseM) -> (m ~> m) -> CorePeer -> IO [Async ()]
runNode hoist initDiscovery p = do
  tid <- myThreadId
  runMonitored "strato-setup" tid p $ runMonad hoist p corePeerSetup
  flip catch wtf . traverse (uncurry asyncOn) . zip [0..] $ runP2P tid : runEthDisc tid : nonP2pThreads hoist p tid
  where wtf (e :: SomeException) = runLoggingT $ do
          $logErrorS "guh!" . T.pack $ show e
          pure []
        runP2P tid = runMonitored "strato-p2p" tid p . liftIO $
          stratoP2P (\f -> runBase "strato-p2p" p $ do
            ctx <- newIORef (def :: P2PContext)
            hoist . flip runReaderT p $ do
              let s = do
                    seqP2pSource <- lift . lift $ asks _corePeerSeqP2pSource
                    chan <- atomically $ dupTMChan seqP2pSource
                    sourceTMChan chan
              runReaderT (f s) ctx
          )
        runEthDisc tid = runMonitored "ethereum-discover" tid p $
          ethereumDiscovery (\f -> do
            ctx <- newIORef (def :: P2PContext)
            hoist . initDiscovery . flip runReaderT p $ runReaderT (f 100) ctx
          ) `catch` (\(e :: SomeException) -> do
                      $logErrorS "Ethereum Discovery ERROR" . T.pack $ show e
                      throwTo tid e
                    )

postEvent :: SeqLoopEvent -> CorePeer -> IO ()
postEvent e p = atomically $ writeTQueue (_corePeerUnseqSource p) e

postEvents :: [SeqLoopEvent] -> CorePeer -> IO ()
postEvents es p = atomically $ traverse_ (writeTQueue $ _corePeerUnseqSource p) es

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Map MP.StateRoot MP.NodeData)) where
  lookup _ k = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k = State.modify' $ \(a, b) -> (a, M.delete k b)

createCorePeer ::
  String ->
  String ->
  GenesisInfo ->
  Bool ->
  (Text -> LoggingT IO () -> IO ()) ->
  IO CorePeer
createCorePeer network' name genesisInfo valBehav logF = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  slipstreamSource <- newTQueueIO
  timerChan <- newTMChanIO
  nodeDataReqs <- newTVarIO M.empty
  let validators' = readValidatorsFromGenesisInfo genesisInfo
  seqCtx <- newSequencerContext $ newBlockstanbulContext network' validators' valBehav
  cache <- TRC.new 64
  let cstate = def & txRunResultsCache .~ cache
  coreContext <- coreContextIO seqCtx cstate

  pure $
    CorePeer
      (T.pack name)
      genesisInfo
      (BlockPeriod 1)
      (RoundPeriod 10)
      timerChan
      unseqSource
      seqP2pSource
      seqVmSource
      apiIndexerSource
      p2pIndexerSource
      slipstreamSource
      nodeDataReqs
      coreContext
      logF

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
  MP.initializeBlank
  genesisInfo <- asks _corePeerGenesisInfo
  let validators' = readValidatorsFromGenesisInfo genesisInfo
  gb <- genesisInfoToGenesisBlock validators' genesisInfo
  let genHash = rlpHash $ blockBlockData gb
  asks (_genesisBlock . _corePeerContext) >>= atomically . flip writeTVar gb
  asks (_genesisBlockHash . _corePeerContext) >>= atomically . flip writeTVar (GenesisBlockHash genHash)
  bsb' <- Mod.get (Mod.Proxy @BestSequencedBlock)
  if bestSequencedBlockNumber bsb' > 0
    then do
      bCtx <- getBlockstanbulContext
      putBlockstanbulContext $ (view . sequence .~ fromIntegral (bestSequencedBlockNumber bsb'))
                             . (validators .~ (Set.fromList $ bestSequencedBlockValidators bsb'))
                             $ bCtx
      let bh = bestSequencedBlockHash bsb'
      mOB <- A.lookup (A.Proxy @OutputBlock) bh
      case mOB of
        Nothing -> error $ "Couldn't locate best sequenced block: " ++ formatKeccak256WithoutColor bh
        Just ob -> do
          putContextBestBlockInfo $ ContextBestBlockInfo bh (obBlockData ob) (fromIntegral . BH.number $ obBlockData ob)
          processNewBestBlock bh (obBlockData ob) (rlpHash . otBaseTx <$> obReceiptTransactions ob)
          withCurrentBlockHash bh . setStateDBStateRoot Nothing . stateRoot $ obBlockData ob
    else do
      let bb = BestBlock genHash 0
          bsb = BestSequencedBlock genHash 0 []
      Mod.put (Mod.Proxy @WorldBestBlock) $ WorldBestBlock bb
      Mod.put (Mod.Proxy @BestBlock) bb
      Mod.put (Mod.Proxy @BestSequencedBlock) bsb
      let genHeader = blockBlockData gb
          genesisOutputBlock =
            OutputBlock
              { obOrigin = Origin.API,
                obBlockData = genHeader,
                obReceiptTransactions = [],
                obBlockUncles = []
              }
      (BlockHashRoot bhr) <- bootstrapChainDB genHash [(Nothing, stateRoot genHeader)]
      putContextBestBlockInfo $ ContextBestBlockInfo genHash genHeader 0
      Mod.put (Mod.Proxy @BlockHashRoot) $ BlockHashRoot bhr
      processNewBestBlock genHash genHeader [] -- bootstrap Bagger with genesis block
      A.insert (A.Proxy @OutputBlock) genHash genesisOutputBlock
      A.insert (A.Proxy @(API OutputBlock)) genHash $ API genesisOutputBlock
      A.replace (A.Proxy @(Canonical BlockHeader)) (0 :: Integer) (Canonical $ blockBlockData gb)
      DBDB.bootstrapGenesisBlock genHash
      withCurrentBlockHash genHash $ setStateDBStateRoot Nothing $ stateRoot genHeader
      writeBlockSummary genesisOutputBlock
      -- for_ (M.toList mpMap) $ \(k, v) -> A.insert (A.Proxy @MP.NodeData) k v
      -- for_ (genesisInfoCodeInfo genesisInfo) $ \(CodeInfo _ src _) -> addCode SolidVM $ Text.encodeUtf8 src

      slip <- asks _corePeerSlipstreamSource
      let pub sd vmes = do
            traverse_ Mod.output sd
            atomically $ writeTQueue slip vmes
      withCurrentBlockHash genHash $ populateStorageDBs' genesisInfo gb Nothing (stateRoot genHeader) pub

-- | A simple wrapper around a "TQueue". As data is pushed into the queue, the
--   source will read it and pass it down the conduit pipeline.
sourceFlushTQueue :: MonadIO m => TQueue a -> ConduitT z [a] m ()
sourceFlushTQueue q = forever $ liftIO (atomically $ (:) <$> readTQueue q <*> flushTQueue q) >>= yield

corePeerSequencer :: MonadBase m => CoreT m ()
corePeerSequencer = do
  unseqSource <- asks _corePeerUnseqSource
  seqVmSource <- asks _corePeerSeqVmSource
  seqP2pSource <- asks _corePeerSeqP2pSource
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
    sourceFlushTQueue seqVmSource
      .| (awaitForever $ yield . foldr VMEvent.insertInBatch VMEvent.newInBatch . concat)
      .| handleVmEvents
      .| (awaitForever $ yield . flip VMEvent.insertOutBatch VMEvent.newOutBatch)
      .| ( awaitForever $ \b -> do
             $logInfoS (name <> "/vm") . T.pack $ show $ toList (VMEvent.outEvents b)
             traverse_ Mod.output . toList $ VMEvent.outStateDiffs b
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
    sourceFlushTQueue apiIndexerSource
      .| ( awaitForever $ \evss -> do
             let evs = concat evss
             $logInfoS (name <> "/testApiIndexer") . T.pack $ show evs
             lift $ indexAPI evs
         )

corePeerP2pIndexer :: MonadBase m => CoreT m ()
corePeerP2pIndexer = do
  name <- asks _corePeerName
  p2pIndexerSource <- asks _corePeerP2pIndexSource
  runConduit $
    sourceFlushTQueue p2pIndexerSource
      .| ( awaitForever $ \evss -> do
             let evs = concat evss
             $logInfoS (name <> "/testP2pIndexer") . T.pack $ show evs
             lift $ indexP2P evs
         )

corePeerSlipstream :: MonadBase m => CoreT m ()
corePeerSlipstream = do
  slipstreamSource <- asks _corePeerSlipstreamSource
  runConduit $
    sourceFlushTQueue slipstreamSource
      .| ( do
             yieldMany $ Right <$> initialSlipstreamQueries
             awaitForever $ \vmes -> do
              _ <- mapInput (const ()) (const Nothing) . processTheMessages $ concat vmes
              pure ()
         )
      .| ( awaitForever $ \case
           Left txr -> lift $ Mod.yield txr
           Right cmds  -> lift $ Mod.output cmds
         )