{- ORMOLU_DISABLE -}
{-# OPTIONS -fno-warn-unused-imports              #-}
{-# LANGUAGE OverloadedStrings                    #-}
{-# LANGUAGE RecordWildCards                      #-}
{-# LANGUAGE ScopedTypeVariables                  #-}
{-# LANGUAGE TemplateHaskell                      #-}
{-# LANGUAGE TypeApplications                     #-}
{-# OPTIONS_GHC -fno-warn-incomplete-uni-patterns #-}

module Blockchain.Sequencer.SequencerSpec where

import           ClassyPrelude                       (atomically)
import qualified Data.ByteString                     as BS
import           Data.IORef
import           Data.Maybe                          (fromMaybe, isNothing)
import           Data.Time.Clock.POSIX
import qualified Data.Map                            as M
import qualified Data.Set                            as S
import           Data.Maybe                          (isJust)
import           Data.ByteString.Base16              as B16
import qualified Data.Text                           as T
import           Numeric                             (showHex)

import           Conduit
import           Control.Concurrent
import           Control.Concurrent.STM.TMChan
import           Control.Concurrent.STM.TQueue
import           Control.Concurrent.STM.TBQueue
import           Control.Exception                   (finally)
import           Control.Monad
import qualified Control.Monad.Change.Alter          as A
import qualified Control.Monad.Change.Modify         as Mod
import           Control.Monad.IO.Class              (liftIO)
import           Control.Concurrent.Async             as Async
import           Control.Monad.Reader
import           Control.Monad.State.Class
import           BlockApps.Logging
import           BlockApps.X509.Certificate          hiding (isValid)
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.BenchmarkLib (makeBlock, makeBlockWithTransactions)
import           Blockchain.Blockstanbul.EventLoop
import           Blockchain.Blockstanbul.Messages hiding (round)
import           Blockchain.Blockstanbul.StateMachine
import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction         (createChainMessageTX)
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin as TO
import           Blockchain.Privacy.Monad
import           Blockchain.Sequencer
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Keccak256         as Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Validator (Validator)
import qualified Blockchain.Strato.Model.Validator as Validator
import qualified Data.ByteString.Char8               as C8
import qualified LabeledError
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
myPriv = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "myPriv" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

runTestM :: SequencerM a -> IO ()
runTestM m = do
  gb <- makeGenesisBlock
  void $ withTemporaryDepBlockDB False gb m

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
    tch <- atomically newTMChan
    let
        cfg  = SequencerConfig { depBlockDBCacheSize   = 0
                               , depBlockDBPath        = fullPath
                               , seenTransactionDBSize = dedupWindow
                               , syncWrites            = False
                               , blockstanbulBlockPeriod = BlockPeriod 0
                               , blockstanbulRoundPeriod = RoundPeriod 10000000
                               , blockstanbulTimeouts = tch
                               , cablePackage = pkg
                               , maxUsPerIter = 200
                               , maxEventsPerIter = 10
                               , vaultClient = Nothing
                               , kafkaClientId = "dummyClientId"
                               , redisConn = error "withTemporaryDepBlockDB: redisConn"
                               }
        myAddr = fromPrivateKey myPriv
        myCM = CommonName "BlockApps" "Engineering" "Admin" True
        vals = [chainMemberParsedSetToValidator myCM]
        ctx = newContext (Checkpoint (View 0 0) vals) Nothing True (Just myCM)
        mCtx = if pbft then Just ctx else Nothing
        hsh = blockHash . ingestBlockToBlock $ genesisBlock
        difficulty = blockHeaderDifficulty . ibBlockData $ genesisBlock
        cmpsToXcis a (CommonName o u n True) = X509CertInfoState a rootCert True [] (T.unpack o) (Just $ T.unpack u) (T.unpack n)
        cmpsToXcis _ _ = error "cmpsToXcis"
        boot = do
          bootstrapGenesisBlock hsh difficulty
          A.insert (A.Proxy @X509CertInfoState) myAddr $ cmpsToXcis myAddr myCM
          A.insert (A.Proxy @EmittedBlock) hsh alreadyEmittedBlock
    runNoLoggingT (runSequencerM cfg mCtx (boot >> m))
      `finally`
      (removeDirectoryRecursive fullPath >> setCurrentDirectory cwd)-- always clean up

feedBackOutputsToInput :: [VmEvent] -> [IngestEvent]
feedBackOutputsToInput = map rebox
    where rebox (VmTx ts t) = IETx ts $ unboxTx t
          rebox (VmBlock (OutputBlock origin _ header txs uncles)) = IEBlock $ IngestBlock origin header (unboxBlockTx <$> txs) uncles
          rebox x = error $ "why are we testing against " ++ show x
          unboxTx (OutputTx origin _ _ base _) = IngestTx origin base
          unboxBlockTx (OutputTx _ _ _ base _) = base

mkBlk :: Keccak256 -> Integer -> SequencerM Block
mkBlk parent num = do
  ctx <- fromMaybe (error "context required for PBFT") <$> getBlockstanbulContext
  let blk0 = makeBlock 2 1
      blk1 = Block (blockBlockData blk0){parentHash = parent} (blockReceiptTransactions blk0) (blockBlockUncles blk0)
      blk2 = addValidators (_validators ctx) blk1{
                 blockBlockData = (blockBlockData blk1){number = num}}
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
      -- This test sets off three timers, which will fire every millisecond
      -- Each timer begins by writing the number passed to it to an IORef,
      -- which stores the current round number. When each timer fires,
      -- it checks the current round number in the IORef. If the current
      -- round number is less than or equal to the value passed to the timer,
      -- the timer will reset itself to fire after another millisecond.
      -- Each timer will fire at least once, even if the current round number
      -- is greater than its value when it is first initialized.
      -- In this test, since 45 is immediately written to the IORef after 20,
      -- the timer for 20 should only fire once. The timer for 30 should
      -- only fire once, since the IORef will already have 45 stored by the
      -- time the timer for 30 is set. The timer for 45 will repeatedly fire
      -- until after the threadDelay, when the IORef is set to 200. The call
      -- to drainTimeouts gets the list of all occurrences of timers firing
      -- since the beginning of the test. 20 and 30 should show up only once,
      -- and 45 should show up more than once.
      -- NOTE: This test can fail in two ways:
      --   1. The initial timer for 45 is set more than 1 ms after the timer
      --      for 20, so the timer for 20 resets itself. This results in
      --      20 being in the list from drainTimeouts more than once.
      --   2. The timer for 45 does not fire more than once before the end
      --      of the threadDelay.
      -- If this test fails, it indicates that the machine on which the test
      -- is run is overloaded. However, with round period timeout of 1 ms,
      -- and a threadDelay of 100 ms, this should be ample time for the test
      -- to run correctly, even if the machine is under heavy load.
      it "queues timeouts -- with retries" $ runTestM $ do
        let input = [20, 45, 30]
        local (\cfg -> cfg{blockstanbulRoundPeriod = RoundPeriod 0.001}) $
          mapM_ createNewTimer input
        liftIO $ threadDelay 100000 -- Who are you to judge?
        rnref <- gets _latestRoundNumber
        liftIO $ atomicWriteIORef rnref 200
        out <- drainTimeouts
        filter (==20) out `shouldBe` [20]
        filter (==30) out `shouldBe` [30]
        filter (==45) out `shouldContain` [45, 45]

    describe "fuseChannels" $ do
      it "should multiplex event types" $ withMaxSuccess 5 $ property $ \rn iev -> runTestM $ do
        tch <- asks blockstanbulTimeouts
        atomically . writeTMChan tch $ rn
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTBQueue uch $ iev
        src0 <- sealConduitT <$> fuseChannels
        (src1, ev1) <- src0 $$++ headC
        (_, ev2) <- src1 $$++ headC
        [ev1, ev2] `shouldMatchList` [Just $ TimerFire rn, Just $ UnseqEvent iev]

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
            b = Block (blockBlockData b'){ parentHash = h
                                         , number = 1
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
            blk1 = Block (blockBlockData blk0){parentHash = h} (blockReceiptTransactions blk0) (blockBlockUncles blk0)
            blk2 = addValidators (_validators ctx) blk1{
                      blockBlockData = (blockBlockData blk1){number = 1}}
        pseal <- proposerSeal blk2
        let blk3 = addProposerSeal pseal blk2
        cseal <- commitmentSeal (blockHash blk3)
        let blk4 = addCommitmentSeals [cseal] blk3
            iev = IEBlock . blockToIngestBlock TO.Morphism $ blk4
        putBlockstanbulContext ctx
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [iev]
        length _toP2p `shouldBe` 1
        _toVm `shouldContain` [VmCreateBlockCommand]
        map outputBlockToBlock [oblk | P2pBlock oblk <- _toP2p] `shouldMatchList` [blk4]
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
        length _toP2p `shouldBe` 5
        _toVm `shouldContain` [VmCreateBlockCommand]
        map outputBlockToBlock [oblk | P2pBlock oblk <- _toP2p] `shouldMatchList` blkChn
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
      let getChainInfo lbl = ChainInfo
                                 (UnsignedChainInfo lbl [] [] (ChainMembers S.empty) M.empty (unsafeCreateKeccak256FromWord256 0) 0 M.empty)
                                 (ChainSignature 1 2 3)
          getChainIdAndDetails cInfo =
            let chainId = Keccak256.rlpHash cInfo
             in (chainId, IEGenesis (IngestGenesis TO.Morphism (keccak256ToWord256 chainId, cInfo)))
          getChainTx chainId = do
            tx <- runIO $ do
              pk <- newPrivateKey
              createChainMessageTX 0 1 1 (Address 0xdeadbeef) 0 BS.empty (Just $ keccak256ToWord256 chainId) Nothing pk
            let hashTx = PrivateHashTX (txHash tx) chainId
            pure (hashTx, tx)

      -- chain 1
      let (chainId1, chainDetails1) = getChainIdAndDetails $ getChainInfo "my test chain 1"
      (hashTx1, tx1) <- getChainTx chainId1

      -- chain 2
      let (chainId2, chainDetails2) = getChainIdAndDetails $ getChainInfo "my test chain 2"
      (hashTx2, tx2) <- getChainTx chainId2

      -- chain 3 (child of chain 1)
      let ChainInfo uci sig = getChainInfo "my test chain 3"
          uci' = uci{parentChains = M.singleton "parent" $ keccak256ToWord256 chainId1}
      let (chainId3, chainDetails3) = getChainIdAndDetails $ ChainInfo uci' sig
      (hashTx3, tx3) <- getChainTx chainId3

      let b1' = makeBlockWithTransactions [hashTx1]
          blk1' h = Block (blockBlockData b1'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b1')
                      (blockBlockUncles b1')
          iev1' = IEBlock . blockToIngestBlock TO.Morphism . blk1'
          b2' = makeBlockWithTransactions [hashTx1, hashTx2]
          blk2' h = Block (blockBlockData b2'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b2')
                      (blockBlockUncles b2')
          iev2' = IEBlock . blockToIngestBlock TO.Morphism . blk2'
          b3' = makeBlockWithTransactions [hashTx1, hashTx3]
          blk3' h = Block (blockBlockData b3'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b3')
                      (blockBlockUncles b3')
          iev3' = IEBlock . blockToIngestBlock TO.Morphism . blk3'
          b4' = makeBlockWithTransactions [hashTx3]
          blk4' h = Block (blockBlockData b4'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b4')
                      (blockBlockUncles b4')
          iev4' = IEBlock . blockToIngestBlock TO.Morphism . blk4'

      it "should forward a private transaction hash" . runTestM $ do
        th <- fmap Keccak256.hash . liftIO $ getEntropy 32
        ch <- fmap Keccak256.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [IETx 0 (IngestTx TO.Morphism hashTx)]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        map (isJust . otPrivatePayload) txs `shouldBe` [False]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [PrivateHash]
        map (isJust . otPrivatePayload) txs' `shouldBe` [False]

      it "should forward a private transaction hash only once" . runTestM $ do
        th <- fmap Keccak256.hash . liftIO $ getEntropy 32
        ch <- fmap Keccak256.hash . liftIO $ getEntropy 32
        let hashTx = PrivateHashTX th ch
            ietx = IETx 0 (IngestTx TO.Morphism hashTx)
        BatchSeqEvent{..} <- runBatch $ checkForUnseq [ietx,ietx]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        map (isJust . otPrivatePayload) txs `shouldBe` [False]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [PrivateHash]
        map (isJust . otPrivatePayload) txs' `shouldBe` [False]

      it "should create a PrivateHashTX for a private transaction" . runTestM $ do
        BatchSeqEvent{..} <- runBatch $ do
          checkForUnseq [chainDetails1]
          checkForUnseq [IETx 0 (IngestTx TO.API tx1)]
        let txs = [tx | VmTx _ tx <- _toVm]
        map txType txs `shouldBe` [PrivateHash]
        map (isJust . otPrivatePayload) txs `shouldBe` [False]
        let txs' = [tx | P2pTx tx <- _toP2p]
        map txType txs' `shouldBe` [Message, PrivateHash]
        map (isJust . otPrivatePayload) txs' `shouldBe` [False, False]

      it "should run Blockstanbul with private transactions" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev1' h
        BatchSeqEvent{..} <- runBatch $ do
          checkForUnseq [chainDetails1]
          checkForUnseq [IETx 0 (IngestTx TO.Morphism tx1)]
          checkForUnseq [iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs `shouldBe` [[Just Message]]

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
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs' `shouldBe` [[Just Message]]

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
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs `shouldBe`
          [[Just Message, Just Message]]

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
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[PrivateHash, PrivateHash],[PrivateHash, PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs' `shouldBe`
          [[Just Message, Nothing], [Just Message, Just Message]]

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
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[PrivateHash, PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs' `shouldBe`
          [[Just Message, Nothing]]
        b3 <- runBatch $ checkForUnseq [chainDetails2]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash, PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message, Just Message]]

      it "should hydrate child chain transaction when parent chain is known" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev4' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [chainDetails1, chainDetails3, ietx tx3, iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs `shouldBe`
          [[Just Message]]

      it "should withhold child chain transactions when parent chain is missing" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev3' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [ietx tx1, ietx tx3, iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash,PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash,PrivateHash]]
        b2 <- runBatch $ checkForUnseq [chainDetails3]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` []
        b3 <- runBatch $ checkForUnseq [chainDetails1]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash, PrivateHash], [PrivateHash, PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message, Nothing], [Just Message, Just Message]]

      it "should withhold child chain transactions when parent chain is missing even when there are no transactions on the parent chain" . runPBFTTestMWithGenesis $ \h -> do
        let iev = iev4' h
            ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [ietx tx3, iev]
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash]]
        b2 <- runBatch $ checkForUnseq [chainDetails3]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` []
        b3 <- runBatch $ checkForUnseq [chainDetails1]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message]]

      it "should withhold child chain transactions when parent chain parent chain transactions are missing" . runPBFTTestMWithGenesis $ \h -> do
        let b5' = makeBlockWithTransactions [hashTx1]
            blk5' = Block (blockBlockData b5'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b5')
                      (blockBlockUncles b5')
            iev5' = IEBlock $ blockToIngestBlock TO.Morphism blk5'
            b6' = makeBlockWithTransactions [hashTx3]
            blk6' h' = Block (blockBlockData b6'){ parentHash = h'
                                                 , number = 2
                                                 }
                         (blockReceiptTransactions b6')
                         (blockBlockUncles b6')
            iev6' = IEBlock . blockToIngestBlock TO.Morphism . blk6'
        let ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [chainDetails1, chainDetails3, ietx tx3, iev5']
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map otPrivatePayload . obReceiptTransactions) obs `shouldBe` [[Nothing]]
        let h' = head [h'' | P2pBlockstanbul (WireMessage _ (Commit _ h'' _)) <- _toP2p b1]
        b2 <- runBatch $ checkForUnseq [iev6' h']
        let bs' = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b2]
        map (map txType . blockReceiptTransactions) bs' `shouldBe` [[PrivateHash]]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map otPrivatePayload . obReceiptTransactions) obs' `shouldBe` [[Nothing]]
        b3 <- runBatch $ checkForUnseq [ietx tx1]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash], [PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message], [Just Message]]

      it "should withhold child chain transactions when parent chain parent chain info is missing" . runPBFTTestMWithGenesis $ \h -> do
        let b5' = makeBlockWithTransactions [hashTx1]
            blk5' = Block (blockBlockData b5'){ parentHash = h
                                              , number = 1
                                              }
                      (blockReceiptTransactions b5')
                      (blockBlockUncles b5')
            iev5' = IEBlock $ blockToIngestBlock TO.Morphism blk5'
            b6' = makeBlockWithTransactions [hashTx3]
            blk6' h' = Block (blockBlockData b6'){ parentHash = h'
                                                 , number = 2
                                                 }
                         (blockReceiptTransactions b6')
                         (blockBlockUncles b6')
            iev6' = IEBlock . blockToIngestBlock TO.Morphism . blk6'
        let ietx = IETx 0 . IngestTx TO.Morphism
        b1 <- runBatch $ checkForUnseq [chainDetails3, ietx tx1, ietx tx3, iev5']
        let bs = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b1]
        map (map txType . blockReceiptTransactions) bs `shouldBe` [[PrivateHash]]
        let obs = [b | VmBlock b <- _toVm b1]
        map (map txType . obReceiptTransactions) obs `shouldBe` [[PrivateHash]]
        let h' = head [h'' | P2pBlockstanbul (WireMessage _ (Commit _ h'' _)) <- _toP2p b1]
        b2 <- runBatch $ checkForUnseq [iev6' h']
        let bs' = [b | P2pBlockstanbul (WireMessage _ (Preprepare _ b)) <- _toP2p b2]
        map (map txType . blockReceiptTransactions) bs' `shouldBe` [[PrivateHash]]
        let obs' = [b | VmBlock b <- _toVm b2]
        map (map txType . obReceiptTransactions) obs' `shouldBe` [[PrivateHash]]
        b3 <- runBatch $ checkForUnseq [chainDetails1]
        let obs'' = [b | VmBlock b <- _toVm b3]
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash], [PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message], [Just Message]]

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
        map (map txType . obReceiptTransactions) obs'' `shouldBe` [[PrivateHash]]
        map (map (fmap txType . otPrivatePayload) . obReceiptTransactions) obs'' `shouldBe`
          [[Just Message]]

      it "should emit chain info when creation block has already been emitted" . runPBFTTestMWithGenesis $ \h -> do
        let cInfo' = getChainInfo "emittable"
            ucInfo = chainInfo cInfo'
            cInfo = cInfo'{chainInfo = ucInfo{creationBlock = h}}
        let chainDetails = snd . getChainIdAndDetails $ cInfo
            IEGenesis ig = chainDetails
            og = ingestGenesisToOutputGenesis ig
        b1 <- runBatch $ do
          checkForUnseq [chainDetails]
        let ogs = [og' | VmGenesis og' <- _toVm b1]
        ogs `shouldBe` [og]

      it "should withhold emitting chain info when creation block has not been emitted" . runPBFTTestMWithGenesis $ \_ -> do
        let cInfo' = getChainInfo "unemittable"
            ucInfo = chainInfo cInfo'
            cInfo = cInfo'{chainInfo = ucInfo{creationBlock = unsafeCreateKeccak256FromWord256 0xdeadbeef}}
        let chainDetails = snd . getChainIdAndDetails $ cInfo
        b1 <- runBatch $ do
          checkForUnseq [chainDetails]
        let ogs = [og' | VmGenesis og' <- _toVm b1]
        ogs `shouldBe` []

      it "should withhold chain info until creation block has been emitted" . runPBFTTestMWithGenesis $ \h -> do
        blk <- mkBlk h 1
        let iblk = blockToIngestBlock TO.Morphism blk
            ieblk = IEBlock iblk
            blkHash = blockHash blk
            cInfo' = getChainInfo "delayed emittable"
            ucInfo = chainInfo cInfo'
            cInfo = cInfo'{chainInfo = ucInfo{creationBlock = blkHash}}
            chainDetails = snd . getChainIdAndDetails $ cInfo
            IEGenesis ig = chainDetails
            OutputGenesis _ og = ingestGenesisToOutputGenesis ig
        b1 <- runBatch $ do
          checkForUnseq [chainDetails]
        let ogs = [og' | VmGenesis og' <- _toVm b1]
        ogs `shouldBe` []
        b2 <- runBatch $ do
          checkForUnseq [ieblk]
        let zipped = zip [(0::Int)..] $ _toVm b2
        let obs = [(i, ob) | (i, VmBlock ob) <- zipped]
        length obs `shouldBe` 1
        let [(i, ob)] = obs
        obBlockData ob `shouldBe` ibBlockData iblk
        let ogs2 = [(j, og') | (j, VmGenesis (OutputGenesis _ og')) <- zipped]
        length ogs2 `shouldBe` 1
        let [(j, og2)] = ogs2
        og2 `shouldBe` og
        i `shouldSatisfy` (< j)

