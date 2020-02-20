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
import           Control.Monad.State
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import           Text.Printf

import           Blockchain.Blockstanbul               (blockstanbulSender)
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders, maxReturnedHeaders, connectionTimeout, unseqSink, vmEventsSink)
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.Wire
import           Blockchain.Event
import           Blockchain.ExtWord
import           Blockchain.Options                    (AuthorizationMode(..))
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Stream.VMEvent
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import           Blockchain.Strato.Model.SHA           (SHA(..))

import           Test.Hspec
import qualified Test.Hspec.Expectations.Lifted        as L
import           Test.QuickCheck

data TestContext = TestContext
  { _unseqSink             :: [[IngestEvent]]
  , _vmEventsSink          :: [[VMEvent]]
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
  }

makeLenses ''TestContext

type TestContextM = StateT TestContext (ResourceT (LoggingT IO))

instance Monad m => (SHA `A.Alters` DataDefs.BlockData) (StateT TestContext m) where
  lookup _ k   = M.lookup k <$> use shaBlockDataMap
  insert _ k v = shaBlockDataMap %= M.insert k v
  delete _ k   = shaBlockDataMap %= M.delete k

instance Monad m => Mod.Modifiable WorldBestBlock (StateT TestContext m) where
  get _ = use worldBestBlock
  put _ = assign worldBestBlock

instance Monad m => Mod.Modifiable BestBlock (StateT TestContext m) where
  get _ = use bestBlock
  put _ = assign bestBlock

instance Monad m => A.Selectable Integer (Canonical DataDefs.BlockData) (StateT TestContext m) where
  select _ i = M.lookup i <$> use canonicalBlockDataMap

instance Monad m => A.Selectable IPAddress IPChains (StateT TestContext m) where
  select _ ip = M.lookup ip <$> use ipAddressIpChainsMap

instance Monad m => A.Selectable OrgId OrgIdChains (StateT TestContext m) where
  select _ ip = M.lookup ip <$> use orgIdChainsMap

instance Monad m => A.Selectable SHA ChainTxsInBlock (StateT TestContext m) where
  select _ sha = M.lookup sha <$> use shaChainTxsInBlockMap

instance Monad m => A.Selectable Word256 ChainMembers (StateT TestContext m) where
  select _ cid = M.lookup cid <$> use chainMembersMap

instance Monad m => A.Selectable Word256 ChainInfo (StateT TestContext m) where
  select _ cid = M.lookup cid <$> use chainInfoMap

instance Monad m => A.Selectable SHA (Private (Word256, OutputTx)) (StateT TestContext m) where
  select _ tx = M.lookup tx <$> use privateTxMap

instance Monad m => (SHA `A.Alters` OutputBlock) (StateT TestContext m) where
  lookup _ k   = M.lookup k <$> use shaOutputBlockMap
  insert _ k v = shaOutputBlockMap %= M.insert k v
  delete _ k   = shaOutputBlockMap %= M.delete k

instance Monad m => Mod.Accessible GenesisBlockHash (StateT TestContext m) where
  access _ = use genesisBlockHash

instance Monad m => Mod.Accessible BestBlockNumber (StateT TestContext m) where
  access _ = use bestBlockNumber

instance Monad m => Mod.Modifiable ActionTimestamp (StateT TestContext m) where
  get _ = use actionTimestamp
  put _ = assign actionTimestamp

instance Monad m => Mod.Accessible ActionTimestamp (StateT TestContext m) where
  access _ = Mod.get (Mod.Proxy @ActionTimestamp)

instance Monad m => Mod.Modifiable [DataDefs.BlockData] (StateT TestContext m) where
  get _ = use blockHeaders
  put _ = assign blockHeaders

instance Monad m => Mod.Accessible [DataDefs.BlockData] (StateT TestContext m) where
  access _ = Mod.get (Mod.Proxy @[DataDefs.BlockData])

instance Monad m => Mod.Modifiable RemainingBlockHeaders (StateT TestContext m) where
  get _ = use remainingBlockHeaders
  put _ = assign remainingBlockHeaders

instance Monad m => Mod.Accessible RemainingBlockHeaders (StateT TestContext m) where
  access _ = Mod.get (Mod.Proxy @RemainingBlockHeaders)

instance Monad m => Mod.Accessible MaxReturnedHeaders (StateT TestContext m) where
  access _ = use maxReturnedHeaders

instance Monad m => Mod.Modifiable PeerAddress (StateT TestContext m) where
  get _ = use peerAddr
  put _ = assign peerAddr

instance Monad m => Mod.Accessible PeerAddress (StateT TestContext m) where
  access _ = Mod.get (Mod.Proxy @PeerAddress)

instance Monad m => Mod.Accessible ConnectionTimeout (StateT TestContext m) where
  access _ = use connectionTimeout

instance Monad m => Mod.Accessible (UnseqSink (StateT TestContext m)) (StateT TestContext m) where
  access _ = return $ \e -> unseqSink %= (e:)

instance Monad m => HasVMEventsSink (StateT TestContext m) where
  getVMEventsSink = return $ \v -> vmEventsSink %= (v:)

instance Monad m => A.Selectable String DataPeer.PPeer (StateT TestContext m) where
  select _ tx = M.lookup tx <$> use stringPPeerMap

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
testContext :: TestContext
testContext = TestContext
  { _unseqSink             = []
  , _vmEventsSink          = []
  , _blockHeaders          = []
  , _remainingBlockHeaders = RemainingBlockHeaders []
  , _actionTimestamp       = emptyActionTimestamp
  , _connectionTimeout     = ConnectionTimeout 60
  , _maxReturnedHeaders    = MaxReturnedHeaders 1000
  , _peerAddr              = PeerAddress Nothing
  , _shaBlockDataMap       = M.empty
  , _worldBestBlock        = WorldBestBlock (BestBlock (SHA 0) (-1) 0)
  , _bestBlock             = BestBlock (SHA 0) (-1) 0
  , _canonicalBlockDataMap = M.empty
  , _ipAddressIpChainsMap  = M.empty
  , _orgIdChainsMap        = M.empty
  , _shaChainTxsInBlockMap = M.empty
  , _chainMembersMap       = M.empty
  , _chainInfoMap          = M.empty
  , _privateTxMap          = M.empty
  , _shaOutputBlockMap     = M.empty
  , _genesisBlockHash      = GenesisBlockHash (SHA 0)
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  }

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

runTestPeer :: TestContextM a -> IO ()
runTestPeer = void . runNoLoggingT . runResourceT . flip runStateT testContext

spec :: Spec
spec = do
  describe "environment sanity checks" $ do
    it "can pretend to write to kafka" $ do
      quickCheck . once $ \ori txs -> runTestPeer $ emitKafkaTransactions ori txs
      quickCheck . once $ \ori blk -> runTestPeer $ emitKafkaBlock ori blk

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
           `L.shouldReturn` []
        unseqEvents <- use unseqSink
        unseqEvents `L.shouldBe` [[IEBlockstanbul wm]]
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
