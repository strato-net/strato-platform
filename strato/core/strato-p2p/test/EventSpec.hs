{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
module EventSpec where

import           Prelude hiding (round)
import           Conduit
import           Control.Concurrent.STM.TMChan
import           Control.Lens                          hiding (Context, view)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Control.Monad.State
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue                   hiding (newTQueueIO)
import           Data.Default                          (def)
import           Data.Foldable                         (for_, toList)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import qualified Data.Set                              as Set
import qualified Data.Set.Ordered                      as S
import qualified Data.Sequence                         as Q
import           Data.Text (Text)
import           Text.Printf

import           BlockApps.Logging
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Blockstanbul.Messages      (round)
import           Blockchain.Blockstanbul.StateMachine
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.BlockDB()
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.Event
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
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256     (Keccak256, zeroHash)
import           Blockchain.Strato.Model.Secp256k1

import           Executable.StratoP2PClient
import           Executable.StratoP2PServer


import           Test.Hspec
import qualified Test.Hspec.Expectations.Lifted        as L
import           Test.QuickCheck

import           UnliftIO
import           UnliftIO.Concurrent                   (threadDelay)

type WMRef = IORef (S.OSet Keccak256)

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
  , _worldBestBlock        :: WorldBestBlock
  , _bestBlock             :: BestBlock
  , _canonicalBlockDataMap :: Map Integer (Canonical DataDefs.BlockData)
  , _ipAddressIpChainsMap  :: Map IPAddress IPChains
  , _orgIdChainsMap        :: Map OrgId OrgIdChains
  , _shaChainTxsInBlockMap :: Map Keccak256 ChainTxsInBlock
  , _chainMembersMap       :: Map Word256 ChainMembers
  , _mockX509RedisDB       :: Map Address Address
  , _chainInfoMap          :: Map Word256 ChainInfo
  , _privateTxMap          :: Map Keccak256 (Private (Word256, OutputTx))
  , _genesisBlockHash      :: GenesisBlockHash
  , _bestBlockNumber       :: BestBlockNumber
  , _stringPPeerMap        :: Map String DataPeer.PPeer
  , _pbftMessages          :: WMRef
  , _outboundPbftMessages  :: S.OSet (Text, Keccak256)
  , _unseqEvents           :: [IngestEvent]
  , _sequencerContext      :: SequencerContext
  }

makeLenses ''TestContext

type TestContextM = ReaderT (IORef TestContext) (ResourceT (LoggingT IO))

type MonadTest m = ReaderT (IORef TestContext) m

instance {-# OVERLAPPING #-} MonadIO m => MonadState TestContext (MonadTest m) where
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
  get _ = use worldBestBlock
  put _ = assign worldBestBlock

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

instance MonadIO m => A.Selectable Address Address (MonadTest m) where
  select _ addr = M.lookup addr <$> use mockX509RedisDB

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


genericTestLookup :: (MonadState s m, Ord k)
                  => Lens' s (Map k (Modification a))
                  -> Mod.Proxy a
                  -> k
                  -> m (Maybe a)
genericTestLookup registry _ k = use (registry . at k) >>= \case
  Just (Modification a) -> pure $ Just a
  _ -> pure Nothing

genericTestInsert :: (MonadState s m, Ord k)
                  => Lens' s (Map k (Modification a))
                  -> Mod.Proxy a
                  -> k
                  -> a
                  -> m ()
genericTestInsert registry _ k a = registry . at k ?= Modification a

genericTestDelete :: (MonadState s m, Ord k)
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
    wms <- readIORef =<< use pbftMessages
    pure $ if S.member k wms then Just (A.Proxy @(Inbound WireMessage)) else Nothing
  insert _ k _ = use pbftMessages >>= flip atomicModifyIORef' (\wms ->
    let s = S.size wms
        wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
     in (wms'', ()))
  delete _ k = use pbftMessages >>= flip atomicModifyIORef' (\wms -> (S.delete k wms, ()))

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
testContext :: WMRef -> PrivateKey -> SequencerContext -> TestContext
testContext wireMessagesRef prv ctx = TestContext
  { _blocks                = []
  , _blockHeaders          = []
  , _remainingBlockHeaders = RemainingBlockHeaders []
  , _actionTimestamp       = emptyActionTimestamp
  , _connectionTimeout     = ConnectionTimeout 60
  , _maxReturnedHeaders    = MaxReturnedHeaders 1000
  , _peerAddr              = PeerAddress Nothing
  , _prvKey                = prv
  , _shaBlockDataMap       = M.empty
  , _worldBestBlock        = WorldBestBlock (BestBlock zeroHash (-1) 0)
  , _bestBlock             = BestBlock zeroHash (-1) 0
  , _canonicalBlockDataMap = M.empty
  , _ipAddressIpChainsMap  = M.empty
  , _orgIdChainsMap        = M.empty
  , _shaChainTxsInBlockMap = M.empty
  , _chainMembersMap       = M.empty
  , _mockX509RedisDB       = M.empty
  , _chainInfoMap          = M.empty
  , _privateTxMap          = M.empty
  , _genesisBlockHash      = GenesisBlockHash zeroHash
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  , _pbftMessages          = wireMessagesRef
  , _outboundPbftMessages  = S.empty
  , _unseqEvents           = []
  , _sequencerContext      = ctx
  }

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

runTestPeer :: TestContextM a -> IO ()
runTestPeer f = do
  seqCtx <- newSequencerContext emptyBlockstanbulContext
  wmr <- newIORef (S.empty)
  ctx <- newIORef $ testContext wmr undefined seqCtx
  void . runNoLoggingT . runResourceT $ runReaderT f ctx

execTestPeer :: PrivateKey
             -> WMRef
             -> [Address]
             -> TestContextM a
             -> IO (a, TestContext)
execTestPeer = execTestPeerOnRound 0

execTestPeerOnRound :: Word256
                    -> PrivateKey
                    -> WMRef
                    -> [Address]
                    -> TestContextM a
                    -> IO (a, TestContext)
execTestPeerOnRound n pk wmr as f = do
  seqCtx <- newSequencerContext $ (view . round .~ n) (newBlockstanbulContext (fromPrivateKey pk) as)
  ctx <- newIORef $ testContext wmr pk seqCtx
  a <- runLoggingT . runResourceT $ runReaderT f ctx
  ctx' <- readIORef ctx
  return (a, ctx')

execTestPeerWithContext :: TestContextM a -> TestContext -> IO (a, TestContext)
execTestPeerWithContext f ctx = do
  ref <- newIORef ctx
  a <- runLoggingT . runResourceT $ runReaderT f ref
  ctx' <- readIORef ref
  return (a, ctx')

data P2PPeer m = P2PPeer
  { _p2pPeerPrivKey     :: PrivateKey
  , _p2pPeerPPeer       :: DataPeer.PPeer
  , _p2pPeerWireMessageRef :: WMRef
  , _p2pPeerUnseqSource :: TQueue SeqLoopEvent
  , _p2pPeerSeqSource   :: TMChan P2pEvent
  , _p2pPeerUnseqSink   :: [IngestEvent] -> m ()
  , _p2pPeerName        :: String
  , _p2pPeerSequencer   :: m ()
  }

createPeer :: Seq.MonadSequencer m
           => ([IngestEvent] -> m ())
           -> String
           -> String
           -> IO (P2PPeer m)
createPeer unseqSink name ipAddr = do
  privKey <- newPrivateKey
  wmr <- newIORef (S.empty)
  unseqSource <- newTQueueIO
  seqSource <- newBroadcastTMChanIO
  let sequencer = runConduit $ sourceTQueue unseqSource
                            .| mapMC (Seq.runSequencerBatch . (:[]))
                            .| (awaitForever $ yieldMany . Seq._toP2p)
                            .| sinkTMChan seqSource
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
    wmr
    unseqSource
    seqSource
    unseq
    name
    sequencer

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
  serverSeqSource <- atomically . dupTMChan $ _p2pPeerSeqSource server
  clientSeqSource <- atomically . dupTMChan $ _p2pPeerSeqSource client
  let runServer = runEthServerConduit (_p2pPeerPPeer client)
                                      (sourceTQueue clientToServer)
                                      (sinkTQueue serverToClient)
                                      (sourceTMChan serverSeqSource)
                                      (_p2pPeerUnseqSink server)
                                      (_p2pPeerName server ++ " -> " ++ _p2pPeerName client)
      runClient = runEthClientConduit (_p2pPeerPPeer server)
                                      (sourceTQueue serverToClient)
                                      (sinkTQueue clientToServer)
                                      (sourceTMChan clientSeqSource)
                                      (_p2pPeerUnseqSink client)
                                      (_p2pPeerName client ++ " -> " ++ _p2pPeerName server)
  pure $ P2PConnection
    serverToClient
    clientToServer
    server
    client
    runServer
    runClient

runConnectionWith :: (PrivateKey -> WMRef -> m (Maybe SomeException) -> IO b) 
                  -> P2PConnection m 
                  -> IO (b, b)
runConnectionWith f connection =
  let server = _serverP2PPeer connection
      client = _clientP2PPeer connection
      runServer = f (_p2pPeerPrivKey server) (_p2pPeerWireMessageRef server) $ _runServer connection
      runClient = f (_p2pPeerPrivKey client) (_p2pPeerWireMessageRef client) $ _runClient connection
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
      let runForTwoSeconds pk wmr = execTestPeer pk wmr validatorAddresses . timeout 2000000
          run = runConnectionWith runForTwoSeconds connection
          postTx = threadDelay 500000 >> (atomically $ writeTMChan (_p2pPeerSeqSource server) (P2pTx otx))
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
          runForTwoSeconds :: PrivateKey -> WMRef -> TestContextM a -> IO TestContext
          runForTwoSeconds pk wmr = fmap snd . execTestPeer pk wmr validatorAddresses . timeout 2000000
          runSequencers = mapConcurrently (\p -> runForTwoSeconds (_p2pPeerPrivKey p) (_p2pPeerWireMessageRef p) (_p2pPeerSequencer p)) peers
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
          runForTwoSecondsPrimary :: Word256 -> PrivateKey -> WMRef -> TestContextM a -> IO TestContext
          runForTwoSecondsPrimary n pk wmr = fmap snd . execTestPeerOnRound n pk wmr primaryValidatorAddresses . timeout 2000000
          runForTwoSecondsSecondary :: Word256 -> PrivateKey -> WMRef -> TestContextM a -> IO TestContext
          runForTwoSecondsSecondary n pk wmr = fmap snd . execTestPeerOnRound n pk wmr validatorAddresses . timeout 2000000
          runForTwoSecondsWithContext :: TestContext -> TestContextM a -> IO TestContext
          runForTwoSecondsWithContext ctx = fmap snd . flip execTestPeerWithContext ctx . timeout 2000000
          runSequencersPrimary1 = mapConcurrently (\p -> runForTwoSecondsPrimary 0 (_p2pPeerPrivKey p) (_p2pPeerWireMessageRef p) (_p2pPeerSequencer p)) primaryValidators
          runSequencersSecondary = mapConcurrently (\p -> runForTwoSecondsSecondary 1000 (_p2pPeerPrivKey p) (_p2pPeerWireMessageRef p) (_p2pPeerSequencer p)) secondaryValidators
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
