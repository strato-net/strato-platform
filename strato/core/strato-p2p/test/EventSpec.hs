{-# LANGUAGE FlexibleContexts          #-}
{-# LANGUAGE FlexibleInstances         #-}
{-# LANGUAGE LambdaCase                #-}
{-# LANGUAGE MultiParamTypeClasses     #-}
{-# LANGUAGE OverloadedStrings         #-}
{-# LANGUAGE PackageImports            #-}
{-# LANGUAGE QuasiQuotes               #-}
{-# LANGUAGE Rank2Types                #-}
{-# LANGUAGE RecordWildCards           #-}
{-# LANGUAGE ScopedTypeVariables       #-}
{-# LANGUAGE TemplateHaskell           #-}
{-# LANGUAGE TupleSections             #-}
{-# LANGUAGE TypeApplications          #-}
{-# LANGUAGE TypeOperators             #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module EventSpec where

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
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block hiding (bestBlockNumber)
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB ()
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Enode
import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.Transaction (getSigVals)
import Blockchain.Data.TransactionDef
import qualified Blockchain.Database.MerklePatricia as MP
import qualified "vm-runner" Blockchain.Event as VMEvent
import Blockchain.MemVMContext hiding (contextGet, contextGets, contextModify, contextModify', contextPut, dbsGet, dbsGets, dbsModify, dbsModify', dbsPut, get, getMemContext, gets, modify, modify', put)
import Blockchain.Options ()
import Blockchain.Privacy
import qualified Blockchain.Sequencer as Seq
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Sequencer.DB.GetChainsDB
import Blockchain.Sequencer.DB.GetTransactionsDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer hiding (createPeer)
import Blockchain.Strato.Discovery.UDP
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.IContext (API (..), IndexerException (..), P2P (..))
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Indexer.P2PIndexer
import Blockchain.Strato.Indexer.TxrIndexer
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Wei
import Blockchain.Strato.RedisBlockDB (RedisConnection)
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext (ContextBestBlockInfo (..), GasCap (..), IsBlockstanbul (..), baggerState, lookupX509AddrFromCBHash, putContextBestBlockInfo, vmGasCap)
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import qualified Control.Lens as Lens
import Control.Monad (forever, join, void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Control.Monad.State as State
import Crypto.Types.PubKey.ECC
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.TMChan
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Either.Extra (eitherToMaybe)
import Data.Foldable (for_, toList, traverse_)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromJust, fromMaybe, isJust)
import qualified Data.NibbleString as N
import Data.Ranged
import qualified Data.Sequence as Q
import qualified Data.Set as Set
import qualified Data.Set.Ordered as S
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Traversable (for)
import Debugger (DebugSettings)
import Executable.EthereumDiscovery
import Executable.EthereumVM2
import Executable.StratoP2P
import Executable.StratoP2PClient
import Executable.StratoP2PServer
import Network.Socket
import Test.Hspec
import Text.Read (readMaybe)
import UnliftIO
import Prelude hiding (round)

data VSocket = VSocket
  { _inbound :: TQueue B.ByteString,
    _outbound :: TQueue B.ByteString
  }

makeLenses ''VSocket

newVSocket :: IO VSocket
newVSocket = liftA2 VSocket newTQueueIO newTQueueIO

data Internet = Internet
  { _tcpPorts :: Data.Map.Strict.Map (IPAsText, TCPPort) (TQueue (VSocket, IPAsText)),
    _udpPorts :: Data.Map.Strict.Map (IPAsText, UDPPort) (TQueue (B.ByteString, SockAddr))
  }

makeLenses ''Internet

preAlGoreInternet :: Internet
preAlGoreInternet = Internet M.empty M.empty

data P2PContext = P2PContext
  { _blockHeaders :: [BlockHeader],
    _remainingBlockHeaders :: RemainingBlockHeaders,
    _actionTimestamp :: ActionTimestamp,
    _peerAddr :: PeerAddress,
    _outboundPbftMessages :: S.OSet (Text, Keccak256),
    _unseqSink :: TQueue [SeqLoopEvent]
  }

makeLenses ''P2PContext

instance Default P2PContext where
  def =
    P2PContext
      []
      (RemainingBlockHeaders [])
      emptyActionTimestamp
      (PeerAddress Nothing)
      S.empty
      (error "P2PContext: uninitialized unseqSink")

data TestContext = TestContext
  { _blocks :: [Block],
    _connectionTimeout :: ConnectionTimeout,
    _maxReturnedHeaders :: MaxReturnedHeaders,
    _prvKey :: PrivateKey,
    _shaBlockDataMap :: Data.Map.Strict.Map Keccak256 BlockHeader,
    _p2pWorldBestBlock :: WorldBestBlock,
    _bestBlock :: BestBlock,
    _canonicalBlockDataMap :: Data.Map.Strict.Map Integer (Canonical BlockHeader),
    _ipAddressIpChainsMap :: Data.Map.Strict.Map IPAddress IPChains,
    _orgIdChainsMap :: Data.Map.Strict.Map OrgId OrgIdChains,
    _shaChainTxsInBlockMap :: Data.Map.Strict.Map Keccak256 ChainTxsInBlock,
    _chainMembersMap :: Data.Map.Strict.Map Word256 ChainMemberRSet,
    _chainInfoMap :: Data.Map.Strict.Map Word256 ChainInfo,
    _trueOrgNameChainsMap :: Data.Map.Strict.Map ChainMemberParsedSet TrueOrgNameChains,
    _falseOrgNameChainsMap :: Data.Map.Strict.Map ChainMemberParsedSet FalseOrgNameChains,
    _x509certMap :: Data.Map.Strict.Map Address X509CertInfoState,
    _privateTxMap :: Data.Map.Strict.Map Keccak256 (Private (Word256, OutputTx)),
    _genesisBlockHash :: GenesisBlockHash,
    _bestBlockNumber :: BestBlockNumber,
    _pointPPeerMap :: Data.Map.Strict.Map Point PPeer,
    _pbftMessages :: S.OSet Keccak256,
    _unseqEvents :: [IngestEvent],
    _sequencerContext :: SequencerContext,
    _blockPeriod :: BlockPeriod,
    _roundPeriod :: RoundPeriod,
    _timeoutChan :: TMChan RoundNumber,
    _vmContext :: MemContext,
    _apiChainInfoMap :: Data.Map.Strict.Map Word256 ChainInfo,
    _parsedSetMap :: Data.Map.Strict.Map ChainMemberParsedSet [ChainMemberParsedSet],
    _parsedSetToX509Map :: Data.Map.Strict.Map ChainMemberParsedSet X509CertInfoState
  }

makeLenses ''TestContext

type TestContextM = ReaderT P2PPeer (MemPeerDBM (ResourceT (LoggingT IO)))

type MonadTest m = ReaderT P2PPeer m

type MonadP2PTest m = ReaderT (IORef P2PContext) m

instance Mod.Accessible PublicKey (MonadTest m) where
  access _ = error "pubkey"

instance Mod.Accessible PublicKey (MonadP2PTest m) where
  access _ = error "pubkey"

instance MonadIO m => Mod.Accessible RedisConnection (MonadTest m) where
  access _ = liftIO $ error "should not be called"

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

instance MonadIO m => Stacks Block (MonadTest m) where
  takeStack _ n = take n <$> use blocks
  pushStack bs = do
    let maxNum = maximum $ number . blockBlockData <$> bs
    bestBlockNumber %= (\(BestBlockNumber n) -> BestBlockNumber $ max maxNum n)
    blocks %= (bs ++)

instance MonadIO m => (Keccak256 `A.Alters` BlockHeader) (MonadTest m) where
  lookup _ k = M.lookup k <$> use shaBlockDataMap
  insert _ k v = shaBlockDataMap %= M.insert k v
  delete _ k = shaBlockDataMap %= M.delete k

instance MonadIO m => Mod.Modifiable WorldBestBlock (MonadTest m) where
  get _ = use p2pWorldBestBlock
  put _ = assign p2pWorldBestBlock

instance MonadIO m => Mod.Modifiable BestBlock (MonadTest m) where
  get _ = use bestBlock
  put _ = assign bestBlock

instance MonadIO m => A.Selectable Integer (Canonical BlockHeader) (MonadTest m) where
  select _ i = M.lookup i <$> use canonicalBlockDataMap

instance MonadIO m => A.Selectable IPAddress IPChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use ipAddressIpChainsMap

instance MonadIO m => A.Selectable OrgId OrgIdChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use orgIdChainsMap

instance (MonadIO m, MonadLogger m) => A.Selectable ChainMemberParsedSet TrueOrgNameChains (MonadTest m) where
  select _ ip = use $ trueOrgNameChainsMap . at ip
  selectWithDefault p ip = fromMaybe (TrueOrgNameChains Set.empty) <$> A.select p ip

instance MonadIO m => A.Selectable ChainMemberParsedSet FalseOrgNameChains (MonadTest m) where
  select _ ip = use $ falseOrgNameChainsMap . at ip
  selectWithDefault p ip = fromMaybe (FalseOrgNameChains Set.empty) <$> A.select p ip

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

instance Show TrueOrgNameChains where
  show (TrueOrgNameChains unchain) = show unchain

instance MonadIO m => Mod.Modifiable ActionTimestamp (MonadP2PTest m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance MonadIO m => Mod.Accessible ActionTimestamp (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [BlockHeader] (MonadP2PTest m) where
  get _ = use blockHeaders
  put _ = assign blockHeaders

instance MonadIO m => Mod.Accessible [BlockHeader] (MonadP2PTest m) where
  access _ = Mod.get (Mod.Proxy @[BlockHeader])

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

instance HasMemPeerDB m => A.Selectable String PPeer (MonadTest m) where
  select = A.lookup

instance (HasMemPeerDB m, State.MonadState TestContext m) => (String `A.Alters` PPeer) m where
  lookup _ ip = do
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ M.lookup ip peerMap
  insert _ ip p = do
    peerMapIORef <- fmap stringPPeerMap accessEnv
    peerMap <- readIORef peerMapIORef
    let mPeer = M.lookup ip peerMap
    case mPeer of
      Nothing -> do
        modifyIORef peerMapIORef $ M.insert ip p
        case pPeerPubkey p of
          Nothing -> pure $ ()
          Just k -> pointPPeerMap . at k ?= p
      Just oldPeer -> do
        modifyIORef peerMapIORef $ at ip ?~ oldPeer {pPeerPubkey = pPeerPubkey p}
        case pPeerPubkey p of
          Nothing -> pure $ ()
          Just k -> pointPPeerMap . at k ?= oldPeer {pPeerPubkey = pPeerPubkey p}
  delete _ ip = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ M.delete ip

instance MonadIO m => (Point `A.Alters` PPeer) (MonadTest m) where
  lookup _ p = use $ pointPPeerMap . at p
  insert _ _ _ = error "This should not be called."
  delete _ _ = error "This should not be called."

instance (MonadIO m, (Point `A.Alters` PPeer) m) => (Point `A.Alters` PPeer) (MonadP2PTest m) where
  lookup p point = lift $ A.lookup p point
  insert p point = lift . A.insert p point
  delete p point = lift $ A.delete p point

instance (MonadIO m, (Point `A.Alters` PPeer) m) => A.Selectable Point PPeer (MonadP2PTest m) where
  select = A.lookup

instance (Monad m, Stacks Block m) => Stacks Block (MonadP2PTest m) where
  takeStack a b = lift $ takeStack a b
  pushStack bs = lift $ pushStack bs

instance (Keccak256 `A.Alters` BlockHeader) m => (Keccak256 `A.Alters` BlockHeader) (MonadP2PTest m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance (ChainMembers `A.Alters` Word256) m => (ChainMembers `A.Alters` Word256) (MonadP2PTest m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

instance Mod.Modifiable WorldBestBlock m => Mod.Modifiable WorldBestBlock (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance Mod.Modifiable BestBlock m => Mod.Modifiable BestBlock (MonadP2PTest m) where
  get p = lift $ Mod.get p
  put p k = lift $ Mod.put p k

instance A.Selectable Integer (Canonical BlockHeader) m => A.Selectable Integer (Canonical BlockHeader) (MonadP2PTest m) where
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

instance A.Selectable String PPeer m => A.Selectable String PPeer (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

instance A.Selectable ChainMemberParsedSet TrueOrgNameChains m => A.Selectable ChainMemberParsedSet TrueOrgNameChains (MonadP2PTest m) where
  select p org = lift $ A.select p org

instance A.Selectable ChainMemberParsedSet FalseOrgNameChains m => A.Selectable ChainMemberParsedSet FalseOrgNameChains (MonadP2PTest m) where
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

genericTestLookup ::
  (State.MonadState s m, Ord k) =>
  Lens' s (Data.Map.Strict.Map k (Modification a)) ->
  Mod.Proxy a ->
  k ->
  m (Maybe a)
genericTestLookup registry _ k =
  use (registry . at k) >>= \case
    Just (Modification a) -> pure $ Just a
    _ -> pure Nothing

genericTestInsert ::
  (State.MonadState s m, Ord k) =>
  Lens' s (Data.Map.Strict.Map k (Modification a)) ->
  Mod.Proxy a ->
  k ->
  a ->
  m ()
genericTestInsert registry _ k a = registry . at k ?= Modification a

genericTestDelete ::
  (State.MonadState s m, Ord k) =>
  Lens' s (Data.Map.Strict.Map k (Modification a)) ->
  Mod.Proxy a ->
  k ->
  m ()
genericTestDelete registry _ k = registry . at k ?= Deletion

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . blockHashRegistry
  insert = genericTestInsert $ sequencerContext . blockHashRegistry
  delete = genericTestDelete $ sequencerContext . blockHashRegistry

instance (Keccak256 `A.Alters` OutputBlock) m => (Keccak256 `A.Alters` OutputBlock) (MonadP2PTest m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

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

instance MonadIO m => (Address `A.Alters` X509CertInfoState) (MonadTest m) where
  lookup = genericTestLookup $ sequencerContext . x509certInfoState
  insert = genericTestInsert $ sequencerContext . x509certInfoState
  delete = genericTestDelete $ sequencerContext . x509certInfoState

instance MonadIO m => A.Selectable Address X509CertInfoState (MonadTest m) where
  select = A.lookup

instance MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (MonadTest m) where
  lookup _ k = use $ sequencerContext . dbeRegistry . at k
  insert _ k v = sequencerContext . dbeRegistry . at k ?= v
  delete _ k = sequencerContext . dbeRegistry . at k .= Nothing

instance MonadIO m => A.Selectable Word256 ParentChainIds (MonadTest m) where
  select _ cId = join . fmap (fmap (ParentChainIds . parentChains . chainInfo) . _chainIdInfo) <$> A.lookup (A.Proxy @ChainIdEntry) cId

instance MonadIO m => Mod.Modifiable SeenTransactionDB (MonadTest m) where
  get _ = use $ sequencerContext . seenTransactionDB
  put _ = assign $ sequencerContext . seenTransactionDB

instance MonadIO m => Mod.Accessible (IORef RoundNumber) (MonadTest m) where
  access _ = use $ sequencerContext . latestRoundNumber

instance MonadIO m => Mod.Accessible (TMChan RoundNumber) (MonadTest m) where
  access _ = use timeoutChan

instance MonadIO m => Mod.Accessible BlockPeriod (MonadTest m) where
  access _ = use blockPeriod

instance MonadIO m => Mod.Accessible RoundPeriod (MonadTest m) where
  access _ = use roundPeriod

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

instance HasVault m => HasVault (MonadP2PTest m) where
  sign bs = lift $ sign bs
  getPub = lift getPub
  getShared pub = lift $ getShared pub

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

instance MonadIO m => Mod.Accessible MemContext (MonadTest m) where
  access _ = getMemContext

instance MonadIO m => Mod.Modifiable (Maybe DebugSettings) (MonadTest m) where
  get _ = gets $ Lens.view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance MonadIO m => Mod.Modifiable GasCap (MonadTest m) where
  get _ = GasCap <$> gets (Lens.view vmGasCap)
  put _ (GasCap g) = modify $ vmGasCap .~ g

instance MonadIO m => Mod.Accessible ContextState (MonadTest m) where
  access _ = get

instance MonadIO m => Mod.Accessible MemDBs (MonadTest m) where
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

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MonadTest m) where
  lookup _ sr = dbsGets $ Lens.view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance (MonadIO m, MonadLogger m) => (Account `A.Alters` AddressState) (MonadTest m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MonadIO m, MonadLogger m) => A.Selectable Account AddressState (MonadTest m) where
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

instance (MonadIO m, MonadLogger m) => (Address `A.Selectable` X509.X509Certificate) (MonadTest m) where
  select _ k = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (eitherToMaybe . bsToCert) <$> A.lookup (A.Proxy) (certKey certAddress "certificateString")

instance (MonadIO m, MonadLogger m) => ((Address, T.Text) `A.Selectable` X509.X509CertificateField) (MonadTest m) where
  select _ (k, t) = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8
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

instance MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MonadTest m) where
  access _ = dbsGets $ Lens.view worldBestBlock

instance MonadIO m => Mod.Accessible IsBlockstanbul (MonadTest m) where
  access _ = IsBlockstanbul <$> contextGets _hasBlockstanbul

instance MonadIO m => Mod.Modifiable BaggerState (MonadTest m) where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance MonadIO m => Mod.Accessible TRC.Cache (MonadTest m) where
  access _ = contextGets _txRunResultsCache

instance MonadIO m => (MonadTest m) `Mod.Yields` DataDefs.TransactionResult where
  yield = const (pure ())

instance MonadIO m => (Keccak256 `A.Alters` API OutputTx) (MonadTest m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Word256 `A.Alters` API ChainInfo) (MonadTest m) where
  lookup _ k = fmap API <$> use (apiChainInfoMap . at k)
  delete _ k = apiChainInfoMap . at k .= Nothing
  insert _ k (API v) = apiChainInfoMap . at k ?= v

instance MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (MonadTest m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (([ChainMemberParsedSet], [ChainMemberParsedSet]) `A.Alters` API (A.Proxy DataDefs.ValidatorRef)) (MonadTest m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "Private (Word256, OutputTx)"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "Private (Word256, OutputTx)"
  insert _ k (P2P v) = privateTxMap . at k ?= v

instance MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "OutputBlock"
  insert _ _ (P2P OutputBlock {..}) = canonicalBlockDataMap . at (number obBlockData) ?= Canonical obBlockData

instance MonadIO m => Mod.Modifiable (P2P BestBlock) (MonadTest m) where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P bb) = bestBlock .= bb

instance MonadIO m => (Word256 `A.Alters` P2P ChainInfo) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainInfo"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Word256" "ChainInfo"
  insert _ cId (P2P cInfo) = chainInfoMap . at cId ?= cInfo

instance MonadIO m => (Word256 `A.Alters` P2P ChainMembers) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainMembers"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Word256" "ChainMembers"
  insert _ cId (P2P mems) = chainMembersMap . at cId ?= chainMembersToChainMemberRset mems

instance MonadIO m => (ChainMemberParsedSet `A.Alters` P2P (A.Proxy ChainMemberParsedSet)) (MonadTest m) where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainMembers"
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance MonadIO m => (MonadTest m) `Mod.Outputs` [IngestEvent] where
  output ies = unseqEvents %= (++ ies)

instance (MonadIO m, m `Mod.Outputs` [IngestEvent]) => (MonadP2PTest m) `Mod.Outputs` [IngestEvent] where
  output ies = do
    uSink <- use unseqSink
    atomically . writeTQueue uSink $ UnseqEvent <$> ies
    lift $ Mod.output ies

instance (HasMemPeerDB m, (String `A.Alters` PPeer) m, State.MonadState TestContext m) => A.Selectable IPAsText PPeer (MonadP2PTest m) where
  select = A.lookup

instance (HasMemPeerDB m, (String `A.Alters` PPeer) m, State.MonadState TestContext m) => A.Replaceable IPAsText PPeer (MonadP2PTest m) where
  replace = A.insert

instance (HasMemPeerDB m, (String `A.Alters` PPeer) m, State.MonadState TestContext m) => (IPAsText `A.Alters` PPeer) (MonadP2PTest m) where
  lookup _ (IPAsText ip) = A.lookup (A.Proxy @PPeer) $ T.unpack ip
  insert _ (IPAsText ip) p = A.insert (A.Proxy @PPeer) (T.unpack ip) p
  delete _ (IPAsText ip) = A.delete (A.Proxy @PPeer) $ T.unpack ip

instance (MonadIO m, MonadLogger m, MonadReader P2PPeer m) => RunsClient (MonadP2PTest m) where
  runClientConnection ipAsText@(IPAsText ip) tcpPort@(TCPPort p) sSource f = do
    inet <- lift $ asks _p2pPeerInternet
    mSock <- M.lookup (ipAsText, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runClientConnection" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> do
        myIP <- lift $ asks _p2pMyIPAddress
        i <- liftIO $ newTQueueIO
        o <- liftIO $ newTQueueIO
        let pSource = sourceTQueue o
            pSink = sinkTQueue i
            v = VSocket i o
        atomically $ writeTQueue s (v, myIP)
        f $ P2pConduits pSource pSink sSource

instance (MonadUnliftIO m, MonadLogger m, MonadReader P2PPeer m) => RunsServer (MonadP2PTest m) (LoggingT IO) where
  runServer tcpPort@(TCPPort p) runner f = runner $ \sSource -> do
    inet <- lift $ asks _p2pPeerInternet
    myIP@(IPAsText ip) <- lift $ asks _p2pMyIPAddress
    mSock <- liftIO $ M.lookup (myIP, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runServer" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> forever $ do
        (VSocket i o, otherIP) <- atomically $ readTQueue s
        let pSource = sourceTQueue i
            pSink = sinkTQueue o
        void . async $ f (P2pConduits pSource pSink sSource) otherIP

instance Monad m => Mod.Accessible TCPPort (MonadP2PTest m) where
  access _ = pure $ TCPPort 30303

instance Monad m => Mod.Accessible UDPPort (MonadP2PTest m) where
  access _ = pure $ UDPPort 30303

sockAddrToIpAndPort :: SockAddr -> Maybe (IPAsText, UDPPort)
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
        ip = IPAsText $ T.pack ipStr
        udpPort = UDPPort $ fromIntegral port
     in Just (ip, udpPort)
sockAddrToIpAndPort _ = Nothing

ipAndPortToSockAddr :: IPAsText -> UDPPort -> Maybe SockAddr
ipAndPortToSockAddr (IPAsText ip) (UDPPort port) =
  case traverse readMaybe (T.unpack <$> T.splitOn "." ip) of
    Just [(a :: Int), b, c, d] ->
      let addr =
            (fromIntegral a)
              .|. (fromIntegral b `shiftL` 8)
              .|. (fromIntegral c `shiftL` 16)
              .|. (fromIntegral d `shiftL` 24)
       in Just $ SockAddrInet (fromIntegral port) addr
    _ -> Nothing

instance MonadReader P2PPeer m => A.Selectable (Maybe IPAsText, UDPPort) SockAddr (MonadP2PTest m) where
  select _ (Just ip, udpPort) = pure $ ipAndPortToSockAddr ip udpPort
  select _ (Nothing, udpPort) = do
    myIP <- lift $ asks _p2pMyIPAddress
    pure $ ipAndPortToSockAddr myIP udpPort

------------------------- Extra stuff for HasPeerDB??

instance (MonadIO m, HasMemPeerDB m) => A.Replaceable (IPAsText, Point) PeerBondingState (MonadTest m) where
  replace _ (IPAsText ip, point) (PeerBondingState s) = do
    lift $ A.replace Mod.Proxy (IPAsText ip, undefined :: TCPPort) (PeerBondingState s)  -- the instances for TCPPort and UDPPort just ignore the parameter and do the same thing
    pointPPeerMap . at point . _Just %= (\p -> p {pPeerBondState = s})

instance (Monad m, A.Replaceable (IPAsText, Point) PeerBondingState m) => A.Replaceable (IPAsText, Point) PeerBondingState (MonadP2PTest m) where
  replace p k = lift . A.replace p k

instance (MonadIO m, HasMemPeerDB m) => A.Selectable (IPAsText, Point) PeerBondingState (MonadTest m) where
  select _ (IPAsText t, _) = do
    let ip = T.unpack t
    map' <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ PeerBondingState . pPeerBondState <$> map' M.!? ip

instance (A.Selectable (IPAsText, Point) PeerBondingState m) => A.Selectable (IPAsText, Point) PeerBondingState (MonadP2PTest m) where
  select p = lift . A.select p

instance MonadIO m => Mod.Accessible ValidatorAddresses (MonadTest m) where
  access _ = do
    seqCtxt <- use sequencerContext
    let mBlockstanbulCtxt = seqCtxt  ^. blockstanbulContext
        valCMPSs = maybe [] (Set.toList . unChainMembers ._validators) mBlockstanbulCtxt
    cmpsToX509 <- use parsedSetToX509Map
    let valAdds = catMaybes $ (\valCMPS -> userAddress <$> cmpsToX509 M.!? valCMPS) <$> valCMPSs
    return $ ValidatorAddresses valAdds

instance (Monad m, Mod.Accessible ValidatorAddresses m) => Mod.Accessible ValidatorAddresses (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => A.Selectable Point ClosestPeers (MonadTest m) where
  select _ point = Just . ClosestPeers . filter f . M.elems <$> use pointPPeerMap
    where
      f p = pPeerPubkey p /= Just point && pPeerPubkey p /= Nothing

instance A.Selectable Point ClosestPeers m => A.Selectable Point ClosestPeers (MonadP2PTest m) where
  select p = lift . A.select p

-------- END extra stuff for HasPeerDB??

instance
  ( MonadIO m,
    MonadLogger m,
    MonadReader P2PPeer m
  ) =>
  A.Replaceable SockAddr B.ByteString (MonadP2PTest m)
  where
  replace _ addr msg = case sockAddrToIpAndPort addr of
    Nothing -> $logErrorS "Replaceable SockAddr BS" $ "Could not decode " <> T.pack (show addr)
    Just (ip@(IPAsText ipText), udpPort@(UDPPort port')) -> do
      inet <- lift $ asks _p2pPeerInternet
      mSock <- liftIO $ M.lookup (ip, udpPort) . _udpPorts <$> readTVarIO inet
      case mSock of
        Nothing -> $logErrorS "runServer" $ "No socket exists for " <> ipText <> ":" <> T.pack (show port')
        Just s -> do
          ip' <- lift $ asks _p2pMyIPAddress
          case ipAndPortToSockAddr ip' (UDPPort 30303) of
            Nothing -> pure ()
            Just myAddr -> atomically $ writeTQueue s (msg, myAddr)

instance
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

instance
  ( MonadUnliftIO m,
    MonadLogger m,
    MonadReader P2PPeer m
  ) =>
  A.Selectable (IPAsText, UDPPort, B.ByteString) Point (MonadP2PTest m)
  where
  select _ (ip@(IPAsText ip'), port@(UDPPort p), bs) = do
    inet <- lift $ asks _p2pPeerInternet
    mSock <- M.lookup (ip, port) . _udpPorts <$> readTVarIO inet
    myIP@(IPAsText myip) <- lift $ asks _p2pMyIPAddress
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

instance MonadIO m => (ChainMemberParsedSet `A.Selectable` [ChainMemberParsedSet]) (MonadTest m) where
  select _ cm = do
    db <- use parsedSetMap
    case cm of
      CommonName _ _ _ _ -> do
        pure $ Just [cm]
      OrgUnit _ _ _ -> do
        let mems = fromMaybe [] $ M.lookup cm db
        pure $ Just mems
      Org _ _ -> do
        let units = fromMaybe [] $ M.lookup cm db
            mems = concat $ catMaybes $ map (flip M.lookup db) units
        pure $ Just mems
      Everyone _ ->
        pure $ Nothing

instance (ChainMemberParsedSet `A.Selectable` [ChainMemberParsedSet]) m => (ChainMemberParsedSet `A.Selectable` [ChainMemberParsedSet]) (MonadP2PTest m) where
  select p cm = lift $ A.select p cm

instance MonadIO m => (ChainMemberParsedSet `A.Selectable` IsValidator) (MonadTest m) where
  select _ _ = pure . Just $ IsValidator False

instance (ChainMemberParsedSet `A.Selectable` IsValidator) m => (ChainMemberParsedSet `A.Selectable` IsValidator) (MonadP2PTest m) where
  select p cm = lift $ A.select p cm

instance MonadIO m => (ChainMemberParsedSet `A.Selectable` X509CertInfoState) (MonadTest m) where
  select _ cm = M.lookup cm <$> use parsedSetToX509Map

instance (ChainMemberParsedSet `A.Selectable` X509CertInfoState) m => (ChainMemberParsedSet `A.Selectable` X509CertInfoState) (MonadP2PTest m) where
  select p cm = lift $ A.select p cm

startingCheckpoint :: [ChainMemberParsedSet] -> Checkpoint
startingCheckpoint as = def {checkpointValidators = as}

newBlockstanbulContext :: ChainMemberParsedSet -> [ChainMemberParsedSet] -> BlockstanbulContext
newBlockstanbulContext chainm as =
  let ckpt = startingCheckpoint as
   in newContext ckpt Nothing True (Just chainm)

emptyBlockstanbulContext :: BlockstanbulContext
emptyBlockstanbulContext = newBlockstanbulContext emptyChainMember []

newSequencerContext :: MonadIO m => BlockstanbulContext -> m SequencerContext
newSequencerContext bc = do
  -- loopCh <- atomically newTMChan
  latestRound <- newIORef 0
  pure $ SequencerContext
      { _dependentBlockDB    = error " Evaluating dependentBlockDB"
      , _seenTransactionDB   = mkSeenTxDB 1024
      , _dbeRegistry         = M.empty
      , _blockHashRegistry   = M.empty
      , _emittedBlockRegistry = M.singleton zeroHash $ Modification alreadyEmittedBlock
      , _txHashRegistry      = M.empty
      , _chainHashRegistry   = M.empty
      , _chainIdRegistry     = M.empty
      , _chainInfoRegistry   = M.empty
      , _x509certInfoState   = M.empty
      , _getChainsDB         = emptyGetChainsDB
      , _getTransactionsDB   = emptyGetTransactionsDB
      , _ldbBatchOps         = Q.empty
      , _blockstanbulContext = Just bc
      , _loopTimeout         = error "MonadTest: Evaluating loopTimeout" -- loopCh
      , _latestRoundNumber   = latestRound
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
    { _blocks = [],
      _connectionTimeout = ConnectionTimeout 60,
      _maxReturnedHeaders = MaxReturnedHeaders 1000,
      _prvKey = prv,
      _shaBlockDataMap = M.empty,
      _p2pWorldBestBlock = WorldBestBlock (BestBlock zeroHash (-1) 0),
      _bestBlock = BestBlock zeroHash (-1) 0,
      _canonicalBlockDataMap = M.empty,
      _ipAddressIpChainsMap = M.empty,
      _orgIdChainsMap = M.empty,
      _shaChainTxsInBlockMap = M.empty,
      _chainMembersMap = M.empty,
      _chainInfoMap = M.empty,
      _trueOrgNameChainsMap = M.empty,
      _falseOrgNameChainsMap = M.empty,
      _x509certMap = M.empty,
      _privateTxMap = M.empty,
      _genesisBlockHash = GenesisBlockHash zeroHash,
      _bestBlockNumber = BestBlockNumber 0,
      _pointPPeerMap = M.empty,
      _pbftMessages = S.empty,
      _unseqEvents = [],
      _sequencerContext = seqCtx,
      _blockPeriod = BlockPeriod 1,
      _roundPeriod = RoundPeriod 10,
      _timeoutChan = rNum,
      _vmContext = vmCtx,
      _apiChainInfoMap = M.empty,
      _parsedSetMap = M.empty,
      _parsedSetToX509Map = M.empty
    }

data P2PPeer = P2PPeer
  { _p2pPeerPrivKey :: PrivateKey,
    _p2pPeerPPeer :: PPeer,
    _p2pPeerUnseqSource :: TQueue [SeqLoopEvent],
    _p2pPeerSeqP2pSource :: TMChan (Either TxrResult P2pEvent),
    _p2pPeerSeqVmSource :: TQueue [VmEvent],
    _p2pPeerApiIndexSource :: TQueue [IndexEvent],
    _p2pPeerP2pIndexSource :: TQueue [IndexEvent],
    _p2pPeerTxrIndexSource :: TQueue IndexEvent,
    _p2pPeerUnseqSink :: [IngestEvent] -> TestContextM (),
    _p2pPeerName :: String,
    _p2pTestContext :: TVar TestContext,
    _p2pPeerDB :: MemPeerDBEnv,
    _p2pPeerInternet :: TVar Internet,
    _p2pMyIPAddress :: IPAsText,
    _p2pMyUDPSocket :: TQueue (B.ByteString, SockAddr),
    _p2pPeerSeqTimerSource :: TestContextM (),
    _p2pPeerSequencer :: TestContextM (),
    _p2pPeerVm :: TestContextM (),
    _p2pPeerApiIndexer :: TestContextM (),
    _p2pPeerP2pIndexer :: TestContextM (),
    _p2pPeerTxrIndexer :: TestContextM ()
  }

makeLenses ''P2PPeer

runMonad :: MonadUnliftIO m =>
            P2PPeer -> ReaderT P2PPeer (ReaderT MemPeerDBEnv (ResourceT (LoggingT m))) a -> m a
runMonad p = runNoLoggingT . runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p

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
        (runMonad p (p ^. p2pPeerTxrIndexer))
    )

runNode :: P2PPeer -> IO ()
runNode p = do
  chan <- atomically . dupTMChan $ p ^. p2pPeerSeqP2pSource
  let s = sourceTMChan chan .| (awaitForever $ either (const $ pure ()) yield)
  ctx <- newIORef $ def & unseqSink .~ p ^. p2pPeerUnseqSource
  concurrently_
    (runNodeWithoutP2P p)
    ( concurrently_
        (runNoLoggingT $ stratoP2P (\f -> runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p $ runReaderT (f s) ctx))
        (runNoLoggingT $ ethereumDiscovery (\f -> runResourceT . runMemPeerDBMUsingEnv (p^.p2pPeerDB) . flip runReaderT p $ runReaderT (f 100) ctx))
    )

postEvent :: SeqLoopEvent -> P2PPeer -> IO ()
postEvent e p = atomically $ writeTQueue (_p2pPeerUnseqSource p) [e]

postEvents :: [SeqLoopEvent] -> P2PPeer -> IO ()
postEvents es p = atomically $ writeTQueue (_p2pPeerUnseqSource p) es

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Data.Map.Strict.Map MP.StateRoot MP.NodeData)) where
  lookup _ k = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k = State.modify' $ \(a, b) -> (a, M.delete k b)

type CertMap = Data.Map.Strict.Map Address (Modification X509CertInfoState)

addValidatorsToCertMap :: [(Address, ChainMemberParsedSet)] -> CertMap -> CertMap
addValidatorsToCertMap vals m =
  let cmpsToXcis a (CommonName o u n True) = X509CertInfoState a rootCert True [] (T.unpack o) (Just $ T.unpack u) (T.unpack n)
      cmpsToXcis _ _ = error "cmpsToXcis"
      insertValidatorInfo (a, b) = M.insert a (Modification (cmpsToXcis a b))
   in foldr insertValidatorInfo m vals

createPeer ::
  PrivateKey ->
  ChainMemberParsedSet ->
  [(Address, ChainMemberParsedSet)] ->
  TVar Internet ->
  Text ->
  IPAsText ->
  TCPPort ->
  UDPPort ->
  [IPAsText] ->
  IO P2PPeer
createPeer privKey selfId initialValidators' inet name ipAsText@(IPAsText ipAddr) tcpPort udpPort bootNodes = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  txrIndexerSource <- newTQueueIO
  cht <- atomically newTMChan
  tcpVSock <- newTQueueIO
  udpVSock <- newTQueueIO
  atomically $ do
    modifyTVar inet $ tcpPorts . at (ipAsText, tcpPort) ?~ tcpVSock
    modifyTVar inet $ udpPorts . at (ipAsText, udpPort) ?~ udpVSock
  seqCtx' <- newSequencerContext $ newBlockstanbulContext selfId (snd <$> initialValidators')
  let seqCtx = (x509certInfoState %~ addValidatorsToCertMap initialValidators') seqCtx'
      initialValidators = fst <$> initialValidators'
  cache <- TRC.new 64
  let (stateRoot, mpMap) = flip State.execState (MP.emptyTriePtr, M.empty :: Data.Map.Strict.Map MP.StateRoot MP.NodeData) $ do
        MP.initializeBlank
        for_ initialValidators $ \addr -> do
          sr <- State.gets fst
          let key = addressAsNibbleString addr
              val = rlpEncode . rlpSerialize . rlpEncode $ blankAddressState {addressStateBalance = 1000000000000000000000000}
          sr' <- MP.putKeyVal sr key val
          State.modify' $ \(_, b) -> (sr', b)
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
            obTotalDifficulty = 0,
            obBlockData = genesisBlock,
            obReceiptTransactions = [],
            obBlockUncles = []
          }
  testContextTVar <- newTVarIO $ testContext privKey cht seqCtx vmCtx
  let seqTimerSource = runConduit $ sourceTMChan cht .| mapC ((: []) . TimerFire) .| sinkTQueue unseqSource
  let sequencer = do
        DBDB.bootstrapGenesisBlock genHash 1
        A.insert (A.Proxy @EmittedBlock) genHash alreadyEmittedBlock
        atomically $ writeTQueue seqVmSource [VmCreateBlockCommand]
        createFirstTimer
        runConduit $
          sourceTQueue unseqSource
            .| mapMC Seq.runSequencerBatch
            .| ( awaitForever $ \b -> do
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
        for_ (M.toList mpMap) $ \(k, v) -> A.insert (A.Proxy @MP.NodeData) k v
        (BlockHashRoot bhr) <- bootstrapChainDB genHash [(Nothing, stateRoot)]
        putContextBestBlockInfo $ ContextBestBlockInfo genHash genesisBlock 0 0 0
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
                     writeTQueue unseqSource $ UnseqEvent . IEBlock . blockToIngestBlock Origin.Quarry . outputBlockToBlock <$> toList (VMEvent.outBlocks b)
                     writeTQueue apiIndexerSource $ toList (VMEvent.outIndexEvents b)
                     writeTQueue p2pIndexerSource $ toList (VMEvent.outIndexEvents b)
                     traverse_ (writeTQueue txrIndexerSource) $ toList (EventDBEntry <$> toList (VMEvent.outEvents b))
               )
      apiIndexer' =
        runConduit $
          sourceTQueue apiIndexerSource
            .| ( awaitForever $ \evs -> do
                   $logInfoS (name <> "/testApiIndexer") . T.pack $ show evs
                   lift $ indexAPI evs
               )
      p2pIndexer' =
        runConduit $
          sourceTQueue p2pIndexerSource
            .| ( awaitForever $ \evs -> do
                   $logInfoS (name <> "/testP2pIndexer") . T.pack $ show evs
                   lift $ indexP2P evs
               )
      txrIndexer' =
        runConduit $
          sourceTQueue txrIndexerSource
            .| ( awaitForever $ \ev -> do
                   $logInfoS (name <> "/testTxrIndexer") . T.pack $ show ev
                   yieldMany $ indexEventToTxrResults ev
               )
            .| ( awaitForever $ \case
                   AddOrgName chainId cm -> do
                     let org = ChainMembers $ Set.singleton cm
                         newMemRset@(ChainMemberRSet newMem) = chainMembersToChainMemberRset org
                     chainMembersMap . at chainId %= \case
                       Nothing -> Just newMemRset
                       Just (ChainMemberRSet rset') -> Just . ChainMemberRSet $ rSetUnion rset' newMem
                     trueOrgNameChainsMap
                       %= ( \m -> case M.lookup cm m of
                              Nothing -> M.insert cm (TrueOrgNameChains $ Set.singleton chainId) m
                              Just (TrueOrgNameChains s) -> M.insert cm (TrueOrgNameChains $ Set.insert chainId s) m
                          )
                     atomically . writeTQueue unseqSource . (: []) . UnseqEvent $ IENewChainOrgName chainId cm
                   RemoveOrgName chainId cm -> do
                     let org = ChainMembers $ Set.singleton cm
                         newMemRset@(ChainMemberRSet newMem) = chainMembersToChainMemberRset org
                     chainMembersMap . at chainId %= \case
                       Nothing -> Just newMemRset
                       Just (ChainMemberRSet rset') -> Just . ChainMemberRSet $ rSetIntersection rset' newMem
                     falseOrgNameChainsMap
                       %= ( \m -> case M.lookup cm m of
                              Nothing -> M.insert cm (FalseOrgNameChains $ Set.singleton chainId) m
                              Just (FalseOrgNameChains s) -> M.insert cm (FalseOrgNameChains $ Set.insert chainId s) m
                          )
                     atomically . writeTQueue unseqSource . (: []) . UnseqEvent $ IENewChainOrgName chainId cm
                   RegisterCertificate addr certState@(X509CertInfoState _ _ _ _ o u c) -> do
                     let setOrg = Org (T.pack o) True
                         setOrgUnit = OrgUnit (T.pack o) (T.pack $ fromMaybe "Nothing" u) True
                         setCommonName = CommonName (T.pack o) (T.pack $ fromMaybe "Nothing" u) (T.pack c) True
                     parsedSetMap
                       %= ( \m -> case ((M.lookup setOrg m), (M.lookup setOrgUnit m)) of
                              (Just _, Just mems) -> case setCommonName `elem` mems of
                                True -> m
                                False -> M.insert setOrgUnit (mems ++ [setCommonName]) m
                              (Just units, Nothing) -> do
                                let stageOne = M.insert setOrg (units ++ [setOrgUnit]) m
                                M.insert setOrgUnit [setCommonName] stageOne
                              (Nothing, Just _) -> m
                              (Nothing, Nothing) -> do
                                let stageOne = M.insert setOrg [setOrgUnit] m
                                M.insert setOrgUnit [setCommonName] stageOne
                          )
                     x509certMap %= M.insert addr certState
                     let theParsedSet = CommonName ((T.pack . X509.orgName) certState) (T.pack $ fromMaybe "Nothing" $ X509.orgUnit certState) ((T.pack . X509.commonName) certState) True
                     parsedSetToX509Map %= M.insert theParsedSet certState
                   CertificateRevoked _ -> pure () --(Right addr) -> pure ()
                   TerminateChain _ -> pure ()
                   PutLogDB _ -> pure ()
                   PutEventDB _ -> pure ()
                   PutTxResult _ -> pure ()
                   ev -> do
                     $logInfoS (name <> "/testTxrIndexer") . T.pack $ show ev
                     pure ()
               )
      pubkeystr = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False $ derivePublicKey privKey
      ppeer =
        buildPeer
          ( Just pubkeystr,
            T.unpack ipAddr,
            30303
          )
      unseq ies = do
        atomically . writeTQueue unseqSource $ UnseqEvent <$> ies

  memPeerDBEnv <- createMemPeerDBEnv ipAsText $ map (\(IPAsText ip) -> buildPeer (Nothing, T.unpack ip, 30303)) bootNodes

  pure $
    P2PPeer
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
      memPeerDBEnv
      inet
      ipAsText
      udpVSock
      seqTimerSource
      sequencer
      vm
      apiIndexer'
      p2pIndexer'
      txrIndexer'

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
createConnection server' client' = do
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource server'
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client'
  serverCtx <- newIORef $ def & unseqSink .~ _p2pPeerUnseqSource server'
  clientCtx <- newIORef $ def & unseqSink .~ _p2pPeerUnseqSource client'
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let rServer = Executable.StratoP2PServer.runEthServerConduit
                  (_p2pPeerPPeer client')             
                  (sourceTQueue clientToServerTQueue) 
                  (sinkTQueue serverToClientTQueue)   
                  (sourceTMChan serverSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                  ("Me: " ++ _p2pPeerName server' ++ ", Them: " ++ _p2pPeerName client')
  let rClient = runEthClientConduit         
                  (_p2pPeerPPeer server')
                  (sourceTQueue serverToClientTQueue)
                  (sinkTQueue clientToServerTQueue)
                  (sourceTMChan clientSeqSource .| (awaitForever $ either (const $ pure ()) yield))
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

-- testPeer :: DataPeer.PPeer
-- testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

-- runTestPeer :: MonadP2PTest TestContextM a -> IO ()
-- runTestPeer f = do
--   seqCtx <- newSequencerContext emptyBlockstanbulContext
--   cache <- TRC.new 64
--   let cstate = def & txRunResultsCache .~ cache
--       vmCtx = MemContext def cstate
--   ctx <- newTVarIO $ testContext undefined seqCtx vmCtx
--   p2pCtx <- newIORef def
--   void . runNoLoggingT . runResourceT . flip runReaderT ctx $ runReaderT f p2pCtx

-- execTestPeer :: PrivateKey
--              -> [Address]
--              -> TestContextM a
--              -> IO (a, TestContext)
-- execTestPeer = execTestPeerOnRound 0

-- execTestPeerOnRound :: Word256
--                     -> PrivateKey
--                     -> [Address]
--                     -> TestContextM a
--                     -> IO (a, TestContext)
-- execTestPeerOnRound n pk as f = do
--   seqCtx <- newSequencerContext $ (view . round .~ n) (newBlockstanbulContext (fromPrivateKey pk) as)
--   cache <- TRC.new 64
--   let cstate = def & txRunResultsCache .~ cache
--       vmCtx = MemContext def cstate
--   ctx <- newTVarIO $ testContext pk seqCtx vmCtx
--   a <- runLoggingT . runResourceT $ runReaderT f ctx
--   ctx' <- readTVarIO ctx
--   return (a, ctx')

-- execTestPeerWithContext :: TestContextM a -> TestContext -> IO (a, TestContext)
-- execTestPeerWithContext f ctx = do
--   ref <- newTVarIO ctx
--   a <- runLoggingT . runResourceT $ runReaderT f ref
--   ctx' <- readTVarIO ref
--   return (a, ctx')

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

runNetwork :: [P2PPeer] -> [P2PConnection] -> IO ()
runNetwork nodes connections =
  concurrently_
    (mapConcurrently runNode nodes)
    (mapConcurrently runConnection connections)

makeValidators :: [PrivateKey] -> [Address]
makeValidators = map fromPrivateKey

signChain :: PrivateKey -> UnsignedChainInfo -> ChainInfo
signChain privKey u =
  let (r', s', v') = getSigVals . signMsg privKey . keccak256ToByteString $ rlpHash u
      chainSig = ChainSignature r' s' v'
   in ChainInfo u chainSig

mkSignedTx :: PrivateKey -> U.UnsignedTransaction -> Transaction
mkSignedTx privKey utx =
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
                  transactionMetadata = Just $ M.fromList [("VM", "SolidVM")]
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
              transactionMetadata = Just $ M.fromList [("VM", "SolidVM")]
            }

instance HasVault IO where
  sign bs = newPrivateKey >>= \pk -> return $ signMsg pk bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

instance HasVault (ReaderT PrivateKey IO) where
  sign bs = ask >>= \pk -> return $ signMsg pk bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

-- endlessStreamOfIPAddresses :: [String]
-- endlessStreamOfIPAddresses = generateThem
--   where galois x = let y = (7*chx) `mod` 256 in x : galois y
--         check x = if x == 0 then 1 else x
--         ips xs = take 4 xs : ips (drop 4 xs)
--         toIP = L.intersperse '.' . map show
--         generateThem = toIP <$> ips (galois 1)

createPeer' :: PrivateKey -> ChainMemberParsedSet -> [(Address, ChainMemberParsedSet)] -> T.Text -> T.Text -> IO P2PPeer
createPeer' pk selfId as n ip = do
  inet <- newTVarIO preAlGoreInternet
  createPeer pk selfId as inet n (IPAsText ip) (TCPPort 30303) (UDPPort 30303) []

spec :: Spec
spec = pure ()
  -- describe "handleEvents" $ do
  --   it "should pong a ping" $
  --     runTestPeer $ do
  --       runConduit $ yield (MsgEvt Ping) .| handleEvents testPeer .| sinkList `L.shouldReturn` [Right Pong]
  --   it "should return empty BlockBodies to empty BlockHeaders" $
  --     runTestPeer $ do
  --       runConduit $ yield (MsgEvt (BlockHeaders [])) .| handleEvents testPeer .| sinkList
  --         `L.shouldReturn` [Right $ GetBlockBodies []]
  --   it "should forward blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
  --     let addr = blockstanbulSender wm
  --     in addr /= 0 && addr /= 0xa ==> runTestPeer $ do
  --       -- Without "proof" of which peer this is, assume it could be addr
  --       shouldSendToPeer addr `L.shouldReturn` True
  --       shouldSendToPeer 0xa `L.shouldReturn` True
  --       runConduit $ yield (MsgEvt (Blockstanbul wm))
  --                          .| handleEvents testPeer
  --                          .| sinkList
  --          `L.shouldReturn` [Left $ ToUnseq [IEBlockstanbul wm]]
  --       -- Now that the peer is known to be addr, we should only send if they are designated
  --       shouldSendToPeer addr `L.shouldReturn` True
  --       shouldSendToPeer 0xa `L.shouldReturn` False

  --   it "should broadcast blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
  --     runTestPeer $ do
  --       runConduit $ yield (NewSeqEvent (P2pBlockstanbul wm))
  --                     .| handleEvents testPeer
  --                     .| sinkList
  --           `L.shouldReturn` [Right $ Blockstanbul wm]
  --       -- We should not mistake internal messages as the peers
  --       shouldSendToPeer 0xa `L.shouldReturn` True

  --   it "should forward a timer to a TXQueue timeout" $ do
  --     runTestPeer $ do
  --       runConduit $ yield TimerEvt
  --                     .| handleEvents testPeer
  --                     .| sinkList
  --           `L.shouldReturn` [Left TXQueueTimeout]
