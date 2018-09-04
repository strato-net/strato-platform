{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Sequencer.SequencerSpec where


import qualified Data.Aeson                 as Ae
import           Data.Maybe                          (isNothing, fromMaybe)
import           Data.Time.Clock.POSIX
import           Data.Map                            as M (singleton,lookup)
import           Data.Either.Extra
import           Data.ByteString.Base16              as B16
import           Numeric                             (showHex)

import           Control.Concurrent
import           Control.Concurrent.STM
import           Control.Concurrent.STM.TMChan
import           Control.Exception                   (finally)
import           Control.Monad
import           Control.Monad.Logger
import           Control.Concurrent.Async             as Async
import           Control.Monad.Reader

import           Blockchain.Blockstanbul
import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import           Blockchain.Format
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.ChainHelpers
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Flags
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.OrderValidator
import           Blockchain.Strato.Model.Class       (txChainId)
import           Blockchain.Strato.Model.Address
import           Server
import           Blockchain.Blockstanbul.EventLoop
import           Blockchain.Blockstanbul.Authentication
import qualified Data.ByteString.Char8               as C8
import qualified Network.Kafka.Protocol              as KP
import qualified Network.Haskoin.Crypto     as HK

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

testWebserverPort :: Int
testWebserverPort = 8050

runTestM2 :: SequencerM a -> IO ()
runTestM2 m = do
  gb <- makeGenesisBlock
  void $ withTemporaryDepBlockDBbs gb m

withTemporaryDepBlockDBbs :: IngestBlock -> SequencerM a -> IO ()
withTemporaryDepBlockDBbs genesisBlock m = do
    cwd          <- getCurrentDirectory
    randomSuffix <- generate $ (arbitrary :: Gen Integer) `suchThat` (>1000)
    timestamp    <- round <$> getPOSIXTime  :: IO Integer
    let fullPath ="./.ethereumH/dep_block_" ++ show timestamp ++ "_" ++ showHex randomSuffix "" ++ "/"
        tempKCID ="sequencer_" ++ show timestamp ++ "_" ++ showHex randomSuffix ""
    setCurrentDirectory "../" -- for ethconf to be happy
    createDirectoryIfMissing True fullPath
    let eAuthSenders = Ae.eitherDecodeStrict (C8.pack flags_blockstanbul_authorized_addresses) :: Either String [Address]
    let authSenders = fromRight (error "invalid sender addresses") eAuthSenders
    ch <- atomically $ newTMChan
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
                               , blockstanbulBeneficiary = ch
                               , blockstanbulAuthSenders = authSenders
                               }
    let eValidators = Ae.eitherDecodeStrict (C8.pack flags_validators) :: Either String [Address]
        validatrs = fromRight (error "invalid validators") eValidators
        ctx = newContext (View 0 0) validatrs
    mCtx <- if not flags_blockstanbul
             then return Nothing
             else do
                let bytes = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN6tvu8"
                    pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
                putStrLn . ("NODEKEY address: " ++) . formatAddress . prvKey2Address $ pkey
                return . Just . ctx $ pkey
    race_ (runLoggingT (runSequencerM cfg mCtx (bootstrap (ingestBlockToBlock genesisBlock) >> m)) printLogMsg) (webserver testWebserverPort ch)
        `finally`
        (removeDirectoryRecursive fullPath >> setCurrentDirectory cwd)-- always clean up

withTemporaryDepBlockDB :: IngestBlock -> SequencerM a -> IO a
withTemporaryDepBlockDB genesisBlock m = do
    cwd          <- getCurrentDirectory
    randomSuffix <- generate $ (arbitrary :: Gen Integer) `suchThat` (>1000)
    timestamp    <- round <$> getPOSIXTime  :: IO Integer
    let fullPath ="./.ethereumH/dep_block_" ++ show timestamp ++ "_" ++ showHex randomSuffix "" ++ "/"
        tempKCID ="sequencer_" ++ show timestamp ++ "_" ++ showHex randomSuffix ""
    setCurrentDirectory "../" -- for ethconf to be happy
    createDirectoryIfMissing True fullPath
    ch <- atomically $ newTMChan
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
                               , blockstanbulBeneficiary = ch
                               , blockstanbulAuthSenders = []
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

      it "checks for votes" $ runTestM2 $ do
        bc <- getBlockstanbulContext
        case bc of
          Nothing -> do
            expectationFailure "BlockstanbulContext required"
          Just bct -> do
            let pvk = _prvkey bct
                addr = prvKey2Address pvk
                (testAddr :: Address) = 0x3263b65db202c4c2227a7e2a53b6b1f37b2edd0b
            --create the extendedsignature for (beneficiary, nonce)
            esign <- signBenfInfo pvk (testAddr, True)
            --rlp seilize and hex and string the signature
            let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
                vote = (addr, esignStr, testAddr,True)
            liftIO $ uploadVote testWebserverPort vote
            local (\cfg -> cfg{blockstanbulAuthSenders = [addr]}) $ do
              checkForVotes
              bct' <- getBlockstanbulContext
              let unwrapbct = fromMaybe bct bct'
              let pv = _pendingvotes unwrapbct
                  val = M.lookup testAddr pv
                  nonc = fromMaybe False val
              nonc `shouldBe` True
              pv `shouldBe` (M.singleton testAddr True)
