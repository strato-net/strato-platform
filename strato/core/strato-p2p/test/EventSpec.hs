{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PackageImports        #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
module EventSpec where

import           Prelude hiding (round)
import           Conduit
import           Control.Concurrent.STM.TMChan
import           Control.Lens                          hiding (Context, view)
import qualified Control.Lens                          as Lens
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import qualified Control.Monad.State                   as State
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue                   hiding (newTQueueIO)
import           Data.Default                          (def)
import           Data.Foldable                         (for_, toList, traverse_)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import           Data.Maybe                            (fromMaybe)
import qualified Data.NibbleString                     as N
import qualified Data.Set                              as Set
import qualified Data.Set.Ordered                      as S
import qualified Data.Sequence                         as Q
import           Data.Text (Text)
import           Data.Traversable                      (for)
import           Text.Printf

import           BlockApps.Logging
import           Blockchain.Bagger
import           Blockchain.Bagger.BaggerState
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Blockstanbul.Messages      (round)
import           Blockchain.Blockstanbul.StateMachine
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.BlockDB()
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import qualified Blockchain.Database.MerklePatricia    as MP
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import qualified Blockchain.DB.X509CertDB              as X509
import "strato-p2p" Blockchain.Event
import qualified "vm-runner" Blockchain.Event          as VMEvent
import           Blockchain.MemVMContext               hiding (getMemContext, get, gets, put, modify, modify', dbsGet, dbsGets, dbsPut, dbsModify, dbsModify', contextGet, contextGets, contextPut, contextModify, contextModify')
import           Blockchain.VMContext                  (VMBase, IsBlockstanbul(..), baggerState)
import           Blockchain.Options                    (AuthorizationMode(..))
import           Blockchain.Privacy
import qualified Blockchain.Sequencer                  as Seq
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad

import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import           Blockchain.Strato.Indexer.ApiIndexer
import           Blockchain.Strato.Indexer.IContext    (API(..), P2P(..), IndexerException(..))
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Indexer.P2PIndexer
import           Blockchain.Strato.Indexer.TxrIndexer
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256     (Keccak256, zeroHash, unsafeCreateKeccak256FromWord256)
import           Blockchain.Strato.Model.Secp256k1
import qualified Blockchain.TxRunResultCache           as TRC

import           Debugger                              (DebugSettings)

import           Executable.EthereumVM
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer


import           Test.Hspec
import qualified Test.Hspec.Expectations.Lifted        as L
import           Test.QuickCheck

import           UnliftIO
import           UnliftIO.Concurrent                   (threadDelay)

data TestContext = TestContext
  { _blocks                :: [Block]
  , _blockHeaders          :: [DataDefs.BlockData]
  , _remainingBlockHeaders :: RemainingBlockHeaders
  , _actionTimestamp       :: ActionTimestamp
  , _connectionTimeout     :: ConnectionTimeout
  , _maxReturnedHeaders    :: MaxReturnedHeaders
  , _peerAddr              :: PeerAddress
  , _prvKey                :: PrivateKey
  , _shaBlockDataMap       :: Map Keccak256 DataDefs.BlockData
  , _p2pWorldBestBlock     :: WorldBestBlock
  , _bestBlock             :: BestBlock
  , _canonicalBlockDataMap :: Map Integer (Canonical DataDefs.BlockData)
  , _ipAddressIpChainsMap  :: Map IPAddress IPChains
  , _orgIdChainsMap        :: Map OrgId OrgIdChains
  , _shaChainTxsInBlockMap :: Map Keccak256 ChainTxsInBlock
  , _chainMembersMap       :: Map Word256 ChainMembers
  , _chainInfoMap          :: Map Word256 ChainInfo
  , _privateTxMap          :: Map Keccak256 (Private (Word256, OutputTx))
  , _genesisBlockHash      :: GenesisBlockHash
  , _bestBlockNumber       :: BestBlockNumber
  , _stringPPeerMap        :: Map String DataPeer.PPeer
  , _pbftMessages          :: S.OSet Keccak256
  , _outboundPbftMessages  :: S.OSet (Text, Keccak256)
  , _unseqEvents           :: [IngestEvent]
  , _sequencerContext      :: SequencerContext
  , _vmContext             :: MemContext
  }

makeLenses ''TestContext

type TestContextM = ReaderT (TVar TestContext) (ResourceT (LoggingT IO))

type MonadTest m = ReaderT (TVar TestContext) m

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState TestContext (MonadTest m) where
  state f = ask >>= \ctx -> liftIO . atomically $ do
    s <- readTVar ctx
    let (a, s') = f s
    writeTVar ctx s'
    pure a

instance MonadIO m => Stacks Block (MonadTest m) where
  takeStack _ n = take n <$> use blocks
  pushStack bs  = do
    let maxNum = maximum $ DataDefs.blockDataNumber . blockBlockData <$> bs
    bestBlockNumber %= (\(BestBlockNumber n) -> BestBlockNumber $ max maxNum n)
    blocks %= (bs ++)

instance MonadIO m => (Keccak256 `A.Alters` DataDefs.BlockData) (MonadTest m) where
  lookup _ k   = M.lookup k <$> use shaBlockDataMap
  insert _ k v = shaBlockDataMap %= M.insert k v
  delete _ k   = shaBlockDataMap %= M.delete k

instance MonadIO m => Mod.Modifiable WorldBestBlock (MonadTest m) where
  get _ = use p2pWorldBestBlock
  put _ = assign p2pWorldBestBlock

instance MonadIO m => Mod.Modifiable BestBlock (MonadTest m) where
  get _ = use bestBlock
  put _ = assign bestBlock

instance MonadIO m => A.Selectable Integer (Canonical DataDefs.BlockData) (MonadTest m) where
  select _ i = M.lookup i <$> use canonicalBlockDataMap

instance MonadIO m => A.Selectable IPAddress IPChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use ipAddressIpChainsMap

instance MonadIO m => A.Selectable OrgId OrgIdChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use orgIdChainsMap

instance MonadIO m => A.Selectable Keccak256 ChainTxsInBlock (MonadTest m) where
  select _ sha = M.lookup sha <$> use shaChainTxsInBlockMap

instance MonadIO m => A.Selectable Word256 ChainMembers (MonadTest m) where
  select _ cid = M.lookup cid <$> use chainMembersMap

instance MonadIO m => A.Selectable Word256 ChainInfo (MonadTest m) where
  select _ cid = M.lookup cid <$> use chainInfoMap

instance MonadIO m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (MonadTest m) where
  select _ tx = M.lookup tx <$> use privateTxMap

instance MonadIO m => Mod.Accessible GenesisBlockHash (MonadTest m) where
  access _ = use genesisBlockHash

instance MonadIO m => Mod.Accessible BestBlockNumber (MonadTest m) where
  access _ = use bestBlockNumber

instance MonadIO m => Mod.Modifiable ActionTimestamp (MonadTest m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance MonadIO m => Mod.Accessible ActionTimestamp (MonadTest m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [DataDefs.BlockData] (MonadTest m) where
  get _ = use blockHeaders
  put _ = assign blockHeaders

instance MonadIO m => Mod.Accessible [DataDefs.BlockData] (MonadTest m) where
  access _ = Mod.get (Mod.Proxy @[DataDefs.BlockData])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (MonadTest m) where
  get _ = use remainingBlockHeaders
  put _ = assign remainingBlockHeaders

instance MonadIO m => Mod.Accessible RemainingBlockHeaders (MonadTest m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Accessible MaxReturnedHeaders (MonadTest m) where
  access _ = use maxReturnedHeaders

instance MonadIO m => Mod.Modifiable PeerAddress (MonadTest m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance MonadIO m => Mod.Accessible PeerAddress (MonadTest m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance MonadIO m => Mod.Accessible ConnectionTimeout (MonadTest m) where
  access _ = use connectionTimeout

instance MonadIO m => A.Selectable String DataPeer.PPeer (MonadTest m) where
  select _ tx = M.lookup tx <$> use stringPPeerMap

instance MonadIO m => Mod.Modifiable GetChainsDB (MonadTest m) where
  get _ = use $ sequencerContext . getChainsDB
  put _ = assign $ sequencerContext . getChainsDB

instance MonadIO m => Mod.Modifiable GetTransactionsDB (MonadTest m) where
  get _ = use $ sequencerContext . getTransactionsDB
  put _ = assign $ sequencerContext . getTransactionsDB

instance MonadIO m => HasPrivateHashDB (MonadTest m) where
  requestChain = insertGetChainsDB
  requestTransaction = insertGetTransactionsDB


genericTestLookup :: (State.MonadState s m, Ord k)
                  => Lens' s (Map k (Modification a))
                  -> Mod.Proxy a
                  -> k
                  -> m (Maybe a)
genericTestLookup registry _ k = use (registry . at k) >>= \case
  Just (Modification a) -> pure $ Just a
  _ -> pure Nothing

genericTestInsert :: (State.MonadState s m, Ord k)
                  => Lens' s (Map k (Modification a))
                  -> Mod.Proxy a
                  -> k
                  -> a
                  -> m ()
genericTestInsert registry _ k a = registry . at k ?= Modification a

genericTestDelete :: (State.MonadState s m, Ord k)
                  => Lens' s (Map k (Modification a))
                  -> Mod.Proxy a
                  -> k
                  -> m ()
genericTestDelete registry _ k = registry . at k ?= Deletion

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . blockHashRegistry
  insert = genericTestInsert $ sequencerContext . blockHashRegistry
  delete = genericTestDelete $ sequencerContext . blockHashRegistry

instance MonadIO m => (Keccak256 `A.Alters` EmittedBlock) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . emittedBlockRegistry
  insert = genericTestInsert $ sequencerContext . emittedBlockRegistry
  delete = genericTestDelete $ sequencerContext . emittedBlockRegistry

instance MonadIO m => (Keccak256 `A.Alters` OutputTx) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . txHashRegistry
  insert = genericTestInsert $ sequencerContext . txHashRegistry
  delete = genericTestDelete $ sequencerContext . txHashRegistry

instance MonadIO m => (Keccak256 `A.Alters` ChainHashEntry) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . chainHashRegistry
  insert = genericTestInsert $ sequencerContext . chainHashRegistry
  delete = genericTestDelete $ sequencerContext . chainHashRegistry

instance MonadIO m => (Word256 `A.Alters` ChainIdEntry) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . chainIdRegistry
  insert = genericTestInsert $ sequencerContext . chainIdRegistry
  delete = genericTestDelete $ sequencerContext . chainIdRegistry

instance MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (MonadTest m) where
  lookup _ k = use $ sequencerContext . dbeRegistry . at k
  insert _ k v = sequencerContext . dbeRegistry . at k ?= v
  delete _ k = sequencerContext . dbeRegistry . at k .= Nothing

instance MonadIO m => A.Selectable (Maybe Word256) ParentChainId (MonadTest m) where
  select _ = \case
    Nothing -> pure . Just $ ParentChainId Nothing
    Just cId -> join . fmap (fmap (ParentChainId . parentChain . chainInfo) . _chainIdInfo) <$> A.lookup (A.Proxy @ChainIdEntry) cId

instance MonadIO m => Mod.Modifiable SeenTransactionDB (MonadTest m) where
  get _ = use $ sequencerContext . seenTransactionDB
  put _ = assign $ sequencerContext . seenTransactionDB

instance MonadIO m => Mod.Accessible (IORef RoundNumber) (MonadTest m) where
  access _ = use $ sequencerContext . latestRoundNumber

instance MonadIO m => Mod.Accessible (TMChan RoundNumber) (MonadTest m) where
  access _ = pure (error "MonadTest: Accessing (TMChan RoundNumber)")

instance MonadIO m => Mod.Accessible BlockPeriod (MonadTest m) where
  access _ = pure (error "MonadTest: Accessing BlockPeriod")

instance MonadIO m => Mod.Accessible RoundPeriod (MonadTest m) where
  access _ = pure (error "MonadTest: Accessing RoundPeriod")

instance MonadIO m => Mod.Accessible (TQueue CandidateReceived) (MonadTest m) where
  access _ = pure (error "MonadTest: Accessing (TQueue CandidateReceived)")

instance MonadIO m => Mod.Accessible (TQueue VoteResult) (MonadTest m) where
  access _ = pure (error "MonadTest: Accessing (TQueue VoteResult)")

instance MonadIO m => Mod.Accessible View (MonadTest m) where
  access _ = currentView

instance MonadIO m => (Keccak256 `A.Alters` ()) (MonadTest m) where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance MonadIO m => HasBlockstanbulContext (MonadTest m) where
  getBlockstanbulContext = use $ sequencerContext . blockstanbulContext
  putBlockstanbulContext = assign (sequencerContext . blockstanbulContext . _Just)

instance MonadIO m => HasVault (MonadTest m) where
  sign bs = do
    pk <- use prvKey
    return $ signMsg pk bs
  
  getPub = do
    pk <- use prvKey
    return $ derivePublicKey pk
  
  getShared pub = do
    pk <- use prvKey
    return $ deriveSharedKey pk pub

instance MonadIO m => (Keccak256 `A.Alters` (A.Proxy (Inbound WireMessage))) (MonadTest m) where
  lookup _  k = do
    wms <- use pbftMessages
    pure $ if S.member k wms then Just (A.Proxy @(Inbound WireMessage)) else Nothing
  insert _ k _ = pbftMessages %= (\wms ->
    let s = S.size wms
        wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
     in wms' S.>| k)
  delete _ k = pbftMessages %= S.delete k

instance MonadIO m => ((Text, Keccak256) `A.Alters` (A.Proxy (Outbound WireMessage))) (MonadTest m) where
  lookup _  k = do
    wms <- use outboundPbftMessages
    pure $ if S.member k wms then Just (A.Proxy @(Outbound WireMessage)) else Nothing
  insert _ k _ = do
    wms <- use outboundPbftMessages
    let s = S.size wms
        wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
    assign outboundPbftMessages wms''
  delete _ k = outboundPbftMessages %= S.delete k

getMemContext :: MonadIO m => MonadTest m MemContext
getMemContext = ask >>= fmap _vmContext . readTVarIO

get :: MonadIO m => MonadTest m ContextState
get = _state <$> getMemContext
{-# INLINE get #-}

gets :: MonadIO m => (ContextState -> a) -> MonadTest m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => ContextState -> MonadTest m ()
put c = ask >>= \i -> atomically . modifyTVar' i $ vmContext . state .~ c
{-# INLINE put #-}

modify :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
modify f = ask >>= \i -> atomically . modifyTVar' i $ vmContext . state %~ f
{-# INLINE modify #-}

modify' :: MonadIO m => (ContextState -> ContextState) -> MonadTest m ()
modify' f = ask >>= \i -> atomically . modifyTVar' i $ vmContext . state %~ f
{-# INLINE modify' #-}

dbsGet :: MonadIO m => MonadTest m MemContextDBs
dbsGet = _dbs <$> getMemContext
{-# INLINE dbsGet #-}

dbsGets :: MonadIO m => (MemContextDBs -> a) -> MonadTest m a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MonadIO m => MemContextDBs -> (MonadTest m) ()
dbsPut c = ask >>= \i -> atomically . modifyTVar' i $ vmContext . dbs .~ c
{-# INLINE dbsPut #-}

dbsModify :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadTest m ()
dbsModify f = ask >>= \i -> atomically . modifyTVar' i $ vmContext . dbs %~ f
{-# INLINE dbsModify #-}

dbsModify' :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadTest m ()
dbsModify' f = ask >>= \i -> atomically . modifyTVar' i $ vmContext . dbs %~ f
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

instance MonadIO m => Mod.Accessible MemContext (MonadTest m) where
  access _ = getMemContext

instance MonadIO m => Mod.Modifiable (Maybe DebugSettings) (MonadTest m) where
  get _    = gets $ Lens.view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance MonadIO m => Mod.Accessible ContextState (MonadTest m) where
  access _ = get

instance MonadIO m => Mod.Accessible MemDBs (MonadTest m) where
  access _ = gets $ Lens.view memDBs

instance MonadIO m => Mod.Modifiable MemDBs (MonadTest m) where
  get _    = gets $ Lens.view memDBs
  put _ md = modify $ memDBs .~ md

instance MonadIO m => Mod.Modifiable BlockHashRoot (MonadTest m) where
  get _     = dbsGets $ Lens.view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance MonadIO m => Mod.Modifiable GenesisRoot (MonadTest m) where
  get _    = dbsGets $ Lens.view genesisRoot
  put _ gr = dbsModify' $ genesisRoot .~ gr

instance MonadIO m => Mod.Modifiable BestBlockRoot (MonadTest m) where
  get _     = dbsGets $ Lens.view bestBlockRoot
  put _ bbr = dbsModify' $ bestBlockRoot .~ bbr

instance MonadIO m => Mod.Modifiable X509.CertRoot (MonadTest m) where
  get _     = dbsGets $ Lens.view certRoot
  put _ bbr = dbsModify' $ certRoot .~ bbr

instance MonadIO m => Mod.Modifiable CurrentBlockHash (MonadTest m) where
  get _    = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ Lens.view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance MonadIO m => HasMemAddressStateDB (MonadTest m) where
  getAddressStateTxDBMap = gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap

instance MonadIO m => X509.HasMemCertDB (MonadTest m) where
  getCertTxDBMap = gets $ Lens.view $ memDBs . certTxMap
  putCertTxDBMap theMap = modify $ memDBs . certTxMap .~ theMap
  getCertBlockDBMap = gets $ Lens.view $ memDBs . certBlockMap
  putCertBlockDBMap theMap = modify $ memDBs . certBlockMap .~ theMap

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MonadTest m) where
  lookup _ sr    = dbsGets $ Lens.view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr    = dbsModify' $ stateDB . at sr .~ Nothing

instance MonadIO m => (Account `A.Alters` AddressState) (MonadTest m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance MonadIO m => (Maybe Word256 `A.Alters` MP.StateRoot) (MonadTest m) where
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
  lookup _ k   = dbsGets $ Lens.view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k   = dbsModify' $ codeDB . at k .~ Nothing

instance MonadIO m => (Address `A.Alters` X509.X509Certificate) (MonadTest m) where
  lookup _ k = do
    mBH <- gets $ Lens.view $ memDBs . currentBlock
    fmap join . for mBH $ \(CurrentBlockHash bh) -> X509.getCertMaybe k bh
  insert _ = X509.putCert
  delete _ = X509.deleteCert

instance MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (MonadTest m) where
  lookup _ n1    = dbsGets $ Lens.view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1    = dbsModify' $ hashDB . at n1 .~ Nothing

instance MonadIO m => HasMemRawStorageDB (MonadTest m) where
  getMemRawStorageTxDB = gets $ Lens.view $ memDBs . storageTxMap
  putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
  getMemRawStorageBlockDB = gets $ Lens.view $ memDBs . storageBlockMap
  putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap

instance MonadIO m => (RawStorageKey `A.Alters` RawStorageValue) (MonadTest m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance MonadIO m => (Keccak256 `A.Alters` BlockSummary) (MonadTest m) where
  lookup _ k    = dbsGets $ Lens.view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k    = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MonadTest m) where
  access _ = dbsGets $ Lens.view worldBestBlock

instance MonadIO m => Mod.Accessible IsBlockstanbul (MonadTest m) where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance MonadIO m => Mod.Modifiable BaggerState (MonadTest m) where
  get _   = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance MonadIO m => Mod.Accessible TRC.Cache (MonadTest m) where
  access _ = contextGets _txRunResultsCache

instance MonadIO m => (MonadTest m) `Mod.Yields` DataDefs.TransactionResult where
  yield = const (pure ())

instance MonadIO m => (Keccak256 `A.Alters` API OutputTx) (MonadTest m) where
  lookup _ _   = pure Nothing
  delete _ _   = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Word256 `A.Alters` API ChainInfo) (MonadTest m) where
  lookup _ _   = pure Nothing
  delete _ _   = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (MonadTest  m) where
  lookup _ _   = pure Nothing
  delete _ _   = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "Private (Word256, OutputTx)"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "Private (Word256, OutputTx)"
  insert _ k (P2P v) = privateTxMap . at k ?= v

instance MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "OutputBlock"
  insert _ _ _ = pure ()

instance MonadIO m => Mod.Modifiable (P2P BestBlock) (MonadTest m) where
  get _          = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P bb) = bestBlock .= bb

instance MonadIO m => (Word256 `A.Alters` P2P ChainInfo) (MonadTest m) where
  lookup _ _   = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainInfo"
  delete _ _   = liftIO . throwIO $ Delete "P2P" "Word256" "ChainInfo"
  insert _ cId (P2P cInfo) = chainInfoMap . at cId ?= cInfo

instance MonadIO m => (Word256 `A.Alters` P2P ChainMembers) (MonadTest m) where
  lookup _ _   = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainMembers"
  delete _ _   = liftIO . throwIO $ Delete "P2P" "Word256" "ChainMembers"
  insert _ cId (P2P mems) = chainMembersMap . at cId ?= mems

startingCheckpoint :: [Address] -> Checkpoint
startingCheckpoint as = def{checkpointValidators = as}

newBlockstanbulContext :: Address -> [Address] -> BlockstanbulContext
newBlockstanbulContext paddr as =
  let ckpt = startingCheckpoint as
  in newContext ckpt paddr

emptyBlockstanbulContext :: BlockstanbulContext
emptyBlockstanbulContext = newBlockstanbulContext undefined []
  
newSequencerContext :: MonadIO m => BlockstanbulContext -> m SequencerContext
newSequencerContext bc = do
  -- loopCh <- atomically newTMChan
  latestRound <- newIORef 0
  pure $ SequencerContext
      { _dependentBlockDB    = error "EventSpec: Evaluating dependentBlockDB"
      , _seenTransactionDB   = mkSeenTxDB 1024
      , _dbeRegistry         = M.empty
      , _blockHashRegistry   = M.empty
      , _emittedBlockRegistry = M.singleton zeroHash $ Modification alreadyEmittedBlock
      , _txHashRegistry      = M.empty
      , _chainHashRegistry   = M.empty
      , _chainIdRegistry     = M.empty
      , _getChainsDB         = emptyGetChainsDB
      , _getTransactionsDB   = emptyGetTransactionsDB
      , _ldbBatchOps         = Q.empty
      , _blockstanbulContext = Just bc
      , _loopTimeout         = error "MonadTest: Evaluating loopTimeout" -- loopCh
      , _latestRoundNumber   = latestRound
      }

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
testContext :: PrivateKey -> SequencerContext -> MemContext -> TestContext
testContext prv seqCtx vmCtx = TestContext
  { _blocks                = []
  , _blockHeaders          = []
  , _remainingBlockHeaders = RemainingBlockHeaders []
  , _actionTimestamp       = emptyActionTimestamp
  , _connectionTimeout     = ConnectionTimeout 60
  , _maxReturnedHeaders    = MaxReturnedHeaders 1000
  , _peerAddr              = PeerAddress Nothing
  , _prvKey                = prv
  , _shaBlockDataMap       = M.empty
  , _p2pWorldBestBlock     = WorldBestBlock (BestBlock zeroHash (-1) 0)
  , _bestBlock             = BestBlock zeroHash (-1) 0
  , _canonicalBlockDataMap = M.empty
  , _ipAddressIpChainsMap  = M.empty
  , _orgIdChainsMap        = M.empty
  , _shaChainTxsInBlockMap = M.empty
  , _chainMembersMap       = M.empty
  , _chainInfoMap          = M.empty
  , _privateTxMap          = M.empty
  , _genesisBlockHash      = GenesisBlockHash zeroHash
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  , _pbftMessages          = S.empty
  , _outboundPbftMessages  = S.empty
  , _unseqEvents           = []
  , _sequencerContext      = seqCtx
  , _vmContext             = vmCtx
  }

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

runTestPeer :: TestContextM a -> IO ()
runTestPeer f = do
  seqCtx <- newSequencerContext emptyBlockstanbulContext
  cache <- TRC.new 64
  let cstate = def & txRunResultsCache .~ cache
      vmCtx = MemContext def cstate
  ctx <- newTVarIO $ testContext undefined seqCtx vmCtx
  void . runNoLoggingT . runResourceT $ runReaderT f ctx

execTestPeer :: PrivateKey
             -> [Address]
             -> TestContextM a
             -> IO (a, TestContext)
execTestPeer = execTestPeerOnRound 0

execTestPeerOnRound :: Word256
                    -> PrivateKey
                    -> [Address]
                    -> TestContextM a
                    -> IO (a, TestContext)
execTestPeerOnRound n pk as f = do
  seqCtx <- newSequencerContext $ (view . round .~ n) (newBlockstanbulContext (fromPrivateKey pk) as)
  cache <- TRC.new 64
  let cstate = def & txRunResultsCache .~ cache
      vmCtx = MemContext def cstate
  ctx <- newTVarIO $ testContext pk seqCtx vmCtx
  a <- runLoggingT . runResourceT $ runReaderT f ctx
  ctx' <- readTVarIO ctx
  return (a, ctx')

execTestPeerWithContext :: TestContextM a -> TestContext -> IO (a, TestContext)
execTestPeerWithContext f ctx = do
  ref <- newTVarIO ctx
  a <- runLoggingT . runResourceT $ runReaderT f ref
  ctx' <- readTVarIO ref
  return (a, ctx')

data P2PPeer m = P2PPeer
  { _p2pPeerPrivKey     :: PrivateKey
  , _p2pPeerPPeer       :: DataPeer.PPeer
  , _p2pPeerUnseqSource :: TQueue SeqLoopEvent
  , _p2pPeerSeqP2pSource :: TMChan (Either TxrResult P2pEvent)
  , _p2pPeerSeqVmSource :: TQueue [VmEvent]
  , _p2pPeerApiIndexSource :: TQueue [IndexEvent]
  , _p2pPeerP2pIndexSource :: TQueue [IndexEvent]
  , _p2pPeerTxrIndexSource :: TQueue IndexEvent
  , _p2pPeerUnseqSink   :: [IngestEvent] -> m ()
  , _p2pPeerName        :: String
  , _p2pPeerSequencer   :: m ()
  , _p2pPeerVm          :: m ()
  , _p2pPeerApiIndexer  :: m ()
  , _p2pPeerP2pIndexer  :: m ()
  , _p2pPeerTxrIndexer  :: m ()
  }

createPeer :: ( Seq.MonadSequencer m 
              , MonadFail m
              , VMBase m
              , MonadBagger m
              , (Keccak256 `A.Alters` API OutputTx) m
              , (Word256 `A.Alters` API ChainInfo) m
              , (Keccak256 `A.Alters` API OutputBlock) m
              , (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) m
              , (Keccak256 `A.Alters` P2P OutputBlock) m
              , Mod.Modifiable (P2P BestBlock) m
              , (Word256 `A.Alters` P2P ChainInfo) m
              , (Word256 `A.Alters` P2P ChainMembers) m
              , State.MonadState TestContext m
              )
           => ([IngestEvent] -> m ())
           -> String
           -> String
           -> IO (P2PPeer m)
createPeer unseqSink name ipAddr = do
  privKey <- newPrivateKey
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  txrIndexerSource <- newTQueueIO
  let sequencer = runConduit $ sourceTQueue unseqSource
                            .| mapMC (Seq.runSequencerBatch . (:[]))
                            .| (awaitForever $ \b -> atomically $ do
                                  traverse_ (writeTMChan seqP2pSource . Right) $ Seq._toP2p b
                                  writeTQueue seqVmSource $ Seq._toVm b
                               )
  let vm = runConduit $ sourceTQueue seqVmSource
                     .| (awaitForever $ yield . foldr VMEvent.insertInBatch VMEvent.newInBatch)
                     .| handleVmEvents
                     .| (awaitForever $ yield . flip VMEvent.insertOutBatch VMEvent.newOutBatch)
                     .| (awaitForever $ \b -> atomically $ do
                          traverse_ (writeTQueue unseqSource) $ UnseqEvent . IEBlock . blockToIngestBlock Origin.Quarry . outputBlockToBlock <$> toList (VMEvent.outBlocks b)
                          writeTQueue apiIndexerSource $ toList (VMEvent.outIndexEvents b)
                          writeTQueue p2pIndexerSource $ toList (VMEvent.outIndexEvents b)
                          traverse_ (writeTQueue txrIndexerSource) $ toList (VMEvent.outIndexEvents b)
                        )
      apiIndexer' = runConduit $ sourceTQueue apiIndexerSource
                              .| (awaitForever $ lift . indexAPI)
      p2pIndexer' = runConduit $ sourceTQueue p2pIndexerSource
                              .| (awaitForever $ lift . indexP2P)
      txrIndexer' = runConduit $ sourceTQueue txrIndexerSource
                              .| (awaitForever $ yieldMany . indexEventToTxrResults)
                              .| (awaitForever $ \case
                                    AddMember (Right (cId, addr, enode)) -> do
                                      chainMembersMap %= (\m -> case M.lookup cId m of
                                        Nothing -> M.insert cId (ChainMembers $ M.singleton addr enode) m
                                        Just (ChainMembers cm) -> M.insert cId (ChainMembers $ M.insert addr enode cm) m)
                                      ipAddressIpChainsMap %= (\m -> case M.lookup (ipAddress enode) m of
                                        Nothing -> M.insert (ipAddress enode) (IPChains $ Set.singleton cId) m
                                        Just (IPChains s) -> M.insert (ipAddress enode) (IPChains $ Set.insert cId s) m)
                                      orgIdChainsMap %= (\m -> case M.lookup (pubKey enode) m of
                                        Nothing -> M.insert (pubKey enode) (OrgIdChains $ Set.singleton cId) m
                                        Just (OrgIdChains s) -> M.insert (pubKey enode) (OrgIdChains $ Set.insert cId s) m)
                                    RemoveMember (Right (cId, addr)) -> do
                                      mEnode <- join . fmap (M.lookup addr . unChainMembers) <$> use (chainMembersMap . at cId)
                                      chainMembersMap . at cId . _Just %= ChainMembers . M.delete addr . unChainMembers
                                      for_ mEnode $ \enode -> do
                                        ipAddressIpChainsMap . at (ipAddress enode) . _Just %= IPChains . Set.delete cId . unIPChains
                                        orgIdChainsMap . at (pubKey enode) . _Just %= OrgIdChains . Set.delete cId . unOrgIdChains
                                    RegisterCertificate _ -> pure () --(Right (addr, certState)) -> pure ()
                                    CertificateRevoked _ -> pure () --(Right addr) -> pure ()
                                    CertificateRegistryInitialized _ -> pure () --(Right ()) -> pure ()
                                    TerminateChain _ -> pure ()
                                    PutLogDB _ -> pure ()
                                    PutEventDB _ -> pure ()
                                    PutTxResult _ -> pure ()
                                    _ -> pure ()
                                 )
      pubkeystr = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False $ derivePublicKey privKey
      ppeer = DataPeer.buildPeer ( Just pubkeystr
                                 , ipAddr
                                 , 30303
                                 )
      unseq ies = do
        for_ (UnseqEvent <$> ies) $ atomically . writeTQueue unseqSource
        unseqSink ies
  pure $ P2PPeer
    privKey
    ppeer
    unseqSource
    seqP2pSource
    seqVmSource
    apiIndexerSource
    p2pIndexerSource
    txrIndexerSource
    unseq
    name
    sequencer
    vm
    apiIndexer'
    p2pIndexer'
    txrIndexer'

data P2PConnection m = P2PConnection
  { _serverToClient :: TQueue B.ByteString
  , _clientToServer :: TQueue B.ByteString
  , _serverP2PPeer  :: P2PPeer m
  , _clientP2PPeer  :: P2PPeer m
  , _runServer      :: m (Maybe SomeException)
  , _runClient      :: m (Maybe SomeException) 
  }

createConnection :: MonadP2P m
                 => P2PPeer m
                 -> P2PPeer m
                 -> IO (P2PConnection m)
createConnection server client = do
  serverToClient <- newTQueueIO
  clientToServer <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource server
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client
  let runServer = runEthServerConduit (_p2pPeerPPeer client)
                                      (sourceTQueue clientToServer)
                                      (sinkTQueue serverToClient)
                                      (sourceTMChan serverSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                      (_p2pPeerUnseqSink server)
                                      (_p2pPeerName server ++ " -> " ++ _p2pPeerName client)
      runClient = runEthClientConduit (_p2pPeerPPeer server)
                                      (sourceTQueue serverToClient)
                                      (sinkTQueue clientToServer)
                                      (sourceTMChan clientSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                      (_p2pPeerUnseqSink client)
                                      (_p2pPeerName client ++ " -> " ++ _p2pPeerName server)
  pure $ P2PConnection
    serverToClient
    clientToServer
    server
    client
    runServer
    runClient

runConnectionWith :: (PrivateKey -> m (Maybe SomeException) -> IO b) 
                  -> P2PConnection m 
                  -> IO (b, b)
runConnectionWith f connection =
  let server = _serverP2PPeer connection
      client = _clientP2PPeer connection
      runServer = f (_p2pPeerPrivKey server) $ _runServer connection
      runClient = f (_p2pPeerPrivKey client) $ _runClient connection
   in concurrently runServer runClient

makeValidators :: [P2PPeer m] -> [Address]
makeValidators = map (fromPrivateKey . _p2pPeerPrivKey)

-- endlessStreamOfIPAddresses :: [String]
-- endlessStreamOfIPAddresses = generateThem
--   where galois x = let y = (7*chx) `mod` 256 in x : galois y
--         check x = if x == 0 then 1 else x
--         ips xs = take 4 xs : ips (drop 4 xs)
--         toIP = L.intersperse '.' . map show
--         generateThem = toIP <$> ips (galois 1)
                          
spec :: Spec
spec = do
  describe "network simulation" $ do
    it "should send a transaction from server to client" $ do
      let unseqSink = (unseqEvents %=) . (++)
      server <- createPeer unseqSink "server" "1.2.3.4"
      client <- createPeer unseqSink "client" "5.6.7.8"
      let validatorAddresses = makeValidators [server, client]
      connection <- createConnection server client
      let clearChainId tx = case tx of
            MessageTX{} -> tx{transactionChainId = Nothing}
            ContractCreationTX{} -> tx{transactionChainId = Nothing}
            PrivateHashTX{} -> tx
      otx <- (\o -> o{otBaseTx = clearChainId (otBaseTx o), otOrigin = Origin.API}) <$> liftIO (generate arbitrary)
      let runForTwoSeconds pk = execTestPeer pk validatorAddresses . timeout 2000000
          run = runConnectionWith runForTwoSeconds connection
          postTx = threadDelay 500000 >> (atomically $ writeTMChan (_p2pPeerSeqP2pSource server) (Right $ P2pTx otx))
      ((_, serverCtx), (_, clientCtx)) <- fst <$> concurrently run postTx
      _unseqEvents serverCtx `shouldBe` []
      let clientTxs = [t | IETx _ (IngestTx _ t) <- _unseqEvents clientCtx]
      clientTxs `shouldBe` [otBaseTx otx]

    it "should update the round number on every node in the network" $ do
      let unseqSink = (unseqEvents %=) . (++)
      peers <- traverse (uncurry $ createPeer unseqSink)
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        , ("node4", "13.14.15.16")
        , ("node5", "17.18.19.20")
        , ("node6", "21.22.23.24")
        , ("node7", "25.26.27.28")
        ]
      connections <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 0, peers !! 3)
        , (peers !! 0, peers !! 4)
        , (peers !! 0, peers !! 5)
        , (peers !! 0, peers !! 6)
        , (peers !! 1, peers !! 2)
        , (peers !! 1, peers !! 3)
        , (peers !! 1, peers !! 4)
        , (peers !! 1, peers !! 5)
        ]
      let validators' = take 2 peers
          validatorAddresses = makeValidators validators'
          runForTwoSeconds :: PrivateKey -> TestContextM a -> IO TestContext
          runForTwoSeconds pk = fmap snd . execTestPeer pk validatorAddresses . timeout 2000000
          runSequencers = mapConcurrently (\p -> runForTwoSeconds (_p2pPeerPrivKey p) (_p2pPeerSequencer p)) peers
          runConnections = mapConcurrently (runConnectionWith runForTwoSeconds) connections
          postTimeout = do
            threadDelay 1000000
            for_ validators' (\p -> atomically $ writeTQueue (_p2pPeerUnseqSource p) (TimerFire 0))
      ctxs <- fst <$> concurrently runSequencers (concurrently runConnections postTimeout)
      ifor_ ctxs $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1 :: Maybe Word256)
  

    it "should update the round number after failing on a divided network first" $ do
      let unseqSink = (unseqEvents %=) . (++)
      peers <- traverse (uncurry $ createPeer unseqSink)
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      connections <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      let validators' = peers
          primaryValidators = [head validators']
          secondaryValidators = tail validators'
          primaryValidatorAddresses = makeValidators primaryValidators
          validatorAddresses = makeValidators validators'
          runForTwoSecondsPrimary :: Word256 -> PrivateKey -> TestContextM a -> IO TestContext
          runForTwoSecondsPrimary n pk = fmap snd . execTestPeerOnRound n pk primaryValidatorAddresses . timeout 2000000
          runForTwoSecondsSecondary :: Word256 -> PrivateKey -> TestContextM a -> IO TestContext
          runForTwoSecondsSecondary n pk = fmap snd . execTestPeerOnRound n pk validatorAddresses . timeout 2000000
          runForTwoSecondsWithContext :: TestContext -> TestContextM a -> IO TestContext
          runForTwoSecondsWithContext ctx = fmap snd . flip execTestPeerWithContext ctx . timeout 2000000
          runSequencersPrimary1 = mapConcurrently (\p -> runForTwoSecondsPrimary 0 (_p2pPeerPrivKey p) (_p2pPeerSequencer p)) primaryValidators
          runSequencersSecondary = mapConcurrently (\p -> runForTwoSecondsSecondary 1000 (_p2pPeerPrivKey p) (_p2pPeerSequencer p)) secondaryValidators
          runSequencers1 = concurrently runSequencersPrimary1 runSequencersSecondary
          runSequencers2 ctxs = mapConcurrently (\(ctx, p) -> runForTwoSecondsWithContext ((sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses) ctx) (_p2pPeerSequencer p)) $ zip ctxs peers
          runConnections = mapConcurrently (runConnectionWith $ runForTwoSecondsSecondary 0) connections
          postTimeoutPrimary1 = do
            threadDelay 1000000
            for_ primaryValidators (\p -> atomically $ writeTQueue (_p2pPeerUnseqSource p) (TimerFire 0))
          postTimeoutPrimary2 = do
            threadDelay 1000000
            for_ primaryValidators (\p -> atomically $ writeTQueue (_p2pPeerUnseqSource p) (TimerFire 1))
          postTimeoutSecondary = do
            threadDelay 1000000
            for_ secondaryValidators (\p -> atomically $ writeTQueue (_p2pPeerUnseqSource p) (TimerFire 1000))
      ctxs1 <- uncurry (++) . fst <$> concurrently runSequencers1 (concurrently runConnections $ concurrently postTimeoutPrimary1 postTimeoutSecondary)
      ifor_ ctxs1 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, if i == 0 then Just (1 :: Word256) else Just 1000)
      ctxs2 <- fst <$> concurrently (runSequencers2 ctxs1) (concurrently runConnections $ concurrently postTimeoutPrimary2 postTimeoutSecondary)
      ifor_ ctxs2 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1001 :: Maybe Word256)
  
  describe "handleEvents" $ do
    it "should pong a ping" $
      runTestPeer $ do
        runConduit $ yield (MsgEvt Ping) .| handleEvents testPeer .| sinkList `L.shouldReturn` [Right Pong]
    it "should return empty BlockBodies to empty BlockHeaders" $
      runTestPeer $ do
        runConduit $ yield (MsgEvt (BlockHeaders [])) .| handleEvents testPeer .| sinkList
          `L.shouldReturn` [Right $ GetBlockBodies []]
    it "should forward blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
      let addr = blockstanbulSender wm
      in addr /= 0 && addr /= 0xa ==> runTestPeer $ do
        -- Without "proof" of which peer this is, assume it could be addr
        shouldSendToPeer addr `L.shouldReturn` True
        shouldSendToPeer 0xa `L.shouldReturn` True
        runConduit $ yield (MsgEvt (Blockstanbul wm))
                           .| handleEvents testPeer
                           .| sinkList
           `L.shouldReturn` [Left $ ToUnseq [IEBlockstanbul wm]]
        -- Now that the peer is known to be addr, we should only send if they are designated
        shouldSendToPeer addr `L.shouldReturn` True
        shouldSendToPeer 0xa `L.shouldReturn` False

    it "should broadcast blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
      runTestPeer $ do
        runConduit $ yield (NewSeqEvent (P2pBlockstanbul wm))
                      .| handleEvents testPeer
                      .| sinkList
            `L.shouldReturn` [Right $ Blockstanbul wm]
        -- We should not mistake internal messages as the peers
        shouldSendToPeer 0xa `L.shouldReturn` True

    it "should forward a timer to a TXQueue timeout" $ do
      runTestPeer $ do
        runConduit $ yield TimerEvt
                      .| handleEvents testPeer
                      .| sinkList
            `L.shouldReturn` [Left TXQueueTimeout]

  describe "Private Chain Authorization" $ do
    let ip1 = "172.20.44.53"
        ip2 = "33.4.2.1"
        ip3 = "5.9.150.40"
        ip4 = "127.0.0.1"
        key1 = "3414c01c19aa75a34f2dbd2f8d0898dc79d6b219ad77f8155abf1a287ce2ba60f14998a3a98c0cf14915eabfdacf914a92b27a01769de18fa2d049dbf4c17694"
        key2 = "f4642fa65af50cfdea8fa7414a5def7bb7991478b768e296f5e4a54e8b995de102e0ceae2e826f293c481b5325f89be6d207b003382e18a8ecba66fbaf6416c0"
        key3 = "a4de274d3a159e10c2c9a68c326511236381b84c9ec52e72ad732eb0b2b1a2277938f78593cdbe734e6002bf23114d434a085d260514ab336d4acdc312db671b"
        key4 = "a979fb575495b8d6db44f750317d0f4622bf4c2aa3365d6af7c284339968eef29b69ad0dce72a4d8db5ebb4968de0e3bec910127f134779fbcb0cb6d3331163c"
        mkEnode :: String -> String -> Enode
        mkEnode key ip = readEnode $ printf "enode://%s@%s:30303" key ip
        chainMembers = M.fromList
           [ (0xdeadbeef, mkEnode key1 ip1)
           , (0xddba11, mkEnode key2 ip2)
           , (0x888, mkEnode key3 ip3)
           ]

        shouldAccept :: AuthorizationMode -> (String, String) -> IO ()
        shouldAccept mode (key, ip) =
          DataPeer.buildPeer (Just key, ip, 30303) `shouldSatisfy` (\p -> checkPeerIsMember' mode p $ ChainMembers chainMembers)

        shouldReject :: AuthorizationMode -> (String, String) -> IO ()
        shouldReject mode (key, ip) =
          DataPeer.buildPeer (Just key, ip, 30303) `shouldNotSatisfy` (\p -> checkPeerIsMember' mode p $ ChainMembers chainMembers)

    describe "IPOnly" $ do
      it "should reject the wrong ip" $ IPOnly `shouldReject` (key1, ip4)
      it "should accept the right ip with the wrong key" $ IPOnly `shouldAccept` (key4, ip2)

    describe "PubkeyOnly" $ do
      it "should reject the wrong key" $ PubkeyOnly `shouldReject` (key4, ip1)
      it "should accept the right key with the wrong ip" $ PubkeyOnly `shouldAccept` (key2, ip4)

    describe "StrongAuth" $ do
      it "should reject a mismatched ip, key pair" $ StrongAuth `shouldReject` (key3, ip2)
      it "should accept a matching ip, key pair" $ StrongAuth `shouldAccept` (key3, ip3)

    describe "FlexibleAuth" $ do
      it "should reject a wrong ip and wrong key" $ FlexibleAuth `shouldReject` (key4, ip4)
      it "should accept a matching ip" $ FlexibleAuth `shouldAccept` (key4, ip1)
      it "should accept a matching key" $ FlexibleAuth `shouldAccept` (key2, ip4)
