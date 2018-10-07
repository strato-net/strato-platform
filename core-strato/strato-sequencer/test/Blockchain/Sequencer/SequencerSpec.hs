{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Sequencer.SequencerSpec where


import           ClassyPrelude                       (atomically)
import           Data.Maybe                          (isNothing, fromMaybe)
import           Data.Time.Clock
import           Data.Time.Clock.POSIX
import           Data.Map                            as M (singleton,lookup)
import           Data.ByteString.Base16              as B16
import           Numeric                             (showHex)

import           Conduit
import           Control.Concurrent
import           Control.Concurrent.STM.TMChan
import           Control.Exception                   (finally)
import           Control.Monad
import           Control.Monad.Logger
import           Control.Concurrent.Async             as Async
import           Control.Monad.Reader

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Blockstanbul.EventLoop
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import           Blockchain.Format
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import           Blockchain.Strato.Model.Class       (txChainId, blockHash, blockHeaderDifficulty)
import qualified Data.ByteString.Char8               as C8
import qualified Network.Haskoin.Crypto     as HK
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Prometheus
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
      race (runLoggingT (runSequencerM cfg mCtx (boot >> m)) printLogMsg)
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

      it "queues timeouts" $ runTestM $ do
        let input = [20, 45, 30]
        local (\cfg -> cfg{blockstanbulRoundPeriod=0}) $
          mapM_ createNewTimer input
        liftIO $ threadDelay 200 -- Who are you to judge?
        out <- drainTimeouts
        out `shouldMatchList` input

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
            esign <- signBenfInfo pvk (testAddr, True)
            --rlp serialize and hex and string the signature
            let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
                vote = API.CandidateReceived{API.sender=addr
                                           , API.signature=esignStr
                                           , API.recipient=testAddr
                                           , API.votingdir=True
                                           , API.nonce = 1}
            liftIO $ API.uploadVote testWebserverPort vote
            voteList <- drainVotes
            voteList `shouldMatchList` [vote]
            checkForVotes voteList
            bct' <- getBlockstanbulContext
            let unwrapbct = fromMaybe bct bct'
            let pv = _pendingvotes unwrapbct
                val = M.lookup testAddr pv
            val `shouldBe` Just True
            pv `shouldBe` M.singleton testAddr True
            esign' <- signBenfInfo pvk (testAddr, False)
            let esignStr' = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign')
                vote' = API.CandidateReceived{API.sender=addr
                                            , API.signature=esignStr'
                                            , API.recipient=testAddr
                                            , API.votingdir=False
                                            , API.nonce = 1}
            liftIO $ API.uploadVote testWebserverPort vote'
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
        atomically . writeTMChan uch $ iev
        vch <- asks blockstanbulBeneficiary
        atomically . writeTMChan vch $ vote
        src0 <- newResumableSource <$> fuseChannels
        (src1, ev1) <- src0 $$++ headC
        (src2, ev2) <- src1 $$++ headC
        (_, ev3) <- src2 $$++ headC
        [ev1, ev2, ev3] `shouldMatchList` [Just $ TimerFire rn, Just $ UnseqEvent iev, Just $ VoteMade vote]

    describe "sequencer" $ do
      it "should be able to run in a test" $ withMaxSuccess 5 $ property $ \iev -> runTestM $ do
        uch <- asks $ unseqEvents . cablePackage
        atomically . writeTMChan uch $ iev
        src <- newResumableSource <$> fuseChannels
        void $ oneSequencerIter src

      it "should not only return 1 event if multiple are pending" . runTestM $ do
        tch <- asks blockstanbulTimeouts
        atomically $ do
          writeTMChan tch 20
          writeTMChan tch 34
          writeTMChan tch 92
        src <- newResumableSource <$> fuseChannels
        (_, evs) <- readEventsInBufferedWindow src
        evs `shouldMatchList` map TimerFire [20, 34, 92]

      it "should not return more than the fetchlimit" . runTestM $ do
        tch <- asks blockstanbulTimeouts
        src <- newResumableSource <$> fuseChannels
        atomically $ mapM_ (writeTMChan tch) [10..30]
        (_, evs) <- readEventsInBufferedWindow src
        evs `shouldMatchList` map TimerFire [10..19]
