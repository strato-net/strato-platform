{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PackageImports        #-}
{-# LANGUAGE QuasiQuotes           #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module EventSpec where

import           Prelude hiding (round)
import           Conduit
import           Control.Applicative                   (liftA2)
import           Control.Concurrent.STM.TMChan
import           Control.Lens                          hiding (Context, view)
import qualified Control.Lens                          as Lens
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import qualified Control.Monad.State                   as State
import           Crypto.Types.PubKey.ECC
import           Data.Bits
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue                   hiding (newTQueueIO)
import           Data.Default
import           Data.Either.Extra                     (eitherToMaybe)
import           Data.Foldable                         (for_, toList, traverse_)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import           Data.Maybe                            (fromJust, fromMaybe, isJust, catMaybes)
import qualified Data.NibbleString                     as N
import           Data.Ranged
import qualified Data.Set                              as Set
import qualified Data.Set.Ordered                      as S
import qualified Data.Sequence                         as Q
import           Data.Time.Clock                       (getCurrentTime)
import           Data.Text (Text)
import qualified Data.Text                             as T
import qualified Data.Text.Encoding                    as Text
import           Data.Traversable                      (for)

import           BlockApps.Logging
import           BlockApps.X509.Certificate            as X509
import           BlockApps.X509.Keys
import           Blockchain.Bagger.BaggerState
import           Blockchain.Bagger
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Blockstanbul.Messages      (round)
import           Blockchain.Blockstanbul.StateMachine
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
import           Blockchain.Data.PubKey
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

import qualified "vm-runner" Blockchain.Event          as VMEvent
import           Blockchain.MemVMContext               hiding (getMemContext, get, gets, put, modify, modify', dbsGet, dbsGets, dbsPut, dbsModify, dbsModify', contextGet, contextGets, contextPut, contextModify, contextModify')
import           Blockchain.VMContext                  (IsBlockstanbul(..), ContextBestBlockInfo(..), baggerState, putContextBestBlockInfo)
import           Blockchain.Options()
import           Blockchain.Privacy
import qualified Blockchain.Sequencer                  as Seq
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Strato.Discovery.Data.Peer hiding (createPeer)
import           Blockchain.Strato.Discovery.UDP
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
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Wei
import           Blockchain.VMContext                 (lookupX509AddrFromCBHash)
import qualified Blockchain.TxRunResultCache           as TRC

import           Test.Hspec
import           Test.QuickCheck
import           Text.RawString.QQ
import           Text.Read                            (readMaybe)
import           Time.System

import           Debugger                              (DebugSettings)

import           Executable.EthereumDiscovery
import           Executable.EthereumVM
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer
import           Executable.StratoP2P

import           Network.Socket
import           UnliftIO
import           UnliftIO.Concurrent                   (threadDelay)

data VSocket = VSocket
  { _inbound :: TQueue B.ByteString
  , _outbound :: TQueue B.ByteString
  }
makeLenses ''VSocket

newVSocket :: IO VSocket
newVSocket = liftA2 VSocket newTQueueIO newTQueueIO

data Internet = Internet
  { _tcpPorts :: Map (IPAsText, TCPPort) (TQueue (VSocket, IPAsText))
  , _udpPorts :: Map (IPAsText, UDPPort) (TQueue (B.ByteString, SockAddr))
  }
makeLenses ''Internet

preAlGoreInternet :: Internet
preAlGoreInternet = Internet M.empty M.empty

data P2PContext = P2PContext
  { _blockHeaders          :: [DataDefs.BlockData]
  , _remainingBlockHeaders :: RemainingBlockHeaders
  , _actionTimestamp       :: ActionTimestamp
  , _peerAddr              :: PeerAddress
  , _outboundPbftMessages  :: S.OSet (Text, Keccak256)
  , _unseqSink             :: TQueue [SeqLoopEvent]
  }
makeLenses ''P2PContext

instance Default P2PContext where
  def = P2PContext []
                   (RemainingBlockHeaders [])
                   emptyActionTimestamp
                   (PeerAddress Nothing)
                   S.empty
                   (error "P2PContext: uninitialized unseqSink")

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
  , _stringPPeerMap        :: Map String PPeer
  , _pointPPeerMap         :: Map Point PPeer
  , _pbftMessages          :: S.OSet Keccak256
  , _unseqEvents           :: [IngestEvent]
  , _sequencerContext      :: SequencerContext
  , _blockPeriod           :: BlockPeriod
  , _roundPeriod           :: RoundPeriod
  , _candidatesReceived    :: TQueue CandidateReceived
  , _voteResults           :: TQueue VoteResult
  , _timeoutChan           :: TMChan RoundNumber
  , _vmContext             :: MemContext
  , _apiChainInfoMap       :: Map Word256 ChainInfo
  , _parsedSetMap          :: Map ChainMemberParsedSet [ChainMemberParsedSet]
  , _parsedSetToX509Map    :: Map ChainMemberParsedSet X509CertInfoState
  }

makeLenses ''TestContext

type TestContextM = ReaderT P2PPeer (ResourceT (LoggingT IO))

type MonadTest m = ReaderT P2PPeer m

type MonadP2PTest m = ReaderT (IORef P2PContext) m

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState TestContext (MonadTest m) where
  state f = asks _p2pTestContext >>= \ctx -> liftIO . atomically $ do
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

instance (MonadIO m, MonadLogger m) => A.Selectable ChainMembers TrueOrgNameChains (MonadTest m) where
  select p ip = do
    res <- A.selectWithDefault p ip
    pure $ toMaybe (TrueOrgNameChains Set.empty) res
  selectWithDefault _ ip = do
    let mems = Set.toList $ unChainMembers ip
        cms = ChainMembers . Set.singleton <$> mems
    trueMap <- use trueOrgNameChainsMap
    let res = flip M.lookup trueMap <$> cms
    pure $ TrueOrgNameChains $ Set.fromList $ concatMap (\tr -> 
      case tr of
        Just chains -> Set.toList $ unTrueOrgNameChains chains
        Nothing -> []
      )res

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

instance Show TrueOrgNameChains where
  show (TrueOrgNameChains unchain) = show unchain

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

instance MonadIO m => A.Selectable String PPeer (MonadTest m) where
  select = A.lookup

instance MonadIO m => (String `A.Alters` PPeer) (MonadTest m) where
  lookup _ ip   = use $ stringPPeerMap . at ip
  insert _ ip p = do
    mPeer <- use $ stringPPeerMap . at ip
    case mPeer of
      Nothing -> do
        stringPPeerMap . at ip ?= p
        case pPeerPubkey p of
          Nothing -> pure $ ()
          Just k -> pointPPeerMap . at k ?= p
      Just oldPeer -> do
        stringPPeerMap . at ip ?= oldPeer{pPeerPubkey = pPeerPubkey p, pPeerEnode = pPeerEnode p}
        case pPeerPubkey p of
          Nothing -> pure $ ()
          Just k -> pointPPeerMap . at k ?= oldPeer{pPeerPubkey = pPeerPubkey p, pPeerEnode = pPeerEnode p}
  delete _ ip   = do
    stringPPeerMap . at ip .= Nothing

instance MonadIO m => (Point `A.Alters` PPeer) (MonadTest m) where
  lookup _ p   = use $ pointPPeerMap . at p
  insert _ _ _ = error "This should not be called."
  delete _ _   = error "This should not be called."

instance (MonadIO m, (Point `A.Alters` PPeer) m) => (Point `A.Alters` PPeer) (MonadP2PTest m) where
  lookup p point = lift $ A.lookup p point
  insert p point = lift . A.insert p point
  delete p point = lift $ A.delete p point

instance (MonadIO m, (Point `A.Alters` PPeer) m) => A.Selectable Point PPeer (MonadP2PTest m) where
  select = A.lookup

instance (Monad m, Stacks Block m) => Stacks Block (MonadP2PTest m) where
  takeStack a b = lift $ takeStack a b
  pushStack bs  = lift $ pushStack bs

instance (Keccak256 `A.Alters` DataDefs.BlockData) m => (Keccak256 `A.Alters` DataDefs.BlockData) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance MonadIO m => (ChainMembers `A.Alters` Word256) (MonadTest m) where
  lookup _ _ = error "lookup P2P ChainMembers Word256" 
  insert _ _ _ = error "insert P2P ChainMembers Word256" 
  delete _ _ = error "delete P2P ChainMembers Word256" 

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

instance A.Selectable String PPeer m => A.Selectable String PPeer (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

instance (MonadIO m, (String `A.Alters` PPeer) m) => (String `A.Alters` PPeer) (MonadP2PTest m) where
  lookup p ip = lift $ A.lookup p ip
  insert p ip = lift . A.insert p ip
  delete p ip = lift $ A.delete p ip

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

instance MonadIO m => Mod.Accessible (TQueue CandidateReceived) (MonadTest m) where
  access _ = use candidatesReceived

instance MonadIO m => Mod.Accessible (TQueue VoteResult) (MonadTest m) where
  access _ = use voteResults

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

instance MonadIO m => Mod.Modifiable CurrentBlockHash (MonadTest m) where
  get _    = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ Lens.view $ memDBs . currentBlock
  put _ bh = modify $ memDBs . currentBlock ?~ bh

instance MonadIO m => HasMemAddressStateDB (MonadTest m) where
  getAddressStateTxDBMap = gets $ Lens.view $ memDBs . stateTxMap
  putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
  getAddressStateBlockDBMap = gets $ Lens.view $ memDBs . stateBlockMap
  putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap


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

instance (MonadIO m, MonadLogger m) => (Address `A.Selectable` X509.X509Certificate) (MonadTest m) where
  select _ k = do
      let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8 
      mCertAddress <- lookupX509AddrFromCBHash k
      fmap join . for mCertAddress $ \certAddress ->
        maybe Nothing (eitherToMaybe . bsToCert) <$> A.lookup (A.Proxy) (certKey certAddress "certificateString")


instance (MonadIO m, MonadLogger m) => ((Address,T.Text) `A.Selectable` X509.X509CertificateField) (MonadTest m) where
  select _ (k,t) = do
    let certKey addr = ((Account addr Nothing),) . Text.encodeUtf8 
    mCertAddress <- lookupX509AddrFromCBHash k
    fmap join . for mCertAddress $ \certAddress ->
      maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)

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

instance MonadIO m => (([Address],[Address]) `A.Alters` API DataDefs.ValidatorRef) (MonadTest  m) where
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
  insert _ _ (P2P OutputBlock{..}) = canonicalBlockDataMap . at (DataDefs.blockDataNumber obBlockData) ?= Canonical obBlockData

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

instance MonadIO m => (MonadTest m) `Mod.Outputs` [IngestEvent] where
  output ies = unseqEvents %= (++ies)

instance (MonadIO m, m `Mod.Outputs` [IngestEvent]) => (MonadP2PTest m) `Mod.Outputs` [IngestEvent] where
  output ies = do
    uSink <- use unseqSink
    atomically . writeTQueue uSink $ UnseqEvent <$> ies
    lift $ Mod.output ies

instance (MonadIO m, (String `A.Alters` PPeer) m) => A.Selectable IPAsText PPeer (MonadP2PTest m) where
  select = A.lookup

instance (MonadIO m, (String `A.Alters` PPeer) m) => A.Replaceable IPAsText PPeer (MonadP2PTest m) where
  replace = A.insert

instance (MonadIO m, (String `A.Alters` PPeer) m) => (IPAsText `A.Alters` PPeer) (MonadP2PTest m) where
  lookup _ (IPAsText ip)   = A.lookup (A.Proxy @PPeer) $ T.unpack ip
  insert _ (IPAsText ip) p = A.insert (A.Proxy @PPeer) (T.unpack ip) p
  delete _ (IPAsText ip)   = A.delete (A.Proxy @PPeer) $ T.unpack ip

toActivityState :: Int -> ActivityState
toActivityState 1 = Active
toActivityState _ = Inactive

fromActivityState :: ActivityState -> Int
fromActivityState Active = 1
fromActivityState Inactive = 0

instance (MonadIO m, State.MonadState TestContext m) => A.Selectable (IPAsText, TCPPort) ActivityState (MonadP2PTest m) where
  select = A.lookup

instance (MonadIO m, State.MonadState TestContext m) => A.Alters (IPAsText, TCPPort) ActivityState (MonadP2PTest m) where
  lookup _ (IPAsText t, _)   = fmap (fmap $ toActivityState . pPeerActiveState) . lift . use $ stringPPeerMap . at (T.unpack t)
  insert _ (IPAsText t, _) a = lift $ stringPPeerMap . at (T.unpack t) . _Just %= \p -> p{pPeerActiveState = fromActivityState a}
  delete _ _         = error "Test peer should not be deleting activity states"

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
            pSink   = sinkTQueue i
            v = VSocket i o
        atomically $ writeTQueue s (v, myIP)
        f $ P2pConduits pSource pSink sSource

instance (MonadIO m, MonadUnliftIO m, MonadLogger m, MonadReader P2PPeer m) => RunsServer (MonadP2PTest m) (LoggingT IO) where
  runServer tcpPort@(TCPPort p) runner f = runner $ \sSource -> do
    inet <- lift $ asks _p2pPeerInternet
    myIP@(IPAsText ip) <- lift $ asks _p2pMyIPAddress
    mSock <- liftIO $ M.lookup (myIP, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runServer" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> forever $ do
        (VSocket i o, otherIP) <- atomically $ readTQueue s
        let pSource = sourceTQueue i
            pSink   = sinkTQueue o
        void . async $ f (P2pConduits pSource pSink sSource) otherIP

instance Monad m => Mod.Accessible TCPPort (MonadP2PTest m) where
  access _ = pure $ TCPPort 30303

instance Monad m => Mod.Accessible UDPPort (MonadP2PTest m) where
  access _ = pure $ UDPPort 30303

sockAddrToIpAndPort :: SockAddr -> Maybe (IPAsText, UDPPort)
sockAddrToIpAndPort (SockAddrInet port host) = case hostAddressToTuple host of
  (a,b,c,d) ->
    let ipStr = concat
          [ show a
          , "."
          , show b
          , "."
          , show c
          , "."
          , show d
          ]
        ip = IPAsText $ T.pack ipStr
        udpPort = UDPPort $ fromIntegral port
     in Just (ip, udpPort)
sockAddrToIpAndPort _ = Nothing

ipAndPortToSockAddr :: IPAsText -> UDPPort -> Maybe SockAddr
ipAndPortToSockAddr (IPAsText ip) (UDPPort port) =
  case traverse readMaybe (T.unpack <$> T.splitOn "." ip) of
    Just [(a :: Int),b,c,d] ->
      let addr = (fromIntegral a)
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

instance MonadIO m => A.Selectable IPAsText ClosestPeers (MonadTest m) where
  select _ (IPAsText t) = Just . ClosestPeers . filter f . M.elems <$> use stringPPeerMap
    where f p = pPeerIp p /= t && pPeerPubkey p /= Nothing

instance A.Selectable IPAsText ClosestPeers m => A.Selectable IPAsText ClosestPeers (MonadP2PTest m) where
  select p = lift . A.select p

instance ( MonadIO m
         , MonadLogger m
         , MonadReader P2PPeer m
         ) => A.Replaceable SockAddr B.ByteString (MonadP2PTest m) where
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

instance ( MonadIO m
         , MonadUnliftIO m
         , MonadLogger m
         , MonadReader P2PPeer m
         ) => A.Selectable () (B.ByteString, SockAddr) (MonadP2PTest m) where
  select _ _ = do
    s <- lift $ asks _p2pMyUDPSocket
    mMsg <- timeout 10000000 . atomically $ readTQueue s
    pure mMsg

instance ( MonadIO m
         , MonadUnliftIO m
         , MonadLogger m
         , MonadReader P2PPeer m
         ) => A.Selectable (IPAsText, UDPPort, B.ByteString) Point (MonadP2PTest m) where
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

instance MonadIO m => Mod.Accessible AvailablePeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- asks _p2pMyIPAddress
    AvailablePeers . filter ((< currentTime) . pPeerEnableTime) . filter ((/= ip) . pPeerIp) . M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible AvailablePeers m) => Mod.Accessible AvailablePeers (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => Mod.Accessible BondedPeersForUDP (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- asks _p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime && pPeerIp p /= ip
    BondedPeersForUDP . filter f . M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible BondedPeersForUDP m) => Mod.Accessible BondedPeersForUDP (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => A.Replaceable PPeer UdpEnableTime (MonadTest m) where
  replace _ peer' (UdpEnableTime enableTime) = stringPPeerMap . at (T.unpack $ pPeerIp peer') . _Just %= (\p -> p{pPeerUdpEnableTime = enableTime})

instance (Monad m, A.Replaceable PPeer UdpEnableTime m) => A.Replaceable PPeer UdpEnableTime (MonadP2PTest m) where
  replace p k = lift . A.replace p k

instance MonadIO m => A.Replaceable PPeer TcpEnableTime (MonadTest m) where
  replace _ peer' (TcpEnableTime enableTime) = stringPPeerMap . at (T.unpack $ pPeerIp peer') . _Just %= (\p -> p{pPeerEnableTime = enableTime})

instance (Monad m, A.Replaceable PPeer TcpEnableTime m) => A.Replaceable PPeer TcpEnableTime (MonadP2PTest m) where
  replace p k = lift . A.replace p k

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

instance MonadIO m => (ChainMemberParsedSet `A.Selectable` X509CertInfoState) (MonadTest m) where
  select _ cm = M.lookup cm <$> use parsedSetToX509Map 

instance (ChainMemberParsedSet `A.Selectable` X509CertInfoState) m => (ChainMemberParsedSet `A.Selectable` X509CertInfoState) (MonadP2PTest m) where
  select p cm = lift $ A.select p cm

instance MonadIO m => Mod.Accessible BondedPeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- asks _p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime && pPeerIp p /= ip
    BondedPeers . filter f . M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible BondedPeers m) => Mod.Accessible BondedPeers (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => Mod.Accessible UnbondedPeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- asks _p2pMyIPAddress
    let f p = pPeerBondState p == 0 && pPeerEnableTime p < currentTime && pPeerIp p /= ip
    UnbondedPeers . filter f . M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible UnbondedPeers m) => Mod.Accessible UnbondedPeers (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => A.Replaceable (IPAsText, UDPPort) PeerBondingState (MonadTest m) where
  replace _ (IPAsText t, _) (PeerBondingState s) = do
    let ip = T.unpack t
    stringPPeerMap . at ip . _Just %= (\p -> p{pPeerBondState = s})

instance (Monad m, A.Replaceable (IPAsText, UDPPort) PeerBondingState m) => A.Replaceable (IPAsText, UDPPort) PeerBondingState (MonadP2PTest m) where
  replace p k = lift . A.replace p k

instance MonadIO m => A.Replaceable PPeer PeerDisable (MonadTest m) where
  replace _ peer' d = case d of
    ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
      stringPPeerMap . at (T.unpack $ pPeerIp peer') . _Just %= (\p -> p{pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = pPeerNextDisableWindowSeconds p * nextDisableWindowFactor})
    SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
      stringPPeerMap . at (T.unpack $ pPeerIp peer') . _Just %= (\p -> p{pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration})

instance (Monad m, A.Replaceable PPeer PeerDisable m) => A.Replaceable PPeer PeerDisable (MonadP2PTest m) where
  replace p k = lift . A.replace p k

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
      , _chainInfoRegistry   = M.empty
      , _orgNameChainsRegistry = M.empty
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
testContext :: PrivateKey
            -> [IPAsText]
            -> TQueue CandidateReceived
            -> TQueue VoteResult
            -> TMChan RoundNumber
            -> SequencerContext
            -> MemContext
            -> TestContext
testContext prv bootNodes candRecv vRes rNum seqCtx vmCtx = TestContext
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
  , _stringPPeerMap        = M.fromList $ zip ((\(IPAsText t) -> T.unpack t) <$> bootNodes) $ (\(IPAsText t) -> buildPeer (Nothing, T.unpack t, 30303)) <$> bootNodes
  , _pointPPeerMap         = M.empty
  , _pbftMessages          = S.empty
  , _unseqEvents           = []
  , _sequencerContext      = seqCtx
  , _blockPeriod           = BlockPeriod 1
  , _roundPeriod           = RoundPeriod 10
  , _candidatesReceived    = candRecv
  , _voteResults           = vRes
  , _timeoutChan           = rNum
  , _vmContext             = vmCtx
  , _apiChainInfoMap       = M.empty
  , _parsedSetMap          = M.empty
  , _parsedSetToX509Map    = M.empty
  }

data P2PPeer = P2PPeer
  { _p2pPeerPrivKey        :: PrivateKey
  , _p2pPeerPPeer          :: PPeer
  , _p2pPeerUnseqSource    :: TQueue [SeqLoopEvent]
  , _p2pPeerSeqP2pSource   :: TMChan (Either TxrResult P2pEvent)
  , _p2pPeerSeqVmSource    :: TQueue [VmEvent]
  , _p2pPeerApiIndexSource :: TQueue [IndexEvent]
  , _p2pPeerP2pIndexSource :: TQueue [IndexEvent]
  , _p2pPeerTxrIndexSource :: TQueue IndexEvent
  , _p2pPeerUnseqSink      :: [IngestEvent] -> TestContextM ()
  , _p2pPeerName           :: String
  , _p2pTestContext        :: TVar TestContext
  , _p2pPeerInternet       :: TVar Internet
  , _p2pMyIPAddress        :: IPAsText
  , _p2pMyUDPSocket        :: TQueue (B.ByteString, SockAddr)
  , _p2pPeerSeqTimerSource :: TestContextM ()
  , _p2pPeerSequencer      :: TestContextM ()
  , _p2pPeerVm             :: TestContextM ()
  , _p2pPeerApiIndexer     :: TestContextM ()
  , _p2pPeerP2pIndexer     :: TestContextM ()
  , _p2pPeerTxrIndexer     :: TestContextM ()
  }
makeLenses ''P2PPeer

runNodeWithoutP2P :: P2PPeer -> IO ()
runNodeWithoutP2P p = do
  concurrently_
    (concurrently_ (concurrently_ (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerSequencer))
                                  (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerSeqTimerSource)))
                   (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerVm)))
    (concurrently_ 
      (concurrently_ (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerApiIndexer))
                     (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerP2pIndexer)))
      (runLoggingT . runResourceT $ flip runReaderT p (p ^. p2pPeerTxrIndexer)))

runNode :: P2PPeer -> IO ()
runNode p = do
  chan <- atomically . dupTMChan $ p ^. p2pPeerSeqP2pSource
  let s = sourceTMChan chan .| (awaitForever $ either (const $ pure ()) yield)
  ctx <- newIORef $ def & unseqSink .~ p ^. p2pPeerUnseqSource
  concurrently_
    (runNodeWithoutP2P p)
    (concurrently_
      (stratoP2P (\f -> runResourceT . flip runReaderT p $ runReaderT (f s) ctx))
      (runLoggingT $ ethereumDiscovery (\f -> runResourceT . flip runReaderT p $ runReaderT (f 100) ctx)))

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
           -> TVar Internet
           -> Text
           -> IPAsText
           -> TCPPort
           -> UDPPort
           -> [IPAsText]
           -> IO P2PPeer
createPeer privKey initialValidators inet name ipAsText@(IPAsText ipAddr) tcpPort udpPort bootNodes = do
  unseqSource <- newTQueueIO
  seqP2pSource <- newBroadcastTMChanIO
  seqVmSource <- newTQueueIO
  apiIndexerSource <- newTQueueIO
  p2pIndexerSource <- newTQueueIO
  txrIndexerSource <- newTQueueIO
  chr <- atomically newTQueue
  chv <- atomically newTQueue
  cht <- atomically newTMChan
  tcpVSock <- newTQueueIO
  udpVSock <- newTQueueIO
  atomically $ do
    modifyTVar inet $ tcpPorts . at (ipAsText, tcpPort) ?~ tcpVSock
    modifyTVar inet $ udpPorts . at (ipAsText, udpPort) ?~ udpVSock
  seqCtx <- newSequencerContext $ newBlockstanbulContext (fromPrivateKey privKey) initialValidators
  cache  <- TRC.new 64
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
        jamshidBirth
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
  testContextTVar <- newTVarIO $ testContext privKey bootNodes chr chv cht seqCtx vmCtx
  let seqTimerSource = runConduit $ sourceTMChan cht .| mapC ((:[]) . TimerFire) .| sinkTQueue unseqSource
  let sequencer = do
        DBDB.bootstrapGenesisBlock genHash 1
        A.insert (A.Proxy @EmittedBlock) genHash alreadyEmittedBlock
        atomically $ writeTQueue seqVmSource [VmCreateBlockCommand]
        createFirstTimer
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
        putContextBestBlockInfo $ ContextBestBlockInfo (genHash, genesisBlock, 0, 0, 0)
        Mod.put (Mod.Proxy @BlockHashRoot) $ BlockHashRoot bhr
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
                                    AddOrgName (Right (chainId, cm)) -> do
                                      let org = ChainMembers $ Set.singleton cm
                                          newMemRset@(ChainMemberRSet newMem) = chainMembersToChainMemberRset org
                                      chainMembersMap . at chainId %= \case
                                        Nothing -> Just newMemRset
                                        Just (ChainMemberRSet rset') -> Just . ChainMemberRSet $ rSetUnion rset' newMem
                                      trueOrgNameChainsMap %= (\m -> case M.lookup org m of
                                          Nothing -> M.insert org (TrueOrgNameChains $ Set.singleton chainId) m
                                          Just (TrueOrgNameChains s) -> M.insert org (TrueOrgNameChains $ Set.insert chainId s) m
                                        )
                                      atomically . writeTQueue unseqSource . (:[]) . UnseqEvent $ IENewChainOrgName chainId cm
                                    RemoveOrgName _ -> pure () --(Right (cid, (n, u)))
                                    RegisterCertificate (Right (_, addr, certState@(X509CertInfoState _ _ _ _ o u c))) -> do
                                      let setOrg = Org (T.pack o) True
                                          setOrgUnit = OrgUnit (T.pack o) (T.pack $ fromMaybe "Nothing" u) True
                                          setCommonName = CommonName (T.pack o) (T.pack $ fromMaybe "Nothing" u) (T.pack c) True
                                      parsedSetMap %= (\m -> case ((M.lookup setOrg m), (M.lookup setOrgUnit m)) of
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
      ppeer = buildPeer ( Just pubkeystr
                        , T.unpack ipAddr
                        , 30303
                        )
      unseq ies = do
        atomically . writeTQueue unseqSource $ UnseqEvent <$> ies
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
  { _serverToClient  :: TQueue B.ByteString
  , _clientToServer  :: TQueue B.ByteString
  , _serverP2PPeer   :: P2PPeer
  , _clientP2PPeer   :: P2PPeer
  , _server          :: TestContextM (Maybe SomeException)
  , _client          :: TestContextM (Maybe SomeException) 
  , _serverException :: TVar (Maybe SomeException)
  , _clientException :: TVar (Maybe SomeException)
  }
makeLenses ''P2PConnection

createConnection :: P2PPeer
                 -> P2PPeer
                 -> IO P2PConnection
createConnection server' client' = do
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource server'
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqP2pSource client'
  serverCtx <- newIORef $ def & unseqSink .~ _p2pPeerUnseqSource server'
  clientCtx <- newIORef $ def & unseqSink .~ _p2pPeerUnseqSource client'
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let rServer :: MonadP2PTest TestContextM (Maybe SomeException)
      rServer = runEthServerConduit (_p2pPeerPPeer client')
                                    (sourceTQueue clientToServerTQueue)
                                    (sinkTQueue serverToClientTQueue)
                                    (sourceTMChan serverSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                    ("Me: " ++ _p2pPeerName server' ++ ", Them: " ++ _p2pPeerName client')
      rClient :: MonadP2PTest TestContextM (Maybe SomeException)
      rClient = runEthClientConduit (_p2pPeerPPeer server')
                                    (sourceTQueue serverToClientTQueue)
                                    (sinkTQueue clientToServerTQueue)
                                    (sourceTMChan clientSeqSource .| (awaitForever $ either (const $ pure ()) yield))
                                    ("Me: " ++ _p2pPeerName client' ++ ", Them: " ++ _p2pPeerName server')
  pure $ P2PConnection
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

runConnection :: P2PConnection
              -> IO ()
runConnection connection = do
  let rServer = do
        mEx <- runLoggingT . runResourceT . flip runReaderT (connection ^. serverP2PPeer) $ connection ^. server
        atomically $ writeTVar (connection ^. serverException) mEx
      rClient = do
        mEx <- runLoggingT . runResourceT . flip runReaderT (connection ^. clientP2PPeer) $ connection ^. client
        atomically $ writeTVar (connection ^. clientException) mEx
  concurrently_ rServer rClient

runNetwork :: [P2PPeer] -> [P2PConnection] -> IO ()
runNetwork nodes connections =
  concurrently_ (mapConcurrently runNode nodes)
                (mapConcurrently runConnection connections)

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

createPeer' :: PrivateKey -> [Address] -> T.Text -> T.Text -> IO P2PPeer
createPeer' pk as n ip = do
  inet <- newTVarIO preAlGoreInternet
  createPeer pk as inet n (IPAsText ip) (TCPPort 30303) (UDPPort 30303) []

spec :: Spec
spec = do
  describe "network simulation" $ do
    it "should send a transaction from server to client" $ do
      serverPKey <- newPrivateKey
      clientPKey <- newPrivateKey
      let validatorAddresses = makeValidators [serverPKey, clientPKey]
      server' <- createPeer' serverPKey validatorAddresses "server" "1.2.3.4"
      client' <- createPeer' clientPKey validatorAddresses "client" "5.6.7.8"
      connection <- createConnection server' client'
      let clearChainId tx = case tx of
            MessageTX{} -> tx{transactionChainId = Nothing}
            ContractCreationTX{} -> tx{transactionChainId = Nothing}
            PrivateHashTX{} -> tx
      otx <- (\o -> o{otBaseTx = clearChainId (otBaseTx o), otOrigin = Origin.API}) <$> liftIO (generate arbitrary)
      let runForTwoSeconds = timeout 2000000
          run = runForTwoSeconds $ runConnection connection
          postTxEvent = threadDelay 500000 >> (atomically $ writeTMChan (_p2pPeerSeqP2pSource server') (Right $ P2pTx otx))
      concurrently_ run postTxEvent
      serverCtx <- readTVarIO $ server' ^. p2pTestContext
      clientCtx <- readTVarIO $ client' ^. p2pTestContext
      _unseqEvents serverCtx `shouldBe` []
      let clientTxs = [t | IETx _ (IngestTx _ t) <- _unseqEvents clientCtx]
      clientTxs `shouldBe` [otBaseTx otx]

    it "should update the round number on every node in the network" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..7]
      let validatorsPrivKeys' = take 2 privKeys
          validatorAddresses = makeValidators validatorsPrivKeys'
      peers <- traverse (\(p,(n,i)) -> createPeer' p validatorAddresses n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        , ("node4", "13.14.15.16")
        , ("node5", "17.18.19.20")
        , ("node6", "21.22.23.24")
        , ("node7", "25.26.27.28")
        ]
      let validators' = take 2 peers
      connections' <- traverse (uncurry createConnection)
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
      let runForTwoSeconds = void . timeout 2000000
          postTimeoutEvent = do
            threadDelay 1000000
            for_ validators' $ postEvent (TimerFire 0)
      runForTwoSeconds $ concurrently_ (runNetwork peers connections') postTimeoutEvent
      ctxs <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1 :: Maybe Word256)


    it "should update the round number after failing on a divided network first" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
      let validatorsPrivKeys' = privKeys
          primaryValidatorsPrivKeys = [head validatorsPrivKeys']
          primaryValidatorAddresses = makeValidators primaryValidatorsPrivKeys
          validatorAddresses = makeValidators validatorsPrivKeys'
      peers <- traverse (\(p,(n,i)) -> createPeer' p primaryValidatorAddresses n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      let validators' = peers
          primaryValidators = [head validators']
          secondaryValidators = tail validators'
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      atomically $ modifyTVar' ((peers !! 1) ^. p2pTestContext)
                               ( (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
                               . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000))
      atomically $ modifyTVar' ((peers !! 2) ^. p2pTestContext)
                               ( (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
                               . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000))
      let runForTwoSeconds = void . timeout 2000000
          postTimeoutPrimary1 = do
            threadDelay 1000000
            for_ primaryValidators $ postEvent (TimerFire 0)
          postTimeoutPrimary2 = do
            threadDelay 1000000
            for_ primaryValidators $ postEvent (TimerFire 1)
          postTimeoutSecondary = do
            threadDelay 1000000
            for_ secondaryValidators $ postEvent (TimerFire 1000)
      runForTwoSeconds $ concurrently_ (runNetwork peers connections') (concurrently_ postTimeoutPrimary1 postTimeoutSecondary)
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs1 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, if i == 0 then Just (1 :: Word256) else Just 1000)
      atomically $ modifyTVar' ((peers !! 0) ^. p2pTestContext)
                               (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
      runForTwoSeconds $ concurrently_ (runNetwork peers connections') (concurrently_ postTimeoutPrimary2 postTimeoutSecondary)
      ctxs2 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs2 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1001 :: Maybe Word256)

    it "can add a new node to a chain" $ do
      let Right privKey = bsToPriv "-----BEGIN EC PRIVATE KEY-----\nMC4CAQEEIAK4aeMOUuoDv/zOIBypht779qzK44JWbxl2lA7id/amoAcGBSuBBAAK\n-----END EC PRIVATE KEY-----"
      nodePrivKeys <- (privKey:) <$> traverse (const newPrivateKey) [(2 :: Integer)..3]
      let nodePubKeys = derivePublicKey <$> nodePrivKeys
          nodeCertInfos = [ ("BlockApps", "Engineering", "James Hormuzdiar", nodePubKeys !! 0)
                          , ("Microsoft", "Sales", "Bob Smith", nodePubKeys !! 1)
                          , ("Amazon", "CEO", "Jeffrey Bezos", nodePubKeys !! 2)
                          ]
      let validators' = makeValidators nodePrivKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip nodePrivKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      connections <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      let runForSeconds n = void . timeout (n * 1000000)
      let src =  [r|
contract BlockAppsCertificateRegistry {
  event CertificateRegistered(string cert);
  constructor(string _rootCert) {
    emit CertificateRegistered(_rootCert);
  }

  function registerCertificate(string _cert) {
    new Certificate(_cert);
  }
}

contract Certificate {
    address owner;  // The CertificateRegistery Contract
    string public certificateString;
    event CertificateRegistered(string cert);

    constructor(string _certificateString) {
        owner = msg.sender;
        certificateString = _certificateString;
        emit CertificateRegistered(_certificateString);
    }
}
|]
          contractName = "BlockAppsCertificateRegistry"
      let issuer = Issuer
            { issCommonName = "Admin"
            , issOrg        = "BlockApps"
            , issUnit       = Just "Engineering"
            , issCountry    = Just "USA"
            }
          subjects = (\(org, unit, cn, pub) -> Subject
            { subCommonName = cn
            , subOrg        = org
            , subUnit       = Just unit
            , subCountry    = Just "USA"
            , subPub        = pub
            }) <$> nodeCertInfos
      putStrLn $ show rootCert
      certs <- traverse (\subject -> fmap (T.pack . BC.unpack . certToBytes) $ runReaderT (makeSignedCert Nothing (Just rootCert) issuer subject) privKey) subjects

      let --args addr cert = "(0x" <> T.pack (formatAddressWithoutColor addr) <> ", \"" <> cert <> "\")"
          utx0 = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack src
            , U.unsignedTransactionChainId    = Nothing
            }
          rootCertStr = T.pack . BC.unpack $ certToBytes rootCert
          txMd = M.fromList [("VM", "SolidVM"), ("src", src), ("name", contractName), ("args", "(\"" <> rootCertStr <> "\")")]
          addMd t = t{transactionMetadata = Just txMd}
          signedTx0 = addMd $ mkSignedTx privKey utx0
      let args1 cert = "(\"" <> cert <> "\")"
          utx1 cert i = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce i
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ getNewAddress_unsafe (fromPrivateKey privKey) 0
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack $ T.unpack $ args1 cert
            , U.unsignedTransactionChainId    = Nothing
            }
          txMd1 cert = M.fromList [("VM", "SolidVM"), ("funcName", "registerCertificate"), ("args", args1 cert)]
          addMd1 cert t = t{transactionMetadata = Just $ txMd1 cert}
          signedTx1s = (\(cert,i) -> addMd1 cert . mkSignedTx privKey $ utx1 cert i) <$> zip certs [1..]

      let privChainSrc = [r|
contract A {
  event OrgAdded(string orgName);
  function addMember(string _orgName) {
    emit OrgAdded(_orgName);
  }
}
|]
          privContractName = "A"
          chainMember1 :: ChainMembers
          chainMember1 = (ChainMembers $ Set.singleton $ (Org (T.pack "BlockApps") True))

          chainInfo' = ChainInfo
            UnsignedChainInfo { chainLabel     = "My test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode privContractName $ hash privChainSrc)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" privChainSrc $ Just privContractName]
                              , members        = chainMember1
                              , parentChain    = Nothing
                              , creationBlock  = zeroHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          chainId = keccak256ToWord256 $ rlpHash chainInfo'
      let args = "(\"Microsoft\")"
          privUtx' = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          tx'' = mkSignedTx (nodePrivKeys !! 0) privUtx'
          privTxMd = M.fromList [("funcName","addMember"),("args",args)]
          tx' = tx''{transactionMetadata = M.union privTxMd <$> transactionMetadata tx''}
      let mainChainRoute tx = do
            threadDelay 500000
            tsNow <- liftIO getCurrentMicrotime
            let ietx = IETx tsNow $ IngestTx Origin.API tx
            flip postEvent (peers !! 0) $ UnseqEvent ietx
          routine = do
            threadDelay 1000000
            for_ peers $ postEvent (TimerFire 0)
            threadDelay 1000000
            for_ peers $ postEvent (TimerFire 1)
            threadDelay 1000000
            for_ peers $ postEvent (TimerFire 2)
            threadDelay 500000
            tsNowMain <- liftIO getCurrentMicrotime
            let ietxMain = IETx tsNowMain $ IngestTx Origin.API signedTx0
            flip postEvent (peers !! 0) $ UnseqEvent ietxMain
            for_ signedTx1s $ mainChainRoute
            threadDelay 500000
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (chainId, chainInfo')
            threadDelay 500000
            tsNow <- liftIO getCurrentMicrotime
            let ietx = IETx tsNow $ IngestTx Origin.API tx'
            flip postEvent (peers !! 0) $ UnseqEvent ietx

      runForSeconds 15 $ concurrently_ (runNetwork peers connections) routine
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at chainId) `shouldBe` (i, if i == 2 then Nothing else Just chainInfo')

    it "can sync a new node to a chain after running multiple transactions on that chain" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
      let validators' = makeValidators privKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      connections <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]

      registryTs <- liftIO getCurrentMicrotime

      -- Create a certificate registry on the main chain
      let iss   = Issuer {  issCommonName = "Dustin Norwood"
                          , issOrg        = "BlockApps"
                          , issUnit       = Just "Engineering"
                          , issCountry    = Just "USA"
                          }
          subj  = Subject { subCommonName = "David Nallapu"
                          , subOrg        = "BlockApps"
                          , subUnit       = Just "Engineering"
                          , subCountry    = Just "USA"
                          , subPub        = derivePublicKey (privKeys !! 1)
                          }
      cert <- makeSignedCert Nothing (Just rootCert) iss subj
      let cert' = Text.decodeUtf8 . certToBytes $ cert
          args' = "(0x" <> (T.pack $ (formatAddressWithoutColor . fromPrivateKey) (privKeys !! 0)) <> ", \"" <> cert' <> "\")"
          registry = [r|
contract CertRegistry {
  event CertificateRegistered(string cert);
  
  constructor(address _user, string _cert) {
    emit CertificateRegistered(_cert);
  }
}
|]
          contractName' = "CertRegistry"
          txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
          addRegistryMd t =  t{transactionMetadata = M.union txMd' <$> transactionMetadata t}
          mkRegistryTx = addRegistryMd $ mkSignedTx (privKeys !! 0) (U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack registry
            , U.unsignedTransactionChainId    = Nothing
            })

      let src = [r|
contract A {
  event CommonNameAdded(string name, string unit, string commonName);
  uint x = 0;

  constructor() {}

  function addMember(string _name, string _unit, string _commonName) {
    emit CommonNameAdded(_name, _unit, _commonName);
  }

  function incX() {
    x++;
  }
}
|]
          contractName = "A"
--           mainChainSrc = [r|
-- contract B {
--   uint y;

--   constructor() {
--     y = 47;
--   }
-- }
-- |]
          -- mainChainContractName = "B"
          chainMember1 :: ChainMemberParsedSet
          chainMember1 = (CommonName (T.pack "BlockApps") (T.pack "Engineering") (T.pack "Dustin Norwood") True)
                              
          chainMember2 :: ChainMemberParsedSet
          chainMember2 = (CommonName (T.pack "BlockApps") (T.pack "Engineering") (T.pack "David Nallapu") True)

          mkChainInfo bHash = ChainInfo
            UnsignedChainInfo { chainLabel     = "My parent test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 , NonContract (validators' !! 1) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" src $ Just contractName]
                              , members        = ChainMembers (Set.fromList [chainMember1, chainMember2])
                              , parentChain    = Nothing
                              , creationBlock  = bHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          mkChainInfo2 bHash pChain = ChainInfo
            UnsignedChainInfo { chainLabel     = "My child test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" src $ Just contractName]
                              , members        = ChainMembers (Set.fromList [chainMember1])
                              , parentChain    = Just pChain
                              , creationBlock  = bHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          mkChainId = keccak256ToWord256 . rlpHash
      ts <- liftIO getCurrentMicrotime
      let incXArgs = "()"
          incXUtx chainId = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          incXUtx0 chainId = (incXUtx chainId)
          incXUtx1 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 1}
          incXUtx2 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 2}
          incXUtx3 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 3}
          incXUtx4 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 4}
          txMd = M.fromList [("funcName","incX"),("args",incXArgs)]
          addMd t = t{transactionMetadata = M.union txMd <$> transactionMetadata t}
          incXTx0 = addMd . mkSignedTx (privKeys !! 0) . incXUtx0
          incXTx1 = addMd . mkSignedTx (privKeys !! 0) . incXUtx1
          incXTx2 = addMd . mkSignedTx (privKeys !! 0) . incXUtx2
          incXTx3 = addMd . mkSignedTx (privKeys !! 0) . incXUtx3
          incXTx4 = addMd . mkSignedTx (privKeys !! 0) . incXUtx4
      -- let mainChainArgs = "()"
      --     mainChainUtx = U.UnsignedTransaction
      --       { U.unsignedTransactionNonce      = Nonce 0
      --       , U.unsignedTransactionGasPrice   = Wei 1
      --       , U.unsignedTransactionGasLimit   = Gas 1000000000
      --       , U.unsignedTransactionTo         = Nothing
      --       , U.unsignedTransactionValue      = Wei 0
      --       , U.unsignedTransactionInitOrData = Code $ BC.pack mainChainSrc
      --       , U.unsignedTransactionChainId    = Nothing
      --       }
      --     mainChainTxMd = M.fromList [("src", mainChainSrc), ("name", mainChainContractName), ("args", mainChainArgs)]
      --     mainChainAddMd t = t{transactionMetadata = M.union mainChainTxMd <$> transactionMetadata t}
      --     mkMainChainTx n = let utx = mainChainUtx{U.unsignedTransactionNonce = Nonce n}
      --                        in mainChainAddMd $ mkSignedTx (privKeys !! 0) utx
      cIdRef <- newIORef undefined
      cInfoRef <- newIORef undefined
      cId2Ref <- newIORef undefined
      cInfo2Ref <- newIORef undefined
      let addMemberArgs = "(" <> "\"BlockApps\", \"Engineering\", \"David Nallapu\")"
          addMemberUtx chainId = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 5
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          addMemberTxMd = M.fromList [("funcName","addMember"),("args",addMemberArgs)]
          addMemberMd t = t{transactionMetadata = M.union addMemberTxMd <$> transactionMetadata t}
          addMemberTx cId = addMemberMd $ mkSignedTx (privKeys !! 0) (addMemberUtx cId)
          toIetx = IETx ts . IngestTx Origin.API
          -- mainChainRoutine n = do
          --   threadDelay 200000
          --   flip postEvent (peers !! 0) . UnseqEvent . toIetx $ mkMainChainTx n
          --   mainChainRoutine $ n + 1
          routine = do
            threadDelay 5000000
            for_ peers $ postEvent (TimerFire 0)
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ IETx registryTs $ IngestTx Origin.API mkRegistryTx
            bHash <- fmap (bestBlockHash . _bestBlock) . readTVarIO . _p2pTestContext $ peers !! 0
            let cInfo = mkChainInfo bHash
                cId = mkChainId cInfo
            writeIORef cIdRef cId
            writeIORef cInfoRef cInfo
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId, cInfo)
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx0 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx1 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx2 cId
            bHash2 <- fmap (bestBlockHash . _bestBlock) . readTVarIO . _p2pTestContext $ peers !! 0
            let cInfo2 = mkChainInfo2 bHash2 cId
                cId2 = mkChainId cInfo2
            writeIORef cId2Ref cId2
            writeIORef cInfo2Ref cInfo2
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId2, cInfo2)
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx3 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx0 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx1 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx2 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx4 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx3 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx4 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ addMemberTx cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ addMemberTx cId2

      void . timeout 100000000 $ concurrently_ (runNetwork peers connections) routine
      cId <- readIORef cIdRef
      cInfo <- readIORef cInfoRef
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at cId) `shouldBe` (i, if i == 2 then Nothing else Just cInfo)
      cId2 <- readIORef cId2Ref
      cInfo2 <- readIORef cInfo2Ref
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at cId2) `shouldBe` (i, if i == 2 then Nothing else Just cInfo2)
      --privKey4 <- newPrivateKey
      --peer4 <- createPeer privKey4 validators' unseqSink "node4" "13.14.15.16"
      --let peers' = peers ++ [peer4]
      --connections4 <- traverse (uncurry createConnection)
      --  [ (peers' !! 0, peers' !! 3)
      --  , (peers' !! 1, peers' !! 3)
      --  , (peers' !! 2, peers' !! 3)
      --  ]
      --let connections' = connections ++ connections4

    it "can register and unregister a cert on the main chain" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..2]
      let globalAdmin = privKeys !! 0
          orgAdmin = privKeys !! 1
          validators' = makeValidators privKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        ]
      connections <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        ]
      let src = [r|

contract RegisterCert {
  event CertificateRegistered(string cert);

  constructor(address _user, string _cert) {
    emit CertificateRegistered(_cert);
  }
}
|]
          contractName = "RegisterCert"
      ts <- liftIO getCurrentMicrotime
      let testCert1 = "-----BEGIN CERTIFICATE-----\nMIIB0jCCAXegAwIBAgIQeEdWygiiwHQ9e5bfkQVdVTAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYy\nMzg4NzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMTkxNTE2MzZaFw0yMjEwMTkxNTE2MzZaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYyMzg4\nNzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLsHOfw6jXFjQRAoLVDLwsmr\nKtHn5O6Cisa47lzxV0NfXVJXCcVP2N95GAB5/pmLsmE8rcdLQVBQFLWPjhGoCQ4w\nDAYIKoZIzj0EAwIFAANHADBEAiAChH6dQTLS/F/lNt7JkjMpC0uo6MEFI+zV5hCB\noNnc1gIgaMpLif4qKPRfAFjQJCJR8ORV1PEXf9xBK7XtPONqDQ0=\n-----END CERTIFICATE-----"
          emptyCert = "-----BEGIN CERTIFICATE-----\nMIIBVDCB+aADAgECAhBPjHUswOXtDsbDeQIsdepkMAwGCCqGSM49BAMCBQAwLDEJ\nMAcGA1UEAwwAMQkwBwYDVQQKDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMB4XDTIx\nMDUyNTE1MzQxNVoXDTIyMDUyNTE1MzQxNVowLDEJMAcGA1UEAwwAMQkwBwYDVQQK\nDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE\n4X1p4KE8cB6vYqKzSHIl+V5fDUC9p0j8OfOQOUhCfkjG1ALuRyP68tTohz9TLPLk\nYCVKrCiueuZJbejnGsp21TAMBggqhkjOPQQDAgUAA0gAMEUCIQCVtizg/N3MBdLi\nfHto7tqu1ia6cZpMI/G2bLWSPErK9AIgcBw+S8iVqSjh61CkgBAS066Z7M/W9eeY\n+sm9OKHDfQQ=\n-----END CERTIFICATE-----"
          args addr cert = "(0x" <> T.pack (formatAddressWithoutColor addr) <> ", \"" <> cert <> "\")"
          utx = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack src
            , U.unsignedTransactionChainId    = Nothing
            }
          txMd addr cert = M.fromList [("src", src), ("name", contractName), ("args", args addr cert)]
          addMd addr cert t = t{transactionMetadata = M.union (txMd addr cert) <$> transactionMetadata t}
          mkTx pSigner pCert n =
            let utx' = utx{U.unsignedTransactionNonce = Nonce n}
                addr = fromPrivateKey pCert
             in addMd addr testCert1 $ mkSignedTx pSigner utx'
          mkEmptyTx pSigner pCert n =
            let utx' = utx{U.unsignedTransactionNonce = Nonce n}
                addr = fromPrivateKey pCert
             in addMd addr emptyCert $ mkSignedTx pSigner utx'
          toIetx = IETx ts . IngestTx Origin.API
          routine = do
            threadDelay 200000
            for_ peers $ postEvent (TimerFire 0)
            threadDelay 200000
            for_ peers $ postEvent (TimerFire 1)
            threadDelay 200000
            let tx1 = mkTx globalAdmin orgAdmin 0
                tx2 = mkEmptyTx orgAdmin orgAdmin 0
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx tx1
            threadDelay 1000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx tx2
      void . timeout 5000000 $ concurrently_ (runNetwork peers connections) routine
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty

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

  describe "Private Chain Authorization" $ do
    describe "X.509 Private Chain exchange" $ do
      it "can add an organization to a private chain" $ do
          privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
          let validators' = makeValidators privKeys
          peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
            [ ("node1", "1.2.3.4")
            , ("node2", "5.6.7.8")
            , ("node3", "9.10.11.12")
            ]
          connections <- traverse (uncurry createConnection)
            [ (peers !! 0, peers !! 1)
            , (peers !! 0, peers !! 2)
            , (peers !! 1, peers !! 2)
            ]
          ts <- liftIO getCurrentMicrotime
          dt <- liftIO dateCurrent
          cIdRef <- newIORef undefined
          cInfoRef <- newIORef undefined
          let runForTwelveSeconds = void . timeout 12000000
              -- enode1 = readEnode "enode://abcd@1.2.3.4:30303"
              chainMember1 :: ChainMembers
              chainMember1 = (ChainMembers $ Set.singleton $ (CommonName (T.pack "BlockApps") (T.pack "Engineering") (T.pack "David Nallapu") True))
           
              toIetx = IETx ts . IngestTx Origin.API
              mkChainId = keccak256ToWord256 . rlpHash

          -- Create a certificate registry on the main chain
              iss   = Issuer {  issCommonName = "Dustin"
                              , issOrg        = "BlockApps"
                              , issUnit       = Just "Engineering"
                              , issCountry    = Just "USA"
                              }
              subj  = Subject { subCommonName = "Garrett"
                              , subOrg        = "BlockApps"
                              , subUnit       = Just "Engineering"
                              , subCountry    = Just "USA"
                              , subPub        = derivePublicKey (privKeys !! 1)
                              } 
          cert <- makeSignedCert (Just dt) (Just rootCert) iss subj
          let cert' = Text.decodeUtf8 . certToBytes $ cert
              args' = "(\"" <> cert' <>"\")"
              registry = [r|
                    contract CertRegistry {
                      event CertificateRegistered(string cert);

                      constructor(string _cert) {
                        emit CertificateRegistered(_cert);
                      }
                    }
                    |]
              contractName' = "CertRegistry"
              txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
              addMd' t = t{transactionMetadata = M.union txMd' <$> transactionMetadata t}
              mkRegistryTx = addMd' . mkSignedTx (privKeys !! 0) $ U.UnsignedTransaction
                { U.unsignedTransactionNonce      = Nonce 0
                , U.unsignedTransactionGasPrice   = Wei 1
                , U.unsignedTransactionGasLimit   = Gas 1000000000
                , U.unsignedTransactionTo         = Nothing
                , U.unsignedTransactionValue      = Wei 0
                , U.unsignedTransactionInitOrData = Code $ BC.pack registry
                , U.unsignedTransactionChainId    = Nothing
                }

              -- Post a mock dApp to a private chain
              src = [r|
                    contract A {
                      event OrgUnitAdded(string name, string unit);

                      constructor() {}

                      function addOrg(string _name, string _unit) {
                        emit OrgUnitAdded(_name, _unit);
                      }
                    }
                    |]
              contractName = "A"
              args = "(" <> "\"BlockApps\"" <> ", \"Engineering\"" <> ")"
              txMd = M.fromList [("funcName", "addOrg"), ("args", args)]
              addMd t = t{transactionMetadata = M.union txMd <$> transactionMetadata t}
              tChainInfo = ChainInfo
                UnsignedChainInfo { chainLabel     = "My organization's private chain"
                                  , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                    , NonContract (validators' !! 0) 1000000000000000000000
                                                    , NonContract (validators' !! 1) 1000000000000000000000
                                                    ]
                                  , codeInfo       = [CodeInfo "" src $ Just contractName]
                                  , members        = chainMember1
                                  , parentChain    = Nothing
                                  , creationBlock  = zeroHash
                                  , chainNonce     = 123456789
                                  , chainMetadata  = M.singleton "VM" "SolidVM"
                                  }
                Nothing
              setupTx cId = U.UnsignedTransaction
                { U.unsignedTransactionNonce      = Nonce 0
                , U.unsignedTransactionGasPrice   = Wei 1
                , U.unsignedTransactionGasLimit   = Gas 1000000000
                , U.unsignedTransactionTo         = Just $ Address 0x100
                , U.unsignedTransactionValue      = Wei 0
                , U.unsignedTransactionInitOrData = Code ""
                , U.unsignedTransactionChainId    = Just $ ChainId cId
                }
              signedPrivTx = addMd . mkSignedTx (privKeys !! 0) . setupTx

              routine = do
                threadDelay 200000
                for_ peers $ postEvent (TimerFire 0)
                threadDelay 200000
                flip postEvent (peers !! 0) . UnseqEvent $ toIetx mkRegistryTx    -- Post cert registry contract to the main chain
                threadDelay 200000
                let cInfo = tChainInfo
                    cId = mkChainId cInfo
                writeIORef cIdRef cId
                writeIORef cInfoRef cInfo
                flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId, cInfo)  -- Post private chain
                threadDelay 200000
                flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ signedPrivTx cId -- Add organization to private chain

          runForTwelveSeconds $ concurrently_ (runNetwork peers connections) routine
          ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
          testCid <- readIORef cIdRef

          -- Cert should be inserted into every node
          for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty

          -- Node 1's cert was registered in the contract so it should receive the chain ID
          (ctxs1 !! 1) ^. trueOrgNameChainsMap `shouldBe`
            M.singleton (ChainMembers $ Set.singleton $ (OrgUnit (T.pack "BlockApps") (T.pack "Engineering") True)) (TrueOrgNameChains $ Set.singleton testCid)

          -- Node 2's cert is not registered so it should not have any in the set
          (ctxs1 !! 2) ^. trueOrgNameChainsMap `shouldBe` M.empty

          -- TODO: milliseconds to seconds => threadDelayInSeconds :: Seconds -> IO ()