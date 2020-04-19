{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
module EventSpec where

import           Conduit
import           Control.Lens                          hiding (Context)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Control.Monad.State
import           Crypto.PubKey.ECC.DH
import           Crypto.Random
import           Data.Conduit.TQueue                   hiding (newTQueueIO)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import           Text.Printf

import           Blockchain.Blockstanbul               (blockstanbulSender)
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.ECIES
import           Blockchain.Event
import           Blockchain.ExtWord
import           Blockchain.Options                    (AuthorizationMode(..))
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import           Blockchain.Strato.Model.SHA           (SHA, unsafeCreateSHAFromWord256)

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
  , _shaBlockDataMap       :: Map SHA DataDefs.BlockData
  , _worldBestBlock        :: WorldBestBlock
  , _bestBlock             :: BestBlock
  , _canonicalBlockDataMap :: Map Integer (Canonical DataDefs.BlockData)
  , _ipAddressIpChainsMap  :: Map IPAddress IPChains
  , _orgIdChainsMap        :: Map OrgId OrgIdChains
  , _shaChainTxsInBlockMap :: Map SHA ChainTxsInBlock
  , _chainMembersMap       :: Map Word256 ChainMembers
  , _chainInfoMap          :: Map Word256 ChainInfo
  , _privateTxMap          :: Map SHA (Private (Word256, OutputTx))
  , _shaOutputBlockMap     :: Map SHA OutputBlock
  , _genesisBlockHash      :: GenesisBlockHash
  , _bestBlockNumber       :: BestBlockNumber
  , _stringPPeerMap        :: Map String DataPeer.PPeer
  , _unseqEvents           :: [IngestEvent]
  }

makeLenses ''TestContext

type TestContextM = ReaderT (IORef TestContext) (ResourceT (LoggingT IO))

instance {-# OVERLAPPING #-} MonadIO m => MonadState TestContext (ReaderT (IORef TestContext) m) where
  state f = ask >>= liftIO . flip atomicModifyIORef' (swap . f)
    where swap ~(a,b) = (b,a)

instance MonadIO m => Stacks Block (ReaderT (IORef TestContext) m) where
  takeStack _ n = take n <$> use blocks
  pushStack bs  = do
    let maxNum = maximum $ DataDefs.blockDataNumber . blockBlockData <$> bs
    bestBlockNumber %= (\(BestBlockNumber n) -> BestBlockNumber $ max maxNum n)
    blocks %= (bs ++)

instance MonadIO m => (SHA `A.Alters` DataDefs.BlockData) (ReaderT (IORef TestContext) m) where
  lookup _ k   = M.lookup k <$> use shaBlockDataMap
  insert _ k v = shaBlockDataMap %= M.insert k v
  delete _ k   = shaBlockDataMap %= M.delete k

instance MonadIO m => Mod.Modifiable WorldBestBlock (ReaderT (IORef TestContext) m) where
  get _ = use worldBestBlock
  put _ = assign worldBestBlock

instance MonadIO m => Mod.Modifiable BestBlock (ReaderT (IORef TestContext) m) where
  get _ = use bestBlock
  put _ = assign bestBlock

instance MonadIO m => A.Selectable Integer (Canonical DataDefs.BlockData) (ReaderT (IORef TestContext) m) where
  select _ i = M.lookup i <$> use canonicalBlockDataMap

instance MonadIO m => A.Selectable IPAddress IPChains (ReaderT (IORef TestContext) m) where
  select _ ip = M.lookup ip <$> use ipAddressIpChainsMap

instance MonadIO m => A.Selectable OrgId OrgIdChains (ReaderT (IORef TestContext) m) where
  select _ ip = M.lookup ip <$> use orgIdChainsMap

instance MonadIO m => A.Selectable SHA ChainTxsInBlock (ReaderT (IORef TestContext) m) where
  select _ sha = M.lookup sha <$> use shaChainTxsInBlockMap

instance MonadIO m => A.Selectable Word256 ChainMembers (ReaderT (IORef TestContext) m) where
  select _ cid = M.lookup cid <$> use chainMembersMap

instance MonadIO m => A.Selectable Word256 ChainInfo (ReaderT (IORef TestContext) m) where
  select _ cid = M.lookup cid <$> use chainInfoMap

instance MonadIO m => A.Selectable SHA (Private (Word256, OutputTx)) (ReaderT (IORef TestContext) m) where
  select _ tx = M.lookup tx <$> use privateTxMap

instance MonadIO m => (SHA `A.Alters` OutputBlock) (ReaderT (IORef TestContext) m) where
  lookup _ k   = M.lookup k <$> use shaOutputBlockMap
  insert _ k v = shaOutputBlockMap %= M.insert k v
  delete _ k   = shaOutputBlockMap %= M.delete k

instance MonadIO m => Mod.Accessible GenesisBlockHash (ReaderT (IORef TestContext) m) where
  access _ = use genesisBlockHash

instance MonadIO m => Mod.Accessible BestBlockNumber (ReaderT (IORef TestContext) m) where
  access _ = use bestBlockNumber

instance MonadIO m => Mod.Modifiable ActionTimestamp (ReaderT (IORef TestContext) m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance MonadIO m => Mod.Accessible ActionTimestamp (ReaderT (IORef TestContext) m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [DataDefs.BlockData] (ReaderT (IORef TestContext) m) where
  get _ = use blockHeaders
  put _ = assign blockHeaders

instance MonadIO m => Mod.Accessible [DataDefs.BlockData] (ReaderT (IORef TestContext) m) where
  access _ = Mod.get (Mod.Proxy @[DataDefs.BlockData])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (ReaderT (IORef TestContext) m) where
  get _ = use remainingBlockHeaders
  put _ = assign remainingBlockHeaders

instance MonadIO m => Mod.Accessible RemainingBlockHeaders (ReaderT (IORef TestContext) m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Accessible MaxReturnedHeaders (ReaderT (IORef TestContext) m) where
  access _ = use maxReturnedHeaders

instance MonadIO m => Mod.Modifiable PeerAddress (ReaderT (IORef TestContext) m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance MonadIO m => Mod.Accessible PeerAddress (ReaderT (IORef TestContext) m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance MonadIO m => Mod.Accessible ConnectionTimeout (ReaderT (IORef TestContext) m) where
  access _ = use connectionTimeout

instance MonadIO m => A.Selectable String DataPeer.PPeer (ReaderT (IORef TestContext) m) where
  select _ tx = M.lookup tx <$> use stringPPeerMap

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
testContext :: TestContext
testContext = TestContext
  { _blocks                = []
  , _blockHeaders          = []
  , _remainingBlockHeaders = RemainingBlockHeaders []
  , _actionTimestamp       = emptyActionTimestamp
  , _connectionTimeout     = ConnectionTimeout 60
  , _maxReturnedHeaders    = MaxReturnedHeaders 1000
  , _peerAddr              = PeerAddress Nothing
  , _shaBlockDataMap       = M.empty
  , _worldBestBlock        = WorldBestBlock (BestBlock (unsafeCreateSHAFromWord256 0) (-1) 0)
  , _bestBlock             = BestBlock (unsafeCreateSHAFromWord256 0) (-1) 0
  , _canonicalBlockDataMap = M.empty
  , _ipAddressIpChainsMap  = M.empty
  , _orgIdChainsMap        = M.empty
  , _shaChainTxsInBlockMap = M.empty
  , _chainMembersMap       = M.empty
  , _chainInfoMap          = M.empty
  , _privateTxMap          = M.empty
  , _shaOutputBlockMap     = M.empty
  , _genesisBlockHash      = GenesisBlockHash (unsafeCreateSHAFromWord256 0)
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  , _unseqEvents           = []
  }

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

runTestPeer :: TestContextM a -> IO ()
runTestPeer f = do
  ctx <- newIORef testContext
  void . runNoLoggingT . runResourceT $ runReaderT f ctx

execTestPeer :: TestContextM a -> IO (a, TestContext)
execTestPeer f = do
  ctx <- newIORef testContext
  a <- runNoLoggingT . runResourceT $ runReaderT f ctx
  ctx' <- readIORef ctx
  return (a, ctx')

spec :: Spec
spec = do
  describe "network simulation" $ do
    it "should send a transaction from server to client" $ do
      entropyPool <- liftIO createEntropyPool
      let g = cprgCreate entropyPool :: SystemRNG
          serverPriv = fst $ generatePrivate g theCurve
          serverPub = calculatePublic theCurve serverPriv
          serverPeer = DataPeer.buildPeer (Just $ pointToString serverPub, "1.2.3.4", 30303)
          clientPriv = fst $ generatePrivate g theCurve
          clientPub = calculatePublic theCurve clientPriv
          clientPeer = DataPeer.buildPeer (Just $ pointToString clientPub, "5.6.7.8", 30303)
          clearChainId tx = case tx of
            MessageTX{} -> tx{transactionChainId = Nothing}
            ContractCreationTX{} -> tx{transactionChainId = Nothing}
            PrivateHashTX{} -> tx
          unseqSink ies = unseqEvents %= (++ ies)
      serverToClient <- newTQueueIO
      clientToServer <- newTQueueIO
      serverSeqSource <- newTQueueIO
      clientSeqSource <- newTQueueIO
      otx <- (\o -> o{otBaseTx = clearChainId (otBaseTx o), otOrigin = Origin.API}) <$> liftIO (generate arbitrary)
      let runServer = execTestPeer . timeout 2000000 $
            runEthServerConduit serverPriv
                                clientPeer
                                (sourceTQueue clientToServer)
                                (sinkTQueue serverToClient)
                                (sourceTQueue serverSeqSource)
                                unseqSink
                                "server"
          runClient = execTestPeer . timeout 2000000 $
            runEthClientConduit clientPriv
                                serverPeer
                                (sourceTQueue serverToClient)
                                (sinkTQueue clientToServer)
                                (sourceTQueue clientSeqSource)
                                unseqSink
                                "client"
          postTx = threadDelay 500000 >> (atomically $ writeTQueue serverSeqSource (P2pTx otx))
      ((_, serverCtx), (_, clientCtx)) <- fst <$> concurrently (concurrently runServer runClient) postTx
      _unseqEvents serverCtx `shouldBe` []
      let clientTxs = [t | IETx _ (IngestTx _ t) <- _unseqEvents clientCtx]
      clientTxs `shouldBe` [otBaseTx otx]
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
