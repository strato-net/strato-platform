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
module EventSpec where

import           Prelude hiding (round)
import           Conduit
import           Control.Lens                          hiding (Context, view)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import qualified Control.Monad.State                   as State
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.Default
import           Data.Foldable                         (toList)
import           Data.Map.Strict                       (Map)
import qualified Data.Map.Strict                       as M
import qualified Data.Set                              as Set
import qualified Data.Set.Ordered                      as S
import           Data.Text                             (Text)
import qualified Data.Text                             as T
import           Data.Time.Clock
import           Text.Printf

import           BlockApps.Logging
import           Blockchain.Blockstanbul
import           Blockchain.Context                    hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.BlockDB()
import           Blockchain.Data.Control
import qualified Blockchain.Data.DataDefs              as DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.Wire
import qualified Blockchain.Database.MerklePatricia    as MP
import  BlockApps.X509.Certificate           

import "strato-p2p" Blockchain.Event
import           Blockchain.Options                    (AuthorizationMode(..))
import           Blockchain.Sequencer.Event

import           Blockchain.Strato.Discovery.Data.Peer hiding (createPeer)
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1

import           Test.Hspec
import qualified Test.Hspec.Expectations.Lifted        as L
import           Test.QuickCheck

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
  , _orgNameChainsMap      :: Map (OrgName, OrgUnit) OrgNameChains
  , _x509certMap           :: Map Address X509CertInfoState
  , _shaChainTxsInBlockMap :: Map Keccak256 ChainTxsInBlock
  , _chainMembersMap       :: Map Word256 ChainMembers
  , _chainInfoMap          :: Map Word256 ChainInfo
  , _privateTxMap          :: Map Keccak256 (Private (Word256, OutputTx))
  , _shaOutputBlockMap     :: Map Keccak256 OutputBlock
  , _genesisBlockHash      :: GenesisBlockHash
  , _bestBlockNumber       :: BestBlockNumber
  , _stringPPeerMap        :: Map String PPeer
  , _pbftMessages          :: S.OSet Keccak256
  , _unseqEvents           :: [IngestEvent]
  }
makeLenses ''TestContext

data P2PPeer = P2PPeer
  { _p2pPeerPrivKey        :: PrivateKey
  , _p2pPeerPPeer          :: PPeer
  , _p2pPeerName           :: String
  , _p2pTestContext        :: TVar TestContext
  }
makeLenses ''P2PPeer

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

instance MonadIO m => A.Selectable (OrgName, OrgUnit) OrgNameChains (MonadTest m) where
  select _ ip = M.lookup ip <$> use orgNameChainsMap

instance A.Selectable (OrgName, OrgUnit) OrgNameChains m => A.Selectable (OrgName, OrgUnit) OrgNameChains (MonadP2PTest m) where
  select p org = lift $ A.select p org

instance MonadIO m => A.Selectable Address X509CertInfoState (MonadTest m) where
  select _ a = M.lookup a <$> use x509certMap

instance A.Selectable Address X509CertInfoState m => A.Selectable Address X509CertInfoState (MonadP2PTest m) where
  select p addr = lift $ A.select p addr

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
  select _ tx = M.lookup tx <$> use stringPPeerMap

instance (Monad m, Stacks Block m) => Stacks Block (MonadP2PTest m) where
  takeStack a b = lift $ takeStack a b
  pushStack bs  = lift $ pushStack bs

instance (Keccak256 `A.Alters` DataDefs.BlockData) m => (Keccak256 `A.Alters` DataDefs.BlockData) (MonadP2PTest m) where
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

instance A.Selectable Word256 ChainMembers m => A.Selectable Word256 ChainMembers (MonadP2PTest m) where
  select p cid = lift $ A.select p cid

instance A.Selectable Word256 ChainInfo m => A.Selectable Word256 ChainInfo (MonadP2PTest m) where
  select p cid = lift $ A.select p cid

instance A.Selectable Keccak256 (Private (Word256, OutputTx)) m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (MonadTest m) where
  lookup _ k   = M.lookup k <$> use shaOutputBlockMap
  insert _ k v = shaOutputBlockMap %= M.insert k v
  delete _ k   = shaOutputBlockMap %= M.delete k

instance (MonadIO m, (Keccak256 `A.Alters` OutputBlock) m) => (Keccak256 `A.Alters` OutputBlock) (MonadP2PTest m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k

instance (Monad m, Mod.Accessible GenesisBlockHash m) => Mod.Accessible GenesisBlockHash (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance (Monad m, Mod.Accessible BestBlockNumber m) => Mod.Accessible BestBlockNumber (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance (Monad m, Mod.Accessible ConnectionTimeout m) => Mod.Accessible ConnectionTimeout (MonadP2PTest m) where
  access p = lift $ Mod.access p

instance A.Selectable String PPeer m => A.Selectable String PPeer (MonadP2PTest m) where
  select p tx = lift $ A.select p tx

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

instance MonadIO m => (MonadTest m) `Mod.Outputs` [IngestEvent] where
  output ies = unseqEvents %= (++ies)

instance (MonadIO m, m `Mod.Outputs` [IngestEvent]) => (MonadP2PTest m) `Mod.Outputs` [IngestEvent] where
  output = lift . Mod.output

instance MonadIO m => A.Selectable (IPAsText, UDPPort, B.ByteString) Point (MonadP2PTest m) where
  select _ _ = error "Test peer should not be fetching public key"

instance MonadIO m => A.Selectable IPAsText PPeer (MonadP2PTest m) where
  select _ _ = error "Test peer should not be calling getPeerByIP"

instance MonadIO m => A.Selectable (IPAsText, TCPPort) ActivityState (MonadP2PTest m) where
  select _ _ = error "Test peer should not be calling withActivePeer"

instance MonadIO m => A.Alters (IPAsText, TCPPort) ActivityState (MonadP2PTest m) where
  lookup _ _ = error "Test peer should not be calling withActivePeer"
  insert _ _ = error "Test peer should not be calling withActivePeer"
  delete _ _ = error "Test peer should not be calling withActivePeer"

instance MonadIO m => Mod.Accessible AvailablePeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    AvailablePeers . filter ((< currentTime) . pPeerEnableTime). M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible AvailablePeers m) => Mod.Accessible AvailablePeers (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => Mod.Accessible BondedPeersForUDP (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime
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

instance MonadIO m => Mod.Accessible BondedPeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime
    BondedPeers . filter f . M.elems <$> use stringPPeerMap

instance (Monad m, Mod.Accessible BondedPeers m) => Mod.Accessible BondedPeers (MonadP2PTest m) where
  access = lift . Mod.access

instance MonadIO m => Mod.Accessible UnbondedPeers (MonadTest m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    let f p = pPeerBondState p == 0 && pPeerEnableTime p < currentTime
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

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, redis, or ethconf.
testContext :: PrivateKey -> TestContext
testContext prv = TestContext
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
  , _orgNameChainsMap      = M.empty
  , _x509certMap           = M.empty
  , _shaChainTxsInBlockMap = M.empty
  , _chainMembersMap       = M.empty
  , _chainInfoMap          = M.empty
  , _privateTxMap          = M.empty
  , _shaOutputBlockMap     = M.empty
  , _genesisBlockHash      = GenesisBlockHash zeroHash
  , _bestBlockNumber       = BestBlockNumber 0
  , _stringPPeerMap        = M.empty
  , _pbftMessages          = S.empty
  , _unseqEvents           = []
  }

testPeer :: PPeer
testPeer = buildPeer (Nothing, "0.0.0.0", 1212)

instance (MP.StateRoot `A.Alters` MP.NodeData) (State.State (a, Map MP.StateRoot MP.NodeData)) where
  lookup _ k   = M.lookup k <$> State.gets snd
  insert _ k v = State.modify' $ \(a, b) -> (a, M.insert k v b)
  delete _ k   = State.modify' $ \(a, b) -> (a, M.delete k b)

createPeer :: PrivateKey
           -> String
           -> String
           -> IO P2PPeer
createPeer privKey name ipAddr = do
  testContextTVar <- newTVarIO $ testContext privKey
  let pubkeystr = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False $ derivePublicKey privKey
      ppeer = buildPeer ( Just pubkeystr
                                 , ipAddr
                                 , 30303
                                 )
  pure $ P2PPeer
    privKey
    ppeer
    name
    testContextTVar

runTestPeer :: MonadP2PTest TestContextM a -> IO ()
runTestPeer f = do
  serverPKey <- newPrivateKey
  server <- createPeer serverPKey "server" "1.2.3.4"
  p2pCtx <- newIORef def
  void . runNoLoggingT . runResourceT . flip runReaderT server $ runReaderT f p2pCtx
                          
spec :: Spec
spec = do
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
        cert1 = Just X509CertInfoState {
          userAddress = 0x1234 :: Address,
          certificate = X509Certificate (CertificateChain []),
          isValid = True,
          BlockApps.X509.Certificate.children = [],
          orgName = "Blockapps",
          orgUnit = Just "engineering"
        }
        cert2 = Just X509CertInfoState {
          userAddress = 0x33beef44 :: Address,
          certificate = X509Certificate (CertificateChain []),
          isValid = False,
          BlockApps.X509.Certificate.children = [],
          orgName = "Red Bull Racing",
          orgUnit = Nothing
        }
        mkEnode :: String -> String -> Enode
        mkEnode key ip = readEnode $ printf "enode://%s@%s:30303" key ip
        chainMembers = M.fromList
           [ (0xdeadbeef, mkEnode key1 ip1)
           , (0xddba11, mkEnode key2 ip2)
           , (0x888, mkEnode key3 ip3)
           ]

        shouldAccept :: AuthorizationMode -> (String, String) -> IO ()
        shouldAccept mode (key, ip) =
          buildPeer (Just key, ip, 30303) `shouldSatisfy` (\p -> checkPeerIsMember'' mode p (ChainMembers chainMembers) cert1 (OrgNameChains $ Set.singleton (0xabcdef :: Word256)))

        shouldReject :: AuthorizationMode -> (String, String) -> IO ()
        shouldReject mode (key, ip) =
          buildPeer (Just key, ip, 30303) `shouldNotSatisfy` (\p -> checkPeerIsMember'' mode p (ChainMembers chainMembers) cert2 (OrgNameChains Set.empty))

    describe "IPOnly" $ do
      it "should reject the wrong ip" $ IPOnly `shouldReject` (key1, ip4)
      it "should accept the right ip with the wrong key" $ IPOnly `shouldAccept` (key4, ip2)

    describe "PubkeyOnly" $ do
      it "should reject the wrong key" $ PubkeyOnly `shouldReject` (key4, ip1)
      it "should accept the right key with the wrong ip" $ PubkeyOnly `shouldAccept` (key2, ip4)

    describe "X509Only" $ do
      it "should reject a revoked cert" $ X509Only `shouldReject` (key1, ip1)
      it "should approve a valid cert" $ X509Only `shouldAccept` (key2, ip2)

    describe "StrongAuth" $ do
      it "should reject a mismatched ip, key pair" $ StrongAuth `shouldReject` (key3, ip2)
      it "should accept a matching ip, key pair" $ StrongAuth `shouldAccept` (key3, ip3)

    describe "FlexibleAuth" $ do
      it "should reject a wrong ip and wrong key" $ FlexibleAuth `shouldReject` (key4, ip4)
      it "should accept a matching ip" $ FlexibleAuth `shouldAccept` (key4, ip1)
      it "should accept a matching key" $ FlexibleAuth `shouldAccept` (key2, ip4)