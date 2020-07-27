{-# OPTIONS -fno-warn-unused-imports #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Sequencer.SequencerSpec where

import           ClassyPrelude                       (atomically)
import qualified Data.ByteString                     as BS
import           Data.IORef
import           Data.Maybe                          (fromMaybe, isNothing)
import           Data.Time.Clock.POSIX
import qualified Data.Map                            as M
import           Data.ByteString.Base16              as B16
import           Numeric                             (showHex)

import           Conduit
import           Control.Concurrent
import           Control.Concurrent.STM.TMChan
import           Control.Concurrent.STM.TQueue
import           Control.Concurrent.STM.TBQueue
import           Control.Exception                   (finally)
import           Control.Monad
import qualified Control.Monad.Change.Modify         as Mod
import           Control.Monad.IO.Class              (liftIO)
import           Control.Concurrent.Async             as Async
import           Control.Monad.Reader
import           Control.Monad.State.Class
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.BenchmarkLib (makeBlock, makeBlockWithTransactions)
import           Blockchain.Blockstanbul.EventLoop
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Blockstanbul.Messages hiding (round)
import           Blockchain.Blockstanbul.StateMachine
import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction         (createChainMessageTX)
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin as TO
import           Blockchain.ECDSA
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Keccak256         as Keccak256
import qualified Data.ByteString.Char8               as C8
import qualified Data.Set                            as S
import qualified Network.Haskoin.Crypto     as HK    -- TODO: get rid of this
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Prometheus
import           Servant.Client
import           System.Entropy
import           Test.Hspec.Core.Spec
import           Test.Hspec.Expectations.Lifted
import           Test.Hspec.Contrib.HUnit            ()
import           Test.HUnit
import           Test.QuickCheck

import           System.Directory                    (createDirectoryIfMissing, getCurrentDirectory,
                                                      removeDirectoryRecursive, setCurrentDirectory)

import           Text.Format




fromLeft :: a -> Either a b -> a
fromLeft _ (Left a) = a
fromLeft a _ = a

stripTransactionsAndUncles :: IngestBlock -> IngestBlock
stripTransactionsAndUncles b = b { ibReceiptTransactions = [], ibBlockUncles = [] }

dedupWindow :: Int
dedupWindow = 100

-- NOTE: this is (and must be) the same as "testPriv" from Monad.hs....used by the 
-- HasVault instance so we can make Blockstanbul message signatures without a vault client
myPriv :: PrivateKey
myPriv = fromMaybe (error "could not import private key") (importPrivateKey (fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

runTestM :: SequencerM a -> IO ()
runTestM m = do
  gb <- makeGenesisBlock
  void $ withTemporaryDepBlockDB False gb m

testWebserverPort :: Int
testWebserverPort = 8050

runPBFTTestM :: SequencerM a -> IO ()
runPBFTTestM m = do
  gb <- makeGenesisBlock
  void $ withTemporaryDepBlockDB True gb m

runPBFTTestMWithGenesis :: (Keccak256 -> SequencerM a) -> IO ()
runPBFTTestMWithGenesis m = do
  gb <- makeGenesisBlock
  let hsh = blockHash . ingestBlockToBlock $ gb
  void $ withTemporaryDepBlockDB True gb (m hsh)


withTemporaryDepBlockDB :: Bool -> IngestBlock -> SequencerM a -> IO a
withTemporaryDepBlockDB pbft genesisBlock m = do
    cwd          <- getCurrentDirectory
    randomSuffix <- generate $ (arbitrary :: Gen Integer) `suchThat` (>1000)
    timestamp    <- round <$> getPOSIXTime  :: IO Integer
    let fullPath ="./.ethereumH/dep_block_" ++ show timestamp ++ "_" ++ showHex randomSuffix "" ++ "/"
    setCurrentDirectory "../" -- for ethconf to be happy
    createDirectoryIfMissing True fullPath
    pkg <- atomically newCablePackage
    vch <- atomically newTQueue
    rch <- atomically newTQueue
    tch <- atomically newTMChan
    let
        cfg  = SequencerConfig { depBlockDBCacheSize   = 0
                               , depBlockDBPath        = fullPath
                               , seenTransactionDBSize = dedupWindow
                               , syncWrites            = False
                               , blockstanbulBlockPeriod = BlockPeriod 0
                               , blockstanbulRoundPeriod = RoundPeriod 10000000
                               , blockstanbulBeneficiary = vch
                               , blockstanbulVoteResps = rch
                               , blockstanbulTimeouts = tch
                               , cablePackage = pkg
                               , maxUsPerIter = 200
                               , maxEventsPerIter = 10
                               , vaultClient = Nothing
                               }
        myAddr = fromPrivateKey myPriv
        vals = [myAddr]
        auSenders = [myAddr]
        ctx = newContext (Checkpoint (View 0 0) M.empty vals auSenders) myAddr
        mCtx = if pbft then Just ctx else Nothing
        hsh = blockHash . ingestBlockToBlock $ genesisBlock
        difficulty = blockHeaderDifficulty . ibBlockData $ genesisBlock
        boot = bootstrapGenesisBlock hsh difficulty
    fromLeft (error "webserver completed") <$>
      race (runNoLoggingT (runSequencerM cfg mCtx (boot >> m)))
           ( run testWebserverPort
               . logStdoutDev
               . prometheus def
               $ API.createWebServer vch rch)
        `finally`
        (removeDirectoryRecursive fullPath >> setCurrentDirectory cwd)-- always clean up

feedBackOutputsToInput :: [VmEvent] -> [IngestEvent]
feedBackOutputsToInput = map rebox
    where rebox (VmTx ts t) = IETx ts $ unboxTx t
          rebox (VmBlock (OutputBlock origin _ header txs uncles)) = IEBlock $ IngestBlock origin header (unboxBlockTx <$> txs) uncles
          rebox x = error $ "why are we testing against " ++ show x
          unboxTx (OutputTx origin _ _ _ base) = IngestTx origin base
          unboxBlockTx (OutputTx _ _ _ _ base) = base

mkBlk :: Keccak256 -> Integer -> SequencerM (Block)
mkBlk parent num = do
  ctx <- fromMaybe (error "context required for PBFT") <$> getBlockstanbulContext
  let blk0 = makeBlock 2 1
      blk1 = Block (blockBlockData blk0){blockDataParentHash = parent} (blockReceiptTransactions blk0) (blockBlockUncles blk0)
      blk2 = addValidators (_validators ctx) blk1{
                 blockBlockData = (blockBlockData blk1){blockDataNumber = num}}
  pseal <- proposerSeal blk2
  let blk3 = addProposerSeal pseal blk2
  cseal <- commitmentSeal (blockHash blk3)
  return $ addCommitmentSeals [cseal] blk3

spec :: Spec
spec = do
    describe "Testing Support" $ do
        it "makeGenesisBlock >>= buildIngestChain >>= validate should always be valid" $ do
            gb    <- makeGenesisBlock
            chain <- buildIngestChain gb 4 2
            ret   <- validateOrder gb chain
            assertBool (format ret) $ isValid ret

        it "makeGenesisBlock >>= (reverse <$> buildIngestChain) >>= validate should always be invalid" $ do
            gb    <- makeGenesisBlock
            chain <- reverse <$> buildIngestChain gb 4 2
            ret   <- validateOrder gb chain
            assertBool (format ret) $ (not.isValid) ret

    describe "Sequencer" $ do
        it "transformEvents should output blocks in partial order based on parent hash when input is in order" $ do
            gb <- makeGenesisBlock
            inChain <- buildIngestChain gb 8 2
            outBlocks <- withTemporaryDepBlockDB False gb $ do
              BatchSeqEvent{..} <- runBatch $ splitEvents (IEBlock <$> inChain)
              return [block | VmBlock block <- _toVm ]
            ret <- validateOrder gb outBlocks
            ret `shouldSatisfy` isValid

        it "transformEvents should output blocks in partial order based on parent hash when input is out of order" $ do
            gb <- makeGenesisBlock
            inChain <- buildIngestChain gb 8 2
            shuffled <- generate $ shuffle inChain
            outBlocks <- withTemporaryDepBlockDB False gb $ do
              BatchSeqEvent{..} <- runBatch $ splitEvents (IEBlock <$> shuffled)
              return [block | VmBlock block <- _toVm ]
            ret <- validateOrder gb outBlocks
            ret `shouldSatisfy` isValid

        it "should not deduplicate incoming transactions that are unique" $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (10, dedupWindow - 1)
            inTxs  <- generate $ vectorOf inTxSize arbitrary
            outTxs <- withTemporaryDepBlockDB False gb $ do
              BatchSeqEvent{..} <- runBatch $ splitEvents (IETx ts <$> inTxs)
              return [t | t@VmTx{} <- _toVm]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn = feedBackOutputsToInput outTxs
            dedupedOut <- withTemporaryDepBlockDB False gb $ do
              _toVm <$> runBatch (splitEvents dedupedIn)
            length dedupedOut `shouldBe` length dedupedIn

        it ("should allow duplicate incoming transactions that come in after a specified window (" ++ show dedupWindow ++ " txs)") $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (2 * dedupWindow, (3 * dedupWindow) - 1)
            inTxs  <- generate . vectorOf inTxSize $ suchThat arbitrary (isNothing . txChainId . itTransaction)
            outTxs <- withTemporaryDepBlockDB False gb $ do
              BatchSeqEvent{..} <- runBatch $ splitEvents (IETx ts <$> inTxs)
              return [t | t@VmTx{} <- _toVm]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn          = feedBackOutputsToInput outTxs
                replicationsNeeded = (dedupWindow `quot` length dedupedIn) + 1
                replicatedIn       = concat $ replicate replicationsNeeded dedupedIn
            dedupedOut <- withTemporaryDepBlockDB False gb $ do
              BatchSeqEvent{..} <- runBatch $ splitEvents replicatedIn
              return [o | o@(VmTx _ _) <- _toVm]
            length dedupedOut `shouldBe` length dedupedOut

    describe "SequencerM" $ do
      it "queues timeouts -- with retries" $ runTestM $ do
        let input = [20, 45, 30]
        local (\cfg -> cfg{blockstanbulRoundPeriod = RoundPeriod 0.00005}) $
          mapM_ createNewTimer input
        liftIO $ threadDelay 10000 -- Who are you to judge?
        rnref <- gets _latestRoundNumber
        liftIO $ atomicWriteIORef rnref 200
        out <- drainTimeouts
        filter (==20) out `shouldBe` [20]
        filter (==30) out `shouldBe` [30]
        filter (==45) out `shouldContain` [45, 45]

      it "checks for votes" $ runPBFTTestM $ do
        bc <- getBlockstanbulContext
        case bc of
          Nothing ->
            expectationFailure "BlockstanbulContext required"
          Just bct -> do
            let addr = fromPrivateKey myPriv
                (testAddr :: Address) = 0x3263b65db202c4c2227a7e2a53b6b1f37b2edd0b
            esign <- signBenfInfo (testAddr, True, 1)
            let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
                vote = API.CandidateReceived{API.sender=addr
                                           , API.signature=esignStr
                                           , API.recipient=testAddr
                                           , API.votingdir=True
                                           , API.nonce = 1}
            -- Simulate a successful response from blockstanbul by violating causality
            -- This is pretty fragile to implementation details
            rch <- asks blockstanbulVoteResps
            atomically $ writeTQueue rch API.Enqueued
            let url = BaseUrl Http "localhost" testWebserverPort ""
            liftIO $ API.uploadVote url vote `shouldReturn` Right ()
            voteList <- drainVotes
            voteList `shouldMatchList` [vote]
            b1 <- runBatch $ checkForVotes voteList
            _toVm b1 `shouldContain` [VmVoteToMake { voteRecipient = testAddr, voteVotingDir = True, voteSender = addr}]
            esign' <- signBenfInfo (testAddr, False, 1)
            let esignStr' = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign')
                vote' = API.CandidateReceived{API.sender=addr
                                            , API.signature=esignStr'
                                            , API.recipient=testAddr
                                            , API.votingdir=False
                                            , API.nonce = 1}
            liftIO $ API.uploadVote url vote' `shouldReturn` Right ()
            voteList' <- drainVotes
            voteList' `shouldMatchList` [vote']
            b2 <- runBatch $ checkForVotes voteList'
            _toVm b2 `shouldNotContain` [VmVoteToMake { voteRecipient = testAddr, voteVotingDir = False, voteSender = addr}]
            bctn <- getBlockstanbulContext
            let unwrapbct' = fromMaybe bct bctn
            _authSenders unwrapbct' `shouldBe` M.singleton addr 1

    describe "fuseChannels" $ do
      it "should multiplex event types" $ withMaxSuccess 5 $ property $ \vote rn iev -> runTestM $ do
        tch <- asks blockstanbulTimeouts
        atomically . writeTMChan tch $ rn
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTBQueue uch $ iev
        vch <- asks blockstanbulBeneficiary
        atomically . writeTQueue vch $ vote
        src0 <- sealConduitT <$> fuseChannels
        (src1, ev1) <- src0 $$++ headC
        (src2, ev2) <- src1 $$++ headC
        (_, ev3) <- src2 $$++ headC
        [ev1, ev2, ev3] `shouldMatchList` [Just $ TimerFire rn, Just $ UnseqEvent iev, Just $ VoteMade vote]

    describe "sequencer" $ do
      it "should be able to run in a test" $ withMaxSuccess 5 $ property $ \iev -> runTestM $ do
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTBQueue uch $ iev
        src <- sealConduitT <$> fuseChannels
        void $ oneSequencerIter src

      it "should not only return 1 event if multiple are pending" . runTestM $ do
        tch <- asks blockstanbulTimeouts
        atomically $ do
          writeTMChan tch 20
          writeTMChan tch 34
          writeTMChan tch 92
        src <- sealConduitT <$> fuseChannels
        (_, evs) <- readEventsInBufferedWindow src
        evs `shouldMatchList` map TimerFire [20, 34, 92]

      it "should not return more than the fetchlimit" . runTestM $ do
        tch <- asks blockstanbulTimeouts
        src <- sealConduitT <$> fuseChannels
        atomically $ mapM_ (writeTMChan tch) [10..30]
        (_, evs) <- readEventsInBufferedWindow src
        evs `shouldMatchList` map TimerFire [10..19]

      it "should forward new blocks to blockstanbul" . runPBFTTestMWithGenesis $ \h -> do
        let b' = makeBlock 1 1
            b = Block (blockBlockData b'){ blockDataParentHash = h
                                         , blockDataNumber = 1
                                         }
                      (blockReceiptTransactions b')
                      (blockBlockUncles b')
            iev = IEBlock . blockToIngestBlock TO.Morphism $ b
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [iev]
        let pbftEvs = [m | P2pBlockstanbul (WireMessage _ m) <- _toP2p]
        map categorize pbftEvs `shouldMatchList` [PreprepareK, PrepareK, PrepareK, CommitK, CommitK]
        _toVm `shouldContain` [VmCreateBlockCommand]

      it "should replay old blocks in blockstanbul" . runPBFTTestMWithGenesis $ \h -> do
        ctx <- fromMaybe (error "context required for PBFT") <$> getBlockstanbulContext
        let blk0 = makeBlock 2 1
            blk1 = Block (blockBlockData blk0){blockDataParentHash = h} (blockReceiptTransactions blk0) (blockBlockUncles blk0)
            blk2 = addValidators (_validators ctx) blk1{
                      blockBlockData = (blockBlockData blk1){blockDataNumber = 1}}
        pseal <- proposerSeal blk2
        let blk3 = addProposerSeal pseal blk2
        cseal <- commitmentSeal (blockHash blk3)
        let blk4 = addCommitmentSeals [cseal] blk3
            iev = IEBlock . blockToIngestBlock TO.Morphism $ blk4
        putBlockstanbulContext ctx
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [iev]
        _toP2p `shouldBe` []
        _toVm `shouldContain` [VmCreateBlockCommand]
        map outputBlockToBlock [oblk | VmBlock oblk <- _toVm] `shouldMatchList` [blk4]
        ctx' <- fromMaybe (error "context required for pbft") <$> getBlockstanbulContext
        _view ctx' `shouldBe` View 0 1

      it "should sequence blocks out of order in blockstanbul" . runPBFTTestMWithGenesis $ \h -> do
        ctx <- fromMaybe (error "context required for PBFT") <$> getBlockstanbulContext
        let ieBlk = IEBlock . blockToIngestBlock TO.Morphism
            mkBlkChn :: Int -> Keccak256 -> Integer -> SequencerM [Block]
            mkBlkChn 0 _ _ = return []
            mkBlkChn n p i = do 
              b <- mkBlk p i
              rst <- mkBlkChn (n - 1) (blockHash b) (i + 1)
              return $ b : rst
        blkChn <- mkBlkChn (5 :: Int) h 1
        putBlockstanbulContext ctx
        BatchSeqEvent{..} <- runBatch . checkForUnseq $ ieBlk <$> reverse blkChn
        _toP2p `shouldBe` []
        _toVm `shouldContain` [VmCreateBlockCommand]
        map outputBlockToBlock [oblk | VmBlock oblk <- _toVm] `shouldMatchList` blkChn
        ctx' <- fromMaybe (error "context required for pbft") <$> getBlockstanbulContext
        _view ctx' `shouldBe` View 0 5

      it "should be able to fetch if the write is after the read begins" . runTestM $ do
        src <- sealConduitT <$> fuseChannels
        uch <- asks blockstanbulTimeouts
        void . liftIO . forkIO $ do
          threadDelay 5000
          atomically . writeTMChan uch $ 987
        (_, evs) <- readEventsInBufferedWindow src
        evs `shouldMatchList` [TimerFire 987]

    describe "Private Chains" $ do

      -- chain 1
      let cInfo1 = ChainInfo
                    (UnsignedChainInfo "my test chain 1" [] [] M.empty Nothing (unsafeCreateKeccak256FromWord256 0) 0 M.empty)
                    Nothing
          chainId1 = Keccak256.rlpHash cInfo1
          chainHash1 = Keccak256.rlpHash cInfo1
          chainDetails1 = IEGenesis (IngestGenesis TO.Morphism (keccak256ToWord256 chainId1, cInfo1))
      tx1 <- runIO . HK.withSource HK.devURandom $ do
        pk <- HK.genPrvKey
        createChainMessageTX 0 1 1 (Address 0xdeadbeef) 0 BS.empty (Just $ keccak256ToWord256 chainId1) Nothing pk
      let hashTx1 = PrivateHashTX (txHash tx1) chainHash1

      -- chain 2
      let cInfo2 = ChainInfo
                    (UnsignedChainInfo "my test chain 2" [] [] M.empty Nothing (unsafeCreateKeccak256FromWord256 0) 0 M.empty)
                    Nothing
          chainId2 = Keccak256.rlpHash cInfo2
          chainHash2 = Keccak256.rlpHash cInfo2
          chainDetails2 = IEGenesis (IngestGenesis TO.Morphism (keccak256ToWord256 chainId2, cInfo2))
      tx2 <- runIO . HK.withSource HK.devURandom $ do
        pk <- HK.genPrvKey
        createChainMessageTX 0 1 1 (Address 0xdeadbeef) 0 BS.empty (Just $ keccak256ToWord256 chainId2) Nothing pk
      let hashTx2 = PrivateHashTX (txHash tx2) chainHash2

      let b1' = makeBlockWithTransactions [hashTx1]
          blk1' h = Block (blockBlockData b1'){ blockDataParentHash = h
                                              , blockDataNumber = 1
                                              }
                      (blockReceiptTransactions b1')
                      (blockBlockUncles b1')
          iev1' = IEBlock . blockToIngestBlock TO.Morphism . blk1'
          b2' = makeBlockWithTransactions [hashTx1, hashTx2]
          blk2' h = Block (blockBlockData b2'){ blockDataParentHash = h
                                              , blockDataNumber = 1
                                              }
                      (blockReceiptTransactions b2')
                      (blockBlockUncles b2')
          iev2' = IEBlock . blockToIngestBlock TO.Morphism . blk2'

      it "should forward a private transaction hash" . runTestM $ do
        th <- fmap Keccak256.hash . liftIO $ getEntropy 32
        ch <- fmap Keccak256.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [IETx 0 (IngestTx TO.Morphism hashTx)]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [PrivateHash]

      it "should forward a private transaction hash only once" . runTestM $ do
        th <- fmap Keccak256.hash . liftIO $ getEntropy 32
        ch <- fmap Keccak256.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
            ietx = IETx 0 (IngestTx TO.Morphism hashTx)
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [ietx,ietx]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [PrivateHash]

      it "should create a PrivateHashTX for a private transaction" . runTestM $ do
        BatchSeqEvent{..} <- runBatch $ do
          checkForUnseq [chainDetails1]
          checkForUnseq [IETx 0 (IngestTx TO.API tx1)]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [Message, PrivateHash]

      it "should run Blockstanbul with private transactions" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
        BatchSeqEvent{..} <- runBatch $ do
          checkForUnseq [chainDetails1]
          checkForUnseq [IETx 0 (IngestTx TO.Morphism tx1)]
          checkForUnseq [iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash],[Message]]

      it "should run Blockstanbul with delayed private transactions" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
        b1 <- runBatch $ do
          checkForUnseq [chainDetails1]
          checkForUnseq [iev]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash]]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        b2 <- runBatch $ checkForUnseq [IETx 0 (IngestTx TO.Morphism tx1)]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[Message]]

      it "should not split up block when all chains are known" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        BatchSeqEvent{..} <- runBatch $ do
          checkForUnseq [chainDetails1, chainDetails2]
          checkForUnseq [ietx tx1, ietx tx2]
          checkForUnseq [iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash, PrivateHash]]
        let obs = [b | VmBlock b <- _toVm]
        map (map txType . obReceiptTransactions) obs `shouldBe`
          [[PrivateHash,PrivateHash],[Message,Message]]

      it "should split up block when chain infos are delayed" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ do
          checkForUnseq [ietx tx1, ietx tx2]
          checkForUnseq [iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash,PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash,PrivateHash]]
        b2 <- runBatch $ checkForUnseq [chainDetails1, chainDetails2]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[Message],[Message]]

      it "should split up block when chain infos are staggered" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [ietx tx1, ietx tx2, iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash,PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash,PrivateHash]]
        b2 <- runBatch $ checkForUnseq [chainDetails1]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[Message]]
        b3 <- runBatch $ checkForUnseq [chainDetails2]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[Message]]

      it "should re-run blocks when chain info is delayed" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash]]
        b2 <- runBatch $ checkForUnseq [chainDetails1]
        let obs' = [b | VmBlock b <- _toVm b2]
        obs' `shouldBe` []
        txHashes <- unGetTransactionsDB <$> Mod.get (Mod.Proxy @GetTransactionsDB)
        txHashes `shouldBe` S.singleton (txHash tx1)
        b3 <- runBatch $ checkForUnseq [ietx tx1]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[Message]]
