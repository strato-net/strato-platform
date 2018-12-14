{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

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
import           Control.Exception                   (finally)
import           Control.Monad
import           Control.Monad.Logger
import           Control.Concurrent.Async             as Async
import           Control.Monad.Reader
import           Control.Monad.State.Class
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.BenchmarkLib (makeBlock, makeBlockWithTransactions)
import           Blockchain.Blockstanbul.EventLoop
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Blockstanbul.Messages hiding (round)
import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction         (createChainMessageTX)
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin as TO
import           Blockchain.Format
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import qualified Blockchain.SHA                      as SHA
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import qualified Data.ByteString.Char8               as C8
import qualified Network.Haskoin.Crypto     as HK
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

fromLeft :: a -> Either a b -> a
fromLeft _ (Left a) = a
fromLeft a _ = a

stripTransactionsAndUncles :: IngestBlock -> IngestBlock
stripTransactionsAndUncles b = b { ibReceiptTransactions = [], ibBlockUncles = [] }

dedupWindow :: Int
dedupWindow = 100

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

runPBFTTestMWithGenesis :: (SHA -> SequencerM a) -> IO ()
runPBFTTestMWithGenesis m = do
  gb <- makeGenesisBlock
  let hash = blockHash . ingestBlockToBlock $ gb
  void $ withTemporaryDepBlockDB True gb (m hash)

withTemporaryDepBlockDB :: Bool -> IngestBlock -> SequencerM a -> IO a
withTemporaryDepBlockDB pbft genesisBlock m = do
    cwd          <- getCurrentDirectory
    randomSuffix <- generate $ (arbitrary :: Gen Integer) `suchThat` (>1000)
    timestamp    <- round <$> getPOSIXTime  :: IO Integer
    let fullPath ="./.ethereumH/dep_block_" ++ show timestamp ++ "_" ++ showHex randomSuffix "" ++ "/"
    setCurrentDirectory "../" -- for ethconf to be happy
    createDirectoryIfMissing True fullPath
    pkg <- atomically newCablePackage
    vch <- atomically newTMChan
    tch <- atomically newTMChan
    let
        cfg  = SequencerConfig { depBlockDBCacheSize   = 0
                               , depBlockDBPath        = fullPath
                               , seenTransactionDBSize = dedupWindow
                               , syncWrites            = False
                               , blockstanbulBlockPeriod = 0
                               , blockstanbulRoundPeriod = 10000000
                               , blockstanbulBeneficiary = vch
                               , blockstanbulTimeouts = tch
                               , cablePackage = pkg
                               , maxUsPerIter = 200
                               , maxEventsPerIter = 10
                               }
        bytes = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN6tvu8"
        pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
        myAddr = prvKey2Address pkey
        vals = [myAddr]
        auSenders = [myAddr]
        ctx = newContext (View 0 0) vals auSenders pkey
        mCtx = if pbft then Just ctx else Nothing
        hash = blockHash . ingestBlockToBlock $ genesisBlock
        difficulty = blockHeaderDifficulty . ibBlockData $ genesisBlock
        boot = bootstrapGenesisBlock hash difficulty
    fromLeft (error "webserver completed") <$>
      race (runLoggingT (runSequencerM cfg mCtx (boot >> m)) dropLogMsg)
           ( run testWebserverPort
               . logStdoutDev
               . prometheus def
               . API.createWebServer $ vch)
        `finally`
        (removeDirectoryRecursive fullPath >> setCurrentDirectory cwd)-- always clean up

feedBackOutputsToInput :: [OutputEvent] -> [IngestEvent]
feedBackOutputsToInput = map rebox
    where rebox (OETx ts t) = IETx ts $ unboxTx t
          rebox (OEBlock (OutputBlock origin _ header txs uncles)) = IEBlock $ IngestBlock origin header (unboxBlockTx <$> txs) uncles
          rebox x = error $ "why are we testing against " ++ show x
          unboxTx (OutputTx origin _ _ base) = IngestTx origin base
          unboxBlockTx (OutputTx _ _ _ base) = base

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
              splitEvents (IEBlock <$> inChain)
              oes <- drainVM
              return [block | OEBlock block <- oes ]
            ret <- validateOrder gb outBlocks
            ret `shouldSatisfy` isValid

        it "transformEvents should output blocks in partial order based on parent hash when input is out of order" $ do
            gb <- makeGenesisBlock
            inChain <- buildIngestChain gb 8 2
            shuffled <- generate $ shuffle inChain
            outBlocks <- withTemporaryDepBlockDB False gb $ do
              splitEvents (IEBlock <$> shuffled)
              oes <- drainVM
              return [block | OEBlock block <- oes ]
            ret <- validateOrder gb outBlocks
            ret `shouldSatisfy` isValid

        it "should not deduplicate incoming transactions that are unique" $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (10, dedupWindow - 1)
            inTxs  <- generate $ vectorOf inTxSize arbitrary
            outTxs <- withTemporaryDepBlockDB False gb $ do
              splitEvents (IETx ts <$> inTxs)
              oes <- drainVM
              return [o | o@(OETx _ _) <- oes]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn = feedBackOutputsToInput outTxs
            dedupedOut <- withTemporaryDepBlockDB False gb $ do
              splitEvents dedupedIn
              drainVM
            length dedupedOut `shouldBe` length dedupedIn

        it ("should allow duplicate incoming transactions that come in after a specified window (" ++ show dedupWindow ++ " txs)") $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (2 * dedupWindow, (3 * dedupWindow) - 1)
            inTxs  <- generate . vectorOf inTxSize $ suchThat arbitrary (isNothing . txChainId . itTransaction)
            outTxs <- withTemporaryDepBlockDB False gb $ do
              splitEvents (IETx ts <$> inTxs)
              oes <- drainVM
              return [o | o@(OETx _ _) <- oes]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn          = feedBackOutputsToInput outTxs
                replicationsNeeded = (dedupWindow `quot` length dedupedIn) + 1
                replicatedIn       = concat $ replicate replicationsNeeded dedupedIn
            dedupedOut <- withTemporaryDepBlockDB False gb $ do
              splitEvents replicatedIn
              oes <- drainVM
              return [o | o@(OETx _ _) <- oes]
            length dedupedOut `shouldBe` length dedupedOut

    describe "SequencerM" $ do
      -- TODO: Benchmark more tightly.
      -- This is amazingly slow for how little it appears to be doing.
      it "queues events" $ withMaxSuccess 5 $ property $ \evs1 evs2 -> runTestM $ do
        drainVM `shouldReturn` []
        drainP2P `shouldReturn` []
        mapM_ markForVM evs1
        mapM_ markForP2P evs2
        drainVM `shouldReturn` evs1
        drainVM `shouldReturn` []
        drainP2P `shouldReturn` evs2
        drainP2P `shouldReturn` []

      it "queues timeouts -- with retries" $ runTestM $ do
        let input = [20, 45, 30]
        local (\cfg -> cfg{blockstanbulRoundPeriod=0.00005}) $
          mapM_ createNewTimer input
        liftIO $ threadDelay 10000 -- Who are you to judge?
        rnref <- gets _latestRoundNumber
        liftIO $ atomicWriteIORef rnref 200
        out <- drainTimeouts
        filter (==20) out `shouldBe` [20]
        filter (==30) out `shouldBe` [30]
        filter (==45) out `shouldContain` [45, 45, 45]

      it "checks for votes" $ runPBFTTestM $ do
        bc <- getBlockstanbulContext
        case bc of
          Nothing ->
            expectationFailure "BlockstanbulContext required"
          Just bct -> do
            let bytes = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN6tvu8"
                pvk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
                addr = prvKey2Address pvk
                (testAddr :: Address) = 0x3263b65db202c4c2227a7e2a53b6b1f37b2edd0b
            -- create the extendedsignature for (beneficiary, nonce)
            esign <- signBenfInfo pvk (testAddr, True, 1)
            --rlp serialize and hex and string the signature
            let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
                vote = API.CandidateReceived{API.sender=addr
                                           , API.signature=esignStr
                                           , API.recipient=testAddr
                                           , API.votingdir=True
                                           , API.nonce = 1}
            let url = BaseUrl Http "localhost" testWebserverPort ""
            liftIO $ API.uploadVote url vote `shouldReturn` Right ()
            voteList <- drainVotes
            voteList `shouldMatchList` [vote]
            checkForVotes voteList
            bct' <- getBlockstanbulContext
            let unwrapbct = fromMaybe bct bct'
            let pv = _pendingvotes unwrapbct
                val = M.lookup testAddr pv
            val `shouldBe` Just True
            pv `shouldBe` M.singleton testAddr True
            esign' <- signBenfInfo pvk (testAddr, False, 1)
            let esignStr' = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign')
                vote' = API.CandidateReceived{API.sender=addr
                                            , API.signature=esignStr'
                                            , API.recipient=testAddr
                                            , API.votingdir=False
                                            , API.nonce = 1}
            liftIO $ API.uploadVote url vote' `shouldReturn` Right ()
            voteList' <- drainVotes
            voteList' `shouldMatchList` [vote']
            checkForVotes voteList'
            bctn <- getBlockstanbulContext
            let unwrapbct' = fromMaybe bct bctn
            let pv' = _pendingvotes unwrapbct'
                val' = M.lookup testAddr pv'
            val' `shouldBe` Just True
            pv' `shouldBe` M.singleton testAddr True
            _authSenders unwrapbct' `shouldBe` M.singleton addr 1

    describe "fuseChannels" $ do
      it "should multiplex event types" $ withMaxSuccess 5 $ property $ \vote rn iev -> runTestM $ do
        tch <- asks blockstanbulTimeouts
        atomically . writeTMChan tch $ rn
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTQueue uch $ iev
        vch <- asks blockstanbulBeneficiary
        atomically . writeTMChan vch $ vote
        src0 <- sealConduitT <$> fuseChannels
        (src1, ev1) <- src0 $$++ headC
        (src2, ev2) <- src1 $$++ headC
        (_, ev3) <- src2 $$++ headC
        [ev1, ev2, ev3] `shouldMatchList` [Just $ TimerFire rn, Just $ UnseqEvent iev, Just $ VoteMade vote]

    describe "sequencer" $ do
      it "should be able to run in a test" $ withMaxSuccess 5 $ property $ \iev -> runTestM $ do
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTQueue uch $ iev
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
        checkForUnseq [iev]
        p2pevs <- drainP2P
        let pbftEvs = [m | OEBlockstanbul (WireMessage _ m) <- p2pevs]
        map categorize pbftEvs `shouldMatchList` [PreprepareK, PrepareK, CommitK]
        vmevs <- drainVM
        vmevs `shouldContain` [OECreateBlockCommand]

      it "should replay old blocks in blockstanbul" . runPBFTTestMWithGenesis $ \h -> do
        ctx <- fromMaybe (error "context required for PBFT") <$> getBlockstanbulContext
        let blk0 = makeBlock 2 1
            blk1= Block (blockBlockData blk0){blockDataParentHash = h} (blockReceiptTransactions blk0) (blockBlockUncles blk0)
            blk2 = addValidators (_validators ctx) blk1{
                      blockBlockData = (blockBlockData blk1){blockDataNumber = 1}}
        pseal <- proposerSeal blk2 (_prvkey ctx)
        let blk3 = addProposerSeal pseal blk2
        cseal <- commitmentSeal (blockHash blk3) (_prvkey ctx)
        let blk4 = addCommitmentSeals [cseal] blk3
            iev = IEBlock . blockToIngestBlock TO.Morphism $ blk4
        putBlockstanbulContext ctx
        checkForUnseq [iev]
        drainP2P `shouldReturn` []
        vmevs <- drainVM
        vmevs `shouldContain` [OECreateBlockCommand]
        map outputBlockToBlock [oblk | OEBlock oblk <- vmevs] `shouldMatchList` [blk4]
        ctx' <- fromMaybe (error "context required for pbft") <$> getBlockstanbulContext
        _view ctx' `shouldBe` View 0 1

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
                    (UnsignedChainInfo "my test chain 1" [] [] M.empty Nothing (SHA 0) 0 M.empty)
                    Nothing
          SHA chainId1 = SHA.rlpHash cInfo1
          SHA chainHash1 = SHA.rlpHash cInfo1
          chainDetails1 = IEGenesis (IngestGenesis TO.Morphism (chainId1, cInfo1))
      tx1 <- runIO . HK.withSource HK.devURandom $ do
        pk <- HK.genPrvKey
        createChainMessageTX 0 1 1 (Address 0xdeadbeef) 0 BS.empty (Just chainId1) Nothing pk
      let hashTx1 = PrivateHashTX (unSHA $ txHash tx1) chainHash1

      -- chain 2
      let cInfo2 = ChainInfo
                    (UnsignedChainInfo "my test chain 2" [] [] M.empty Nothing (SHA 0) 0 M.empty)
                    Nothing
          SHA chainId2 = SHA.rlpHash cInfo2
          SHA chainHash2 = SHA.rlpHash cInfo2
          chainDetails2 = IEGenesis (IngestGenesis TO.Morphism (chainId2, cInfo2))
      tx2 <- runIO . HK.withSource HK.devURandom $ do
        pk <- HK.genPrvKey
        createChainMessageTX 0 1 1 (Address 0xdeadbeef) 0 BS.empty (Just chainId2) Nothing pk
      let hashTx2 = PrivateHashTX (unSHA $ txHash tx2) chainHash2

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
        SHA th <- fmap SHA.hash . liftIO $ getEntropy 32
        SHA ch <- fmap SHA.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
        checkForUnseq [IETx 0 (IngestTx TO.Morphism hashTx)]
        vmevs <- drainVM
        let txs = [tx | OETx _ tx <- vmevs]
        length txs `shouldBe` 1
        txType (head txs) `shouldBe` PrivateHash
        p2pevs <- drainP2P
        let txs' = [tx | OETx _ tx <- p2pevs]
        length txs' `shouldBe` 1
        txType (head txs') `shouldBe` PrivateHash

      it "should forward a private transaction hash only once" . runTestM $ do
        SHA th <- fmap SHA.hash . liftIO $ getEntropy 32
        SHA ch <- fmap SHA.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
            ietx = IETx 0 (IngestTx TO.Morphism hashTx)
        checkForUnseq [ietx,ietx]
        vmevs <- drainVM
        let txs = [tx | OETx _ tx <- vmevs]
        length txs `shouldBe` 1
        txType (head txs) `shouldBe` PrivateHash
        p2pevs <- drainP2P
        let txs' = [tx | OETx _ tx <- p2pevs]
        length txs' `shouldBe` 1
        txType (head txs') `shouldBe` PrivateHash

      it "should create a PrivateHashTX for a private transaction" . runTestM $ do
        checkForUnseq [chainDetails1]
        checkForUnseq [IETx 0 (IngestTx TO.API tx1)]
        vmevs <- drainVM
        let txs = [tx | OETx _ tx <- vmevs]
        length txs `shouldBe` 1
        txType (head txs) `shouldBe` PrivateHash
        p2pevs <- drainP2P
        let txs' = [tx | OETx _ tx <- p2pevs]
        length txs' `shouldBe` 2
        txType (txs' !! 0) `shouldBe` Message
        txType (txs' !! 1) `shouldBe` PrivateHash

      it "should run Blockstanbul with private transactions" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
        checkForUnseq [chainDetails1]
        checkForUnseq [IETx 0 (IngestTx TO.Morphism tx1)]
        checkForUnseq [iev]
        p2pevs <- drainP2P
        let bs = [b | OEBlockstanbul (WireMessage _ (Preprepare _ b)) <- p2pevs]
        length bs `shouldBe` 1
        let txs = blockReceiptTransactions $ head bs
        length txs `shouldBe` 1
        txType (head txs) `shouldBe` PrivateHash
        vmevs <- drainVM
        let otxs = obReceiptTransactions $ head [b | OEBlock b <- vmevs]
        length otxs `shouldBe` 1
        txType (head otxs) `shouldBe` Message

      it "should run Blockstanbul with delayed private transactions" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
        checkForUnseq [chainDetails1]
        checkForUnseq [iev]
        vmevs <- drainVM
        let obs = [b | OEBlock b <- vmevs]
        length obs `shouldBe` 1
        let otxs = obReceiptTransactions $ head obs
        length otxs `shouldBe` 1
        txType (head otxs) `shouldBe` PrivateHash
        p2pevs <- drainP2P
        let bs = [b | OEBlockstanbul (WireMessage _ (Preprepare _ b)) <- p2pevs]
        length bs `shouldBe` 1
        let txs = blockReceiptTransactions $ head bs
        length txs `shouldBe` 1
        txType (head txs) `shouldBe` PrivateHash
        checkForUnseq [IETx 0 (IngestTx TO.Morphism tx1)]
        vmevs' <- drainVM
        let obs' = [b | OEBlock b <- vmevs']
        length obs' `shouldBe` 1
        let otxs' = obReceiptTransactions $ head obs'
        length otxs' `shouldBe` 1
        txType (head otxs') `shouldBe` Message

      it "should not split up block when all chains are known" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        checkForUnseq [chainDetails1, chainDetails2]
        checkForUnseq [ietx tx1, ietx tx2]
        checkForUnseq [iev]
        p2pevs <- drainP2P
        let bs = [b | OEBlockstanbul (WireMessage _ (Preprepare _ b)) <- p2pevs]
        length bs `shouldBe` 1
        let txs = blockReceiptTransactions $ head bs
        length txs `shouldBe` 2
        mapM_ ((`shouldBe` PrivateHash) . txType) txs
        vmevs <- drainVM
        let obs = [b | OEBlock b <- vmevs]
        length obs `shouldBe` 1
        let otxs = obReceiptTransactions $ head obs
        length otxs `shouldBe` 2
        mapM_ ((`shouldBe` Message) . txType) otxs

      it "should split up block when chain infos are delayed" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        checkForUnseq [ietx tx1, ietx tx2]
        checkForUnseq [iev]
        p2pevs <- drainP2P
        let bs = [b | OEBlockstanbul (WireMessage _ (Preprepare _ b)) <- p2pevs]
        length bs `shouldBe` 1
        let txs = blockReceiptTransactions $ head bs
        length txs `shouldBe` 2
        mapM_ ((`shouldBe` PrivateHash) . txType) txs
        vmevs <- drainVM
        let obs = [b | OEBlock b <- vmevs]
        length obs `shouldBe` 1
        let otxs = obReceiptTransactions $ head obs
        length otxs `shouldBe` 2
        mapM_ ((`shouldBe` PrivateHash) . txType) otxs
        checkForUnseq [chainDetails1, chainDetails2]
        vmevs' <- drainVM
        let obs' = [b | OEBlock b <- vmevs']
        length obs' `shouldBe` 2
        mapM_ ((`shouldBe` 2) . length . obReceiptTransactions) obs'
        let otxs1 = obReceiptTransactions $ obs' !! 0
            otxs2 = obReceiptTransactions $ obs' !! 1
        txType (otxs1 !! 0) `shouldBe` Message
        txType (otxs1 !! 1) `shouldBe` PrivateHash
        txType (otxs2 !! 0) `shouldBe` PrivateHash
        txType (otxs2 !! 1) `shouldBe` Message

      it "should split up block when chain infos are staggered" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev2' h
            ietx = IETx 0 . IngestTx TO.Morphism
        checkForUnseq [ietx tx1, ietx tx2, iev]
        p2pevs <- drainP2P
        let bs = [b | OEBlockstanbul (WireMessage _ (Preprepare _ b)) <- p2pevs]
        length bs `shouldBe` 1
        let txs = blockReceiptTransactions $ head bs
        length txs `shouldBe` 2
        mapM_ ((`shouldBe` PrivateHash) . txType) txs
        vmevs <- drainVM
        let obs = [b | OEBlock b <- vmevs]
        length obs `shouldBe` 1
        let otxs = obReceiptTransactions $ head obs
        length otxs `shouldBe` 2
        mapM_ ((`shouldBe` PrivateHash) . txType) otxs
        checkForUnseq [chainDetails1]
        vmevs' <- drainVM
        let obs' = [b | OEBlock b <- vmevs']
        length obs' `shouldBe` 1
        mapM_ ((`shouldBe` 2) . length . obReceiptTransactions) obs'
        let otxs1 = obReceiptTransactions $ head obs'
        txType (otxs1 !! 0) `shouldBe` Message
        txType (otxs1 !! 1) `shouldBe` PrivateHash
        checkForUnseq [chainDetails2]
        vmevs'' <- drainVM
        let obs'' = [b | OEBlock b <- vmevs'']
        mapM_ ((`shouldBe` 2) . length . obReceiptTransactions) obs''
        let otxs2 = obReceiptTransactions $ head obs''
        txType (otxs2 !! 0) `shouldBe` PrivateHash
        txType (otxs2 !! 1) `shouldBe` Message
