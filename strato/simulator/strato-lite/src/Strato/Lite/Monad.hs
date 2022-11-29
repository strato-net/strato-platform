{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PackageImports        #-}
{-# LANGUAGE QuasiQuotes           #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Strato.Lite.Monad where

import           Prelude hiding (round)
import           Conduit
import           Control.Concurrent.STM.TMChan
import           Control.Lens                          hiding (Context, view)
import qualified Control.Lens                          as Lens
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import qualified Control.Monad.State                   as State
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.Maybe
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue                   hiding (newTQueueIO)
import           Data.Default
import           Data.Foldable                         (for_, toList, traverse_)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import           Data.Maybe                            (fromJust, fromMaybe, isJust)
import qualified Data.NibbleString                     as N
-- import qualified Data.Set                              as Set
import qualified Data.Set.Ordered                      as S
import qualified Data.Sequence                         as Q
import           Data.Text (Text)
import qualified Data.Text                             as T
import           Data.Traversable                      (for)

import           BlockApps.Logging
import           BlockApps.X509.Certificate
import           Blockchain.Bagger.BaggerState
import           Blockchain.Bagger
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.AlternateTransaction  as U
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.BlockDB()
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction           (getSigVals)
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin              as Origin
import qualified Blockchain.Database.MerklePatricia    as MP
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB                 (setStateDBStateRoot)
import qualified Blockchain.DB.X509CertDB              as X509
--import  BlockApps.X509.Certificate           

import qualified "vm-runner" Blockchain.Event          as VMEvent
import           Blockchain.MemVMContext               hiding (getMemContext, get, gets, put, modify, modify', dbsGet, dbsGets, dbsPut, dbsModify, dbsModify', contextGet, contextGets, contextPut, contextModify, contextModify')
import           Blockchain.VMContext                  (IsBlockstanbul(..), ContextBestBlockInfo(..), baggerState, putContextBestBlockInfo)
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
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Wei
import qualified Blockchain.TxRunResultCache           as TRC

import           Debugger                              (DebugSettings)

import           Executable.EthereumVM
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer

import           UnliftIO

data P2PContext = P2PContext
  { _blockHeaders          :: [DataDefs.BlockData]
  , _remainingBlockHeaders :: RemainingBlockHeaders
  , _actionTimestamp       :: ActionTimestamp
  , _peerAddr              :: PeerAddress
  , _outboundPbftMessages  :: S.OSet (Text, Keccak256)
  }
makeLenses ''P2PContext

instance Default P2PContext where
  def = P2PContext []
                   (RemainingBlockHeaders [])
                   emptyActionTimestamp
                   (PeerAddress Nothing)
                   S.empty

data TestContext = TestContext
  { _blocks                :: [Block]
  , _connectionTimeout     :: ConnectionTimeout
  , _maxReturnedHeaders    :: MaxReturnedHeaders
  , _prvKey                :: PrivateKey
  , _shaBlockDataMap       :: Map Keccak256 DataDefs.BlockData
  , _p2pWorldBestBlock     :: WorldBestBlock
  , _bestBlock             :: BestBlock
  , _canonicalBlockDataMap :: Map Integer (Canonical DataDefs.BlockData)
  , _ipAddressIpChainsMap  :: Map IPAddress IPChains
  , _orgIdChainsMap        :: Map OrgId OrgIdChains
  , _shaChainTxsInBlockMap :: Map Keccak256 ChainTxsInBlock
  , _chainMembersMap       :: Map Word256 ChainMemberRSet
  , _chainInfoMap          :: Map Word256 ChainInfo
  , _trueOrgNameChainsMap  :: Map ChainMembers TrueOrgNameChains
  , _falseOrgNameChainsMap :: Map ChainMembers FalseOrgNameChains
  , _x509certMap           :: Map Address X509CertInfoState
  , _privateTxMap          :: Map Keccak256 (Private (Word256, OutputTx))
  , _genesisBlockHash      :: GenesisBlockHash
  , _bestBlockNumber       :: BestBlockNumber
  , _stringPPeerMap        :: Map String DataPeer.PPeer
  , _pbftMessages          :: S.OSet Keccak256
  , _unseqEvents           :: [IngestEvent]
  , _sequencerContext      :: SequencerContext
  , _blockPeriod           :: BlockPeriod
  , _roundPeriod           :: RoundPeriod
  , _vmContext             :: MemContext
  , _apiChainInfoMap       :: Map Word256 ChainInfo
  }

makeLenses ''TestContext

type TestContextM = ReaderT (TVar TestContext) (ResourceT (LoggingT IO))

type MonadTest m = ReaderT (TVar TestContext) m

type MonadP2PTest m = ReaderT (IORef P2PContext) m

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState TestContext (MonadTest m) where
  state f = ask >>= \ctx -> liftIO . atomically $ do
    s <- readTVar ctx
    let (a, s') = f s
    writeTVar ctx s'
    pure a

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState P2PContext (MonadP2PTest m) where
  state f = ask >>= liftIO . flip atomicModifyIORef' (swap . f)
    where swap ~(a,b) = (b,a)

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

instance MonadIO m => A.Selectable ChainMembers TrueOrgNameChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use trueOrgNameChainsMap

instance MonadIO m => A.Selectable ChainMembers FalseOrgNameChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use falseOrgNameChainsMap

instance MonadIO m => A.Selectable Address X509CertInfoState (MonadTest m) where
  select _ a = M.lookup a <$> use x509certMap

instance MonadIO m => A.Selectable Keccak256 ChainTxsInBlock (MonadTest m) where
  select _ sha = M.lookup sha <$> use shaChainTxsInBlockMap

instance MonadIO m => A.Selectable Word256 ChainMemberRSet (MonadTest m) where
  select _ cid = M.lookup cid <$> use chainMembersMap

instance MonadIO m => A.Selectable Word256 ChainInfo (MonadTest m) where
  select _ cid = M.lookup cid <$> use chainInfoMap

instance MonadIO m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (MonadTest m) where
  select _ tx = M.lookup tx <$> use privateTxMap

instance MonadIO m => Mod.Accessible GenesisBlockHash (MonadTest m) where
  access _ = use genesisBlockHash

instance MonadIO m => Mod.Accessible BestBlockNumber (MonadTest m) where
  access _ = use bestBlockNumber

instance MonadIO m => Mod.Modifiable ActionTimestamp (MonadP2PTest m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance MonadIO m => Mod.Accessible ActionTimestamp (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [DataDefs.BlockData] (MonadP2PTest m) where
  get _ = use blockHeaders
  put _ = assign blockHeaders

instance MonadIO m => Mod.Accessible [DataDefs.BlockData] (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @[DataDefs.BlockData])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (MonadP2PTest m) where
  get _ = use remainingBlockHeaders
  put _ = assign remainingBlockHeaders

instance MonadIO m => Mod.Accessible RemainingBlockHeaders (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Accessible MaxReturnedHeaders (MonadTest m) where
  access _ = use maxReturnedHeaders

instance (Monad m, Mod.Accessible MaxReturnedHeaders m) => Mod.Accessible MaxReturnedHeaders (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance MonadIO m => Mod.Modifiable PeerAddress (MonadP2PTest m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance MonadIO m => Mod.Accessible PeerAddress (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance MonadIO m => Mod.Accessible ConnectionTimeout (MonadTest m) where
  access _ = use connectionTimeout

instance MonadIO m => A.Selectable String DataPeer.PPeer (MonadTest m) where
  select _ tx = M.lookup tx <$> use stringPPeerMap

instance (Monad m, Stacks Block m) => Stacks Block (MonadP2PTest m) where
  takeStack a b = lift $ takeStack a b
  pushStack bs  = lift $ pushStack bs

instance (Keccak256 `A.Alters` DataDefs.BlockData) m => (Keccak256 `A.Alters` DataDefs.BlockData) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance (ChainMembers `A.Alters` Word256) m => (ChainMembers `A.Alters` Word256) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance Mod.Modifiable WorldBestBlock m => Mod.Modifiable WorldBestBlock (MonadP2PTest m) where
  get p   = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance Mod.Modifiable BestBlock m => Mod.Modifiable BestBlock (MonadP2PTest m) where
  get p   = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance A.Selectable Integer (Canonical DataDefs.BlockData) m => A.Selectable Integer (Canonical DataDefs.BlockData) (MonadP2PTest m) where
  select p i = lift $ A.select p i

instance A.Selectable IPAddress IPChains m => A.Selectable IPAddress IPChains (MonadP2PTest m) where
  select p ip = lift $ A.select p ip

instance A.Selectable OrgId OrgIdChains m => A.Selectable OrgId OrgIdChains (MonadP2PTest m) where
  select p ip = lift $ A.select p ip

instance A.Selectable Keccak256 ChainTxsInBlock m => A.Selectable Keccak256 ChainTxsInBlock (MonadP2PTest m) where
  select p sha = lift $ A.select p sha

instance A.Selectable Word256 ChainMemberRSet m => A.Selectable Word256 ChainMemberRSet (MonadP2PTest m) where
  select p cid = lift $ A.select p cid

instance A.Selectable Word256 ChainInfo m => A.Selectable Word256 ChainInfo (MonadP2PTest m) where
  select p cid = lift $ A.select p cid

instance A.Selectable Keccak256 (Private (Word256, OutputTx)) m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

instance (Monad m, Mod.Accessible GenesisBlockHash m) => Mod.Accessible GenesisBlockHash (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance (Monad m, Mod.Accessible BestBlockNumber m) => Mod.Accessible BestBlockNumber (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance (Monad m, Mod.Accessible ConnectionTimeout m) => Mod.Accessible ConnectionTimeout (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance A.Selectable String DataPeer.PPeer m => A.Selectable String DataPeer.PPeer (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

instance A.Selectable ChainMembers TrueOrgNameChains m => A.Selectable ChainMembers TrueOrgNameChains (MonadP2PTest m) where
  select p org = lift $ A.select p org

instance A.Selectable ChainMembers FalseOrgNameChains m => A.Selectable ChainMembers FalseOrgNameChains (MonadP2PTest m) where
  select p org = lift $ A.select p org

instance A.Selectable Address X509CertInfoState m => A.Selectable Address X509CertInfoState (MonadP2PTest m) where
  select p addr = lift $ A.select p addr

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

instance (Keccak256 `A.Alters` OutputBlock) m => (Keccak256 `A.Alters` OutputBlock) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

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

instance MonadIO m => (ChainMembers `A.Alters` Word256) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . orgNameChainsRegistry
  insert = genericTestInsert $ sequencerContext . orgNameChainsRegistry
  delete = genericTestDelete $ sequencerContext . orgNameChainsRegistry

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
  access _ = use blockPeriod

instance MonadIO m => Mod.Accessible RoundPeriod (MonadTest m) where
  access _ = use roundPeriod

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

instance MonadIO m => HasVaultProxy (MonadTest m) where
  sign bs = do
    pk <- use prvKey
    return $ signMsg pk bs
  
  getPub = do
    pk <- use prvKey
    return $ derivePublicKey pk
  
  getShared pub = do
    pk <- use prvKey
    return $ deriveSharedKey pk pub

instance HasVaultProxy m => HasVaultProxy (MonadP2PTest m) where
  sign bs = lift $ sign bs
  getPub = lift getPub
  getShared pub = lift $ getShared pub

instance MonadIO m => (Keccak256 `A.Alters` (A.Proxy (Inbound WireMessage))) (MonadTest m) where
  lookup _  k = do
    wms <- use pbftMessages
    pure $ if S.member k wms then Just (A.Proxy @(Inbound WireMessage)) else Nothing
  insert _ k _ = pbftMessages %= (\wms ->
    let s = S.size wms
        wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
     in wms' S.>| k)
  delete _ k = pbftMessages %= S.delete k

instance (Keccak256 `A.Alters` (A.Proxy (Inbound WireMessage))) m => (Keccak256 `A.Alters` (A.Proxy (Inbound WireMessage))) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance MonadIO m => ((Text, Keccak256) `A.Alters` (A.Proxy (Outbound WireMessage))) (MonadP2PTest m) where
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

instance (MonadIO m, MonadLogger m) => (Account `A.Alters` AddressState) (MonadTest m) where
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

instance (MonadIO m, MonadLogger m) => (RawStorageKey `A.Alters` RawStorageValue) (MonadTest m) where
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
  lookup _ k         = fmap API <$> use (apiChainInfoMap . at k)
  delete _ k         = apiChainInfoMap . at k .= Nothing
  insert _ k (API v) = apiChainInfoMap . at k ?= v

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
  insert _ cId (P2P mems) = chainMembersMap . at cId ?= chainMembersToChainMemberRset mems

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
      , _orgNameChainsRegistry = M.empty
      , _chainInfoRegistry   = M.empty
      , _x509certRegistry    = M.empty
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
  , _connectionTimeout     = ConnectionTimeout 60
  , _maxReturnedHeaders    = MaxReturnedHeaders 1000
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
  , _trueOrgNameChainsMap  = M.empty
  , _falseOrgNameChainsMap = M.empty
  , _x509certMap           = M.empty
  , _privateTxMap          = M.empty
  , _genesisBlockHash      = GenesisBlockHash zeroHash
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  , _pbftMessages          = S.empty
  , _unseqEvents           = []
  , _sequencerContext      = seqCtx
  , _blockPeriod           = BlockPeriod 0
  , _roundPeriod           = RoundPeriod 0
  , _vmContext             = vmCtx
  , _apiChainInfoMap       = M.empty
  }

data P2PPeer = P2PPeer
  { _p2pPeerPrivKey        :: PrivateKey
  , _p2pPeerPPeer          :: DataPeer.PPeer
  , _p2pPeerUnseqSource    :: TQueue [SeqLoopEvent]
  , _p2pPeerSeqP2pSource   :: TMChan (Either TxrResult P2pEvent)
  , _p2pPeerSeqVmSource    :: TQueue [VmEvent]
  , _p2pPeerApiIndexSource :: TQueue [IndexEvent]
  , _p2pPeerP2pIndexSource :: TQueue [IndexEvent]
  , _p2pPeerTxrIndexSource :: TQueue IndexEvent
  , _p2pPeerUnseqSink      :: [IngestEvent] -> TestContextM ()
  , _p2pPeerName           :: String
  , _p2pTestContext        :: TVar TestContext
  , _p2pPeerSequencer      :: TestContextM ()
  , _p2pPeerVm             :: TestContextM ()
  , _p2pPeerApiIndexer     :: TestContextM ()
  , _p2pPeerP2pIndexer     :: TestContextM ()
  , _p2pPeerTxrIndexer     :: TestContextM ()
  }
makeLenses ''P2PPeer

runNode :: P2PPeer -> IO ()
runNode p =
  concurrently_
    (concurrently_ (runLoggingT . runResourceT $ flip runReaderT (p ^. p2pTestContext) (p ^. p2pPeerSequencer))
                   (runLoggingT . runResourceT $ flip runReaderT (p ^. p2pTestContext) (p ^. p2pPeerVm)))
    (concurrently_ 
      (concurrently_ (runLoggingT . runResourceT $ flip runReaderT (p ^. p2pTestContext) (p ^. p2pPeerApiIndexer))
                     (runLoggingT . runResourceT $ flip runReaderT (p ^. p2pTestContext) (p ^. p2pPeerP2pIndexer)))
      (runLoggingT . runResourceT $ flip runReaderT (p ^. p2pTestContext) (p ^. p2pPeerTxrIndexer)))

postEvent :: SeqLoopEvent -> P2PPeer -> IO ()
postEvent e p = atomically $ writeTQueue (_p2pPeerUnseqSource p) [e]

postEvents :: [SeqLoopEvent] -> P2PPeer -> IO ()
postEvents es p = atomically $ writeTQueue (_p2pPeerUnseqSource p) es

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Map MP.StateRoot MP.NodeData)) where
  lookup _ k   = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k   = State.modify' $ \(a, b) -> (a, M.delete k b)

createPeer :: PrivateKey
           -> [Address]
           -> ([IngestEvent] -> TestContextM ())
           -> Text
           -> Text
           -> IO P2PPeer
createPeer privKey initialValidators unseqSink name ipAddr = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  txrIndexerSource <- newTQueueIO
  seqCtx <- newSequencerContext $ newBlockstanbulContext (fromPrivateKey privKey) initialValidators
  cache <- TRC.new 64
  let (stateRoot, mpMap) = flip State.execState (MP.emptyTriePtr, M.empty :: Map MP.StateRoot MP.NodeData) $ do
        MP.initializeBlank
        for_ initialValidators $ \addr -> do
          sr <- State.gets fst
          let key = addressAsNibbleString addr
              val = rlpEncode . rlpSerialize . rlpEncode $ blankAddressState{addressStateBalance = 1000000000000000000000000}
          sr' <- MP.putKeyVal sr key val
          State.modify' $ \(_,b) -> (sr',b)
  let cstate = def & txRunResultsCache .~ cache
      vmCtx = MemContext def cstate
      genesisBlock = DataDefs.BlockData
        zeroHash
        zeroHash
        (Address 0)
        stateRoot
        MP.emptyTriePtr
        MP.emptyTriePtr
        ""
        1
        0
        100000000000000000000000000
        1
        DataPeer.jamshidBirth
        ""
        12345
        zeroHash
      genHash = rlpHash genesisBlock
      genesisOutputBlock = OutputBlock
        { obOrigin              = Origin.API
        , obTotalDifficulty     = 0
        , obBlockData           = genesisBlock
        , obReceiptTransactions = []
        , obBlockUncles         = []
        }
  testContextTVar <- newTVarIO $ testContext privKey seqCtx vmCtx
  let sequencer = do
        DBDB.bootstrapGenesisBlock genHash 1
        A.insert (A.Proxy @EmittedBlock) genHash alreadyEmittedBlock
        runConduit $ sourceTQueue unseqSource
                  .| mapMC Seq.runSequencerBatch
                  .| (awaitForever $ \b -> do
                        chainIds <- lift $ unGetChainsDB <$> Mod.get (Mod.Proxy @GetChainsDB)
                        txHashes <- lift $ unGetTransactionsDB <$> Mod.get (Mod.Proxy @GetTransactionsDB)
                        let chainIdsList = toList chainIds
                            txHashesList = toList txHashes
                            getChains = if null chainIdsList then [] else [P2pGetChain chainIdsList]
                            getTxs = if null txHashesList then [] else [P2pGetTx txHashesList]
                            toP2p' = getChains ++ getTxs ++ Seq._toP2p b
                        atomically $ do
                          traverse_ (writeTMChan seqP2pSource . Right) $ toP2p'
                          writeTQueue seqVmSource $ Seq._toVm b
                        lift clearGetChainsDB
                        lift clearGetTransactionsDB
                     )
  let vm = do
        MP.initializeBlank
        setStateDBStateRoot Nothing stateRoot
        writeBlockSummary genesisOutputBlock
        for_ (M.toList mpMap) $ \(k,v) -> A.insert (A.Proxy @MP.NodeData) k v
        (BlockHashRoot bhr) <- bootstrapChainDB genHash [(Nothing, stateRoot)]
        (X509.CertRoot cr) <- X509.bootstrapCertDB genHash
        putContextBestBlockInfo $ ContextBestBlockInfo (genHash, genesisBlock, 0, 0, 0)
        Mod.put (Mod.Proxy @BlockHashRoot) $ BlockHashRoot bhr
        Mod.put (Mod.Proxy @X509.CertRoot) $ X509.CertRoot cr
        processNewBestBlock genHash genesisBlock [] -- bootstrap Bagger with genesis block
        runConduit $ sourceTQueue seqVmSource
                  .| (awaitForever $ yield . foldr VMEvent.insertInBatch VMEvent.newInBatch)
                  .| handleVmEvents False
                  .| (awaitForever $ yield . flip VMEvent.insertOutBatch VMEvent.newOutBatch)
                  .| (awaitForever $ \b -> do
                        $logInfoS (name <> "/vm") . T.pack $ show $ toList (VMEvent.outEvents b)
                        atomically $ do
                          writeTQueue unseqSource $ UnseqEvent . IEBlock . blockToIngestBlock Origin.Quarry . outputBlockToBlock <$> toList (VMEvent.outBlocks b)
                          writeTQueue apiIndexerSource $ toList (VMEvent.outIndexEvents b)
                          writeTQueue p2pIndexerSource $ toList (VMEvent.outIndexEvents b)
                          traverse_ (writeTQueue txrIndexerSource) $ toList (EventDBEntry <$> toList (VMEvent.outEvents b))
                     )
      apiIndexer' = runConduit $ sourceTQueue apiIndexerSource
                              .| (awaitForever $ \evs -> do
                                    $logInfoS (name <> "/testApiIndexer") . T.pack $ show evs
                                    lift $ indexAPI evs)
      p2pIndexer' = runConduit $ sourceTQueue p2pIndexerSource
                              .| (awaitForever $ \evs -> do
                                    $logInfoS (name <> "/testP2pIndexer") . T.pack $ show evs
                                    lift $ indexP2P evs)
      txrIndexer' = runConduit $ sourceTQueue txrIndexerSource
                              .| (awaitForever $ \ev -> do
                                    $logInfoS (name <> "/testTxrIndexer") . T.pack $ show ev
                                    yieldMany $ indexEventToTxrResults ev)
                              .| (awaitForever $ \case
                                    -- AddMember (Right (cId, addr, enode)) -> do
                                    --   chainMembersMap %= (\m -> case M.lookup cId m of
                                    --     Nothing -> M.insert cId (ChainMembers $ M.singleton addr enode) m
                                    --     Just (ChainMembers cm) -> M.insert cId (ChainMembers $ M.insert addr enode cm) m)
                                    --   ipAddressIpChainsMap %= (\m -> case M.lookup (ipAddress enode) m of
                                    --     Nothing -> M.insert (ipAddress enode) (IPChains $ Set.singleton cId) m
                                    --     Just (IPChains s) -> M.insert (ipAddress enode) (IPChains $ Set.insert cId s) m)
                                    --   orgIdChainsMap %= (\m -> case M.lookup (pubKey enode) m of
                                    --     Nothing -> M.insert (pubKey enode) (OrgIdChains $ Set.singleton cId) m
                                    --     Just (OrgIdChains s) -> M.insert (pubKey enode) (OrgIdChains $ Set.insert cId s) m)
                                    --   atomically . writeTQueue unseqSource . (:[]) . UnseqEvent $ IENewChainMember cId addr enode
                                    -- RemoveMember (Right (cId, addr)) -> do
                                    --   mEnode <- join . fmap (M.lookup addr . unChainMembers) <$> use (chainMembersMap . at cId)
                                    --   chainMembersMap . at cId . _Just %= ChainMembers . M.delete addr . unChainMembers
                                    --   for_ mEnode $ \enode -> do
                                    --     ipAddressIpChainsMap . at (ipAddress enode) . _Just %= IPChains . Set.delete cId . unIPChains
                                    --     orgIdChainsMap . at (pubKey enode) . _Just %= OrgIdChains . Set.delete cId . unOrgIdChains
                                    RegisterCertificate _ -> pure () --(Right (addr, certState)) -> pure ()
                                    CertificateRevoked _ -> pure () --(Right addr) -> pure ()
                                    CertificateRegistryInitialized _ -> pure () --(Right ()) -> pure ()
                                    TerminateChain _ -> pure ()
                                    PutLogDB _ -> pure ()
                                    PutEventDB _ -> pure ()
                                    PutTxResult _ -> pure ()
                                    ev -> do
                                      $logInfoS (name <> "/testTxrIndexer") . T.pack $ show ev
                                      pure ()
                                 )
      pubkeystr = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False $ derivePublicKey privKey
      ppeer = DataPeer.buildPeer ( Just pubkeystr
                                 , T.unpack ipAddr
                                 , 30303
                                 )
      unseq ies = do
        atomically . writeTQueue unseqSource $ UnseqEvent <$> ies
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
    (T.unpack name)
    testContextTVar
    sequencer
    vm
    apiIndexer'
    p2pIndexer'
    txrIndexer'

data P2PConnection = P2PConnection
  { _serverToClient :: TQueue B.ByteString
  , _clientToServer :: TQueue B.ByteString
  , _serverP2PPeer  :: P2PPeer
  , _clientP2PPeer  :: P2PPeer
  , _runServer      :: TestContextM (Maybe SomeException)
  , _runClient      :: TestContextM (Maybe SomeException) 
  , _serverException :: TVar (Maybe SomeException)
  , _clientException :: TVar (Maybe SomeException)
  }
makeLenses ''P2PConnection

createConnection :: P2PPeer
                 -> P2PPeer
                 -> IO P2PConnection
createConnection server client = do
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource server
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client
  serverCtx <- newIORef (def :: P2PContext)
  clientCtx <- newIORef (def :: P2PContext)
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let rServer :: MonadP2PTest TestContextM (Maybe SomeException)
      rServer = runEthServerConduit (_p2pPeerPPeer client)
                                    (sourceTQueue clientToServerTQueue)
                                    (sinkTQueue serverToClientTQueue)
                                    (sourceTMChan serverSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                    (lift . _p2pPeerUnseqSink server)
                                    (_p2pPeerName server ++ " -> " ++ _p2pPeerName client)
      rClient :: MonadP2PTest TestContextM (Maybe SomeException)
      rClient = runEthClientConduit (_p2pPeerPPeer server)
                                    (sourceTQueue serverToClientTQueue)
                                    (sinkTQueue clientToServerTQueue)
                                    (sourceTMChan clientSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                    (lift . _p2pPeerUnseqSink client)
                                    (_p2pPeerName client ++ " -> " ++ _p2pPeerName server)
  pure $ P2PConnection
    serverToClientTQueue
    clientToServerTQueue
    server
    client
    (runReaderT rServer serverCtx)
    (runReaderT rClient clientCtx)
    serverExceptionTVar
    clientExceptionTVar

makeValidators :: [PrivateKey] -> [Address]
makeValidators = map fromPrivateKey

mkSignedTx :: PrivateKey -> U.UnsignedTransaction -> Transaction
mkSignedTx privKey utx =
  let Nonce n = U.unsignedTransactionNonce utx
      Gas gl = U.unsignedTransactionGasLimit utx
      cId = unChainId <$> U.unsignedTransactionChainId utx
      Wei gp = U.unsignedTransactionGasPrice utx
      Wei val = U.unsignedTransactionValue utx
      (r', s', v') = getSigVals . signMsg privKey $ U.rlpHash utx
   in if isJust $ U.unsignedTransactionTo utx
        then let Code c = U.unsignedTransactionInitOrData utx
              in MessageTX
                   { transactionNonce    = fromIntegral n
                   , transactionGasPrice = fromIntegral gp
                   , transactionGasLimit = fromIntegral gl
                   , transactionTo       = fromJust $ U.unsignedTransactionTo utx
                   , transactionValue    = fromIntegral val
                   , transactionData     = c
                   , transactionChainId  = cId
                   , transactionR        = fromIntegral r'
                   , transactionS        = fromIntegral s'
                   , transactionV        = v'
                   , transactionMetadata = Just $ M.fromList [("VM","SolidVM")]
                   }
        else ContractCreationTX
                   { transactionNonce    = fromIntegral n
                   , transactionGasPrice = fromIntegral gp
                   , transactionGasLimit = fromIntegral gl
                   , transactionValue    = fromIntegral val
                   , transactionInit     = U.unsignedTransactionInitOrData utx
                   , transactionChainId  = cId
                   , transactionR        = fromIntegral r'
                   , transactionS        = fromIntegral s'
                   , transactionV        = v'
                   , transactionMetadata = Just $ M.fromList [("VM","SolidVM")]
                   }

runConnection :: P2PConnection
              -> IO ()
runConnection connection = do
  let rServer = do
        mEx <- runLoggingT . runResourceT . flip runReaderT (connection ^. serverP2PPeer . p2pTestContext) $ connection ^. runServer
        atomically $ writeTVar (connection ^. serverException) mEx
      rClient = do
        mEx <- runLoggingT . runResourceT . flip runReaderT (connection ^. clientP2PPeer . p2pTestContext) $ connection ^. runClient
        atomically $ writeTVar (connection ^. clientException) mEx
  concurrently_ rServer rClient

data Network = Network
  { _nodes :: Map Text P2PPeer
  , _connections :: Map (Text, Text) P2PConnection
  }
makeLenses ''Network

data ThreadPool = ThreadPool
  { _nodeThreads :: Map Text (Async ())
  , _connectionThreads :: Map (Text, Text) (Async ())
  }
makeLenses ''ThreadPool

data NetworkManager = NetworkManager
  { _threads :: TVar ThreadPool
  , _network :: TVar Network
  , _initialValidators :: [Address]
  }
makeLenses ''NetworkManager

createNode :: Text -> Text -> ReaderT NetworkManager IO P2PPeer
createNode nodeLabel ipAddr = do 
  let unseqSink = (unseqEvents %=) . (++)
  vals <- asks _initialValidators
  pKey <- liftIO $ newPrivateKey
  liftIO $ createPeer pKey vals unseqSink nodeLabel ipAddr

addNode :: Text -> Text -> ReaderT NetworkManager IO Bool
addNode nodeLabel ipAddr = do
  mgr <- ask
  node <- createNode nodeLabel ipAddr
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
    case ( M.lookup serverLabel $ net ^. nodes
         , M.lookup clientLabel $ net ^. nodes
         , M.lookup (serverLabel, clientLabel) $ net ^. connections
         ) of
      (Just server, Just client, Nothing) -> pure $ Just (server, client)
      _ -> pure Nothing
  case mPeers of
    Nothing -> pure False
    Just (server, client) -> liftIO $ do
      connection <- createConnection server client
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

runNetwork :: [(Text, Text)] -> [(Text, Text)] -> IO (Either Text NetworkManager)
runNetwork nodesList connectionsList = do
  let unseqSink = (unseqEvents %=) . (++)
  privKeys <- traverse (const newPrivateKey) nodesList
  let validators' = makeValidators privKeys
  peers <- traverse (\(p,(n,i)) -> createPeer p validators' unseqSink n i) $ zip privKeys nodesList
  let nodesMap = M.fromList $ zip (fst <$> nodesList) peers
  eConnections <- runExceptT . for connectionsList $ \(server, client) -> do
    serverPeer <- maybeToExceptT ("Couldn't find server " <> server) . MaybeT . pure $ M.lookup server nodesMap
    clientPeer <- maybeToExceptT ("Couldn't find client " <> client) . MaybeT . pure $ M.lookup client nodesMap
    liftIO $ createConnection serverPeer clientPeer
  for eConnections $ \connections' -> do
    let connectionsMap = M.fromList $ zip connectionsList connections'
        network' = Network nodesMap connectionsMap
    nodeThreads' <- for nodesMap $ async . runNode
    connectionThreads' <- for connectionsMap $ async . runConnection
    let threadPool = ThreadPool nodeThreads' connectionThreads'
    networkTVar <- newTVarIO network'
    threadsTVar <- newTVarIO threadPool
    pure $ NetworkManager threadsTVar networkTVar validators'
