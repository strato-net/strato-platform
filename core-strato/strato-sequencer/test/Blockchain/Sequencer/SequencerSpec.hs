{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.SequencerSpec where

import           Data.Maybe                          (isNothing)
import           Data.Time.Clock.POSIX
import           Numeric                             (showHex)

import           Control.Concurrent
import           Control.Exception                   (finally)
import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.Reader

import           Blockchain.Format
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import           Blockchain.Strato.Model.Class       (txChainId)

import qualified Data.ByteString.Char8               as C8
import qualified Network.Kafka.Protocol              as KP

import           Test.Hspec.Core.Spec
import           Test.Hspec.Expectations.Lifted
import           Test.Hspec.Contrib.HUnit            ()
import           Test.HUnit
import           Test.QuickCheck

import           System.Directory                    (createDirectoryIfMissing, getCurrentDirectory,
                                                      removeDirectoryRecursive, setCurrentDirectory)

stripTransactionsAndUncles :: IngestBlock -> IngestBlock
stripTransactionsAndUncles b = b { ibReceiptTransactions = [], ibBlockUncles = [] }

dedupWindow :: Int
dedupWindow = 100

runTestM :: SequencerM a -> IO ()
runTestM m = do
  gb <- makeGenesisBlock
  void $ withTemporaryDepBlockDB gb m

withTemporaryDepBlockDB :: IngestBlock -> SequencerM a -> IO a
withTemporaryDepBlockDB genesisBlock m = do
    cwd          <- getCurrentDirectory
    randomSuffix <- generate $ (arbitrary :: Gen Integer) `suchThat` (>1000)
    timestamp    <- round <$> getPOSIXTime  :: IO Integer
    let fullPath ="./.ethereumH/dep_block_" ++ show timestamp ++ "_" ++ showHex randomSuffix "" ++ "/"
        tempKCID ="sequencer_" ++ show timestamp ++ "_" ++ showHex randomSuffix ""
    setCurrentDirectory "../" -- for ethconf to be happy
    createDirectoryIfMissing True fullPath
    let kcid = KP.KString (C8.pack tempKCID)
        cfg  = SequencerConfig { depBlockDBCacheSize   = 0
                               , depBlockDBPath        = fullPath
                               , kafkaAddress          = Just (KP.Host (KP.KString "unused"), KP.Port 0000)
                               , kafkaClientId         = kcid
                               , kafkaConsumerGroup    = KP.ConsumerGroup (KP.KString "fake")
                               , seenTransactionDBSize = dedupWindow
                               , syncWrites            = False
                               , bootstrapDoEmit       = False
                               , statsConfig           = Nothing
                               , blockstanbulBlockPeriod = 0
                               , blockstanbulRoundPeriod = 10000000
                               }

    runLoggingT (runSequencerM cfg Nothing (bootstrap (ingestBlockToBlock genesisBlock) >> m)) printLogMsg
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
            outBlocks <- withTemporaryDepBlockDB gb $ do
              splitEvents (IEBlock <$> inChain)
              oes <- drainVM
              return [block | OEBlock block <- oes ]
            ret <- validateOrder gb outBlocks
            ret `shouldSatisfy` isValid

        it "transformEvents should output blocks in partial order based on parent hash when input is out of order" $ do
            gb <- makeGenesisBlock
            inChain <- buildIngestChain gb 8 2
            shuffled <- generate $ shuffle inChain
            outBlocks <- withTemporaryDepBlockDB gb $ do
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
            outTxs <- withTemporaryDepBlockDB gb $ do
              splitEvents (IETx ts <$> inTxs)
              oes <- drainVM
              return [o | o@(OETx _ _) <- oes]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn = feedBackOutputsToInput outTxs
            dedupedOut <- withTemporaryDepBlockDB gb $ do
              splitEvents dedupedIn
              drainVM
            length dedupedOut `shouldBe` length dedupedIn

        it ("should allow duplicate incoming transactions that come in after a specified window (" ++ show dedupWindow ++ " txs)") $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (2 * dedupWindow, (3 * dedupWindow) - 1)
            inTxs  <- generate . vectorOf inTxSize $ suchThat arbitrary (isNothing . txChainId . itTransaction)
            outTxs <- withTemporaryDepBlockDB gb $ do
              splitEvents (IETx ts <$> inTxs)
              oes <- drainVM
              return [o | o@(OETx _ _) <- oes]
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn          = feedBackOutputsToInput outTxs
                replicationsNeeded = (dedupWindow `quot` length dedupedIn) + 1
                replicatedIn       = concat $ replicate replicationsNeeded dedupedIn
            dedupedOut <- withTemporaryDepBlockDB gb $ do
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
        local (\cfg -> cfg{blockstanbulRoundPeriod=0}) $ do
          mapM_ createNewTimer input
        liftIO $ threadDelay 200 -- Who are you to judge?
        out <- drainTimeouts
        out `shouldMatchList` input
