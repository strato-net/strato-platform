module Blockchain.Sequencer.SequencerSpec where

import           Data.Time.Clock.POSIX
import           Numeric                             (showHex)

import           Control.Exception                   (finally)
import           Control.Monad.Logger
import           Control.Monad.Stats

import           Blockchain.EthConf                  (lookupConsumerGroup, runStatsTConfigured)
import           Blockchain.Format
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator

import qualified Data.ByteString.Char8               as C8
import qualified Network.Kafka.Protocol              as KP

import           Test.Hspec
import           Test.Hspec.Contrib.HUnit            ()
import           Test.HUnit
import           Test.QuickCheck

import           System.Directory                    (createDirectoryIfMissing, getCurrentDirectory,
                                                      removeDirectoryRecursive, setCurrentDirectory)

stripTransactionsAndUncles :: IngestBlock -> IngestBlock
stripTransactionsAndUncles b = b { ibReceiptTransactions = [], ibBlockUncles = [] }

dedupWindow :: Int
dedupWindow = 100

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
                               , kafkaClientId         = kcid
                               , kafkaConsumerGroup    = lookupConsumerGroup kcid
                               , seenTransactionDBSize = dedupWindow
                               , syncWrites            = False
                               , bootstrapDoEmit       = True
                               }

    runLoggingT (runStatsTConfigured (runSequencerM cfg (bootstrap (ingestBlockToBlock genesisBlock) >> m))) printLogMsg
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
            outChain <- withTemporaryDepBlockDB gb $ transformEvents (IEBlock <$> inChain)
            ret <- validateOrder gb $ extractBlocksFromOutputEvents . snd $ outChain
            assertBool (format ret) $ isValid ret

        it "transformEvents should output blocks in partial order based on parent hash when input is out of order" $ do
            gb <- makeGenesisBlock
            inChain <- buildIngestChain gb 8 2
            shuffled <- generate $ shuffle inChain
            outChain <- withTemporaryDepBlockDB gb $ transformEvents (IEBlock <$> shuffled)
            ret <- validateOrder gb $ extractBlocksFromOutputEvents . snd $ outChain
            assertBool (format ret) $ isValid ret

        it "should not deduplicate incoming transactions that are unique" $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (10, dedupWindow - 1)
            inTxs  <- generate $ vectorOf inTxSize arbitrary
            outTxs <- withTemporaryDepBlockDB gb $ transformEvents (IETx ts <$> inTxs)
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn = feedBackOutputsToInput (snd outTxs)
            dedupedOut <- withTemporaryDepBlockDB gb $ transformEvents dedupedIn
            assertBool ((show . length $ dedupedIn) ++ " /= " ++ (show . length . snd $ dedupedOut)) $
                length dedupedIn == (length . snd $ dedupedOut)

        it ("should allow duplicate incoming transactions that come in after a specified window (" ++ show dedupWindow ++ " txs)") $ do
            gb <- makeGenesisBlock
            ts <- generate arbitrary
            inTxSize <- generate $ choose (2 * dedupWindow, (3 * dedupWindow) - 1)
            inTxs  <- generate $ vectorOf inTxSize arbitrary
            outTxs <- withTemporaryDepBlockDB gb $ transformEvents (IETx ts <$> inTxs)
            -- ^^ in case any arbitrary Txs weren't unique
            let dedupedIn          = feedBackOutputsToInput (snd outTxs)
                replicationsNeeded = (dedupWindow `quot` length dedupedIn) + 1
                replicatedIn       = concat $ replicate replicationsNeeded dedupedIn
            dedupedOut <- withTemporaryDepBlockDB gb $ transformEvents replicatedIn
            assertBool ((show . length $ replicatedIn) ++ " /= " ++ (show . length . snd $ dedupedOut)) $
                length replicatedIn == (length . snd $ dedupedOut)
