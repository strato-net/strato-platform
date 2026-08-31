{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

--import           Control.Monad.IO.Class
--import qualified Data.ByteString.Char8              as C8
--import           Data.Maybe
--import qualified Data.Set                           as S
--import           Data.Word

--import qualified Test.Hspec                         as HS
--import           Test.Hspec.Expectations.Lifted

--import BlockApps.Logging
--import Blockchain.Blockstanbul.Authentication
--import Blockchain.Blockstanbul.BenchmarkLib
--import Blockchain.Data.Block
--import Blockchain.Data.DataDefs
--import Blockchain.Strato.Model.Address
--import Blockchain.Strato.Model.ChainMember
--import Blockchain.Strato.Model.Secp256k1
--import Blockchain.VMContext

import Blockchain.Bagger.Transactions (TxRunResult (..), getStakeDeltasFromResults)
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ExecResults
import Blockchain.Data.ProposalFacts
import Blockchain.Data.RLP
import Blockchain.Data.VmTrace
import Blockchain.Forks (isBlockRewardReceiptForkActive)
import Blockchain.Model.SyncState (BestSequencedBlock (..))
import Blockchain.Strato.Model.Address (Address (..))
import SolidVM.Model.Delta (getStakeDeltasFromEvents)
import SolidVM.Model.Event
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..))
import Blockchain.Strato.Model.Keccak256 (zeroHash)
import Blockchain.Strato.Model.Validator
import Blockchain.VMOptions ()
import Control.Monad
import qualified Data.Map.Strict as M
import Executable.EVMFlags ()
import HFlags
import qualified CrossLangFixtureSpec
import qualified ReceiptSpec
import qualified TypedArgConversionSpec
import Test.Hspec (Spec, describe, hspec, it, shouldBe, shouldSatisfy)
import Test.QuickCheck (arbitrary, forAll)

--import qualified LabeledError

--it :: String -> ContextM () -> HS.SpecWith ()
--it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

--blk :: Block
--blk = makeBlock 1 1
--
--
--private :: PrivateKey
--private = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "private" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))
--
--
--instance HasVault ContextM where
--  sign bs = return $ signMsg private bs
--  getPub = error "called getPub, but this should never happen"
--  getShared _ = error "called getShared, but this should never happen"
--
--senderAddress :: Address
--senderAddress = fromPrivateKey private

spec :: Spec
spec = do
  describe "VMContext" $ pure ()
  ReceiptSpec.spec
  TypedArgConversionSpec.spec
  CrossLangFixtureSpec.spec
  callTraceSpec
  stakingSpec

stakingSpec :: Spec
stakingSpec = describe "staking (header v3, stake deltas, proposal facts)" $ do
  let rlpRT :: RLPSerializable a => a -> a
      rlpRT = rlpDecode . rlpDeserialize . rlpSerialize . rlpEncode
      v1 = Validator 0x1
      v2 = Validator 0x2
      stakingAddr = Address 0xd6726e06
      stakeEvent addr name args = Event zeroHash zeroHash (Address 0) "StratoStaking" addr name args
      addrArg v = ("validator", SNULL, show v, SVMType.Address False)
      weightArg st = ("weight", SNULL, show st, SVMType.Int (Just False) Nothing)
      regArg b = ("registered", SNULL, if b then "True" else "False", SVMType.Bool)
      synced v st = stakeEvent stakingAddr "ValidatorSynced" [addrArg v, regArg True, weightArg st]

  it "round trips version-3 headers through RLP" $
    forAll genBlockHeaderV3 $ \h -> rlpRT h `shouldBe` h

  it "reads legacy and current BestSequencedBlock encodings" $ do
    let bsb = BestSequencedBlock zeroHash 7 [v1, v2] [(v1, 10)] 3
    rlpRT bsb `shouldBe` bsb
    rlpDecode (RLPArray [rlpEncode zeroHash, rlpEncode (7 :: Integer), rlpEncode [v1, v2]])
      `shouldBe` BestSequencedBlock zeroHash 7 [v1, v2] [] 0

  it "reads legacy block summaries with no proposal facts" $
    forAll genBlockHeaderV3 $ \h -> do
      let bsum = blockHeaderToBSum 1 noProposalFacts h 3
          legacy = case rlpEncode bsum of
            RLPArray fields -> RLPArray (take 6 fields)
            x -> x
      bSumProposalFacts (rlpRT bsum) `shouldBe` bSumProposalFacts bsum
      bSumProposalFacts (rlpDecode legacy) `shouldBe` noProposalFacts
      bSumNumber (rlpDecode legacy) `shouldBe` number h

  it "collects ValidatorSynced from the staking contract only, last write wins" $ do
    let evs = [ synced (Address 0x1) (5 :: Integer)
              , stakeEvent 0x101 "ValidatorSynced" [addrArg (Address 0x2), regArg True, weightArg (9 :: Integer)]
              , synced (Address 0x1) (7 :: Integer)
              , stakeEvent stakingAddr "ValidatorSynced" [("validator", SNULL, "garbage", SVMType.Address False), regArg True, weightArg (9 :: Integer)]
              , stakeEvent stakingAddr "ValidatorSynced" [addrArg (Address 0x2), regArg False, weightArg (3 :: Integer)]
              ]
    getStakeDeltasFromEvents (Just stakingAddr) evs `shouldBe` M.fromList [(v1, 7), (v2, 0)]
    getStakeDeltasFromEvents Nothing evs `shouldBe` M.empty

  -- The test config is the default (upquark-shaped, staking scheduled at
  -- 1,000,000 since 3b5a4e0daf), so the block-reward receipt fork must track
  -- the staking activation height rather than switching on its own. Only
  -- helium carries a bespoke height.
  it "ties the block-reward receipt fork to staking activation off helium" $ do
    let upquarkStakingActivation = 1000000 :: Integer
    isBlockRewardReceiptForkActive 0 `shouldBe` False
    isBlockRewardReceiptForkActive 320000 `shouldBe` False
    isBlockRewardReceiptForkActive (upquarkStakingActivation - 1) `shouldBe` False
    isBlockRewardReceiptForkActive upquarkStakingActivation `shouldBe` True

  it "reads ValidatorStakeUpdated once the source is governance" $ do
    let govAddr = Address 0x100
        stakeArg st = ("stake", SNULL, show st, SVMType.Int (Just False) Nothing)
        published v st = stakeEvent govAddr "ValidatorStakeUpdated" [addrArg v, stakeArg st]
        evs = [ published (Address 0x1) (11 :: Integer)
              , synced (Address 0x2) (4 :: Integer)          -- staking is no longer watched
              , published (Address 0x1) (13 :: Integer)      -- last write wins
              , published (Address 0x2) (0 :: Integer)
              ]
    getStakeDeltasFromEvents (Just govAddr) evs `shouldBe` M.fromList [(v1, 13), (v2, 0)]
    -- and the switch really is exclusive: watching staking ignores governance
    getStakeDeltasFromEvents (Just stakingAddr) evs `shouldBe` M.fromList [(v2, 4)]

  it "merges stake updates across transactions, later transaction wins" $ do
    let er st = (solidvmErrorResults undefined) { erException = Nothing, erStakeUpdates = st }
        trr st = TxRunResult undefined (Right $ er st) 0 M.empty M.empty []
        results = [trr (M.fromList [(v1, 1), (v2, 2)]), trr (M.fromList [(v1, 3)])]
    getStakeDeltasFromResults results `shouldBe` M.fromList [(v1, 3), (v2, 2)]

  it "derives no proposal facts from pre-v3 headers" $
    forAll arbitrary $ \h -> proposalFactsFromHeader 1 0 (h :: BlockHeader) `shouldBe` noProposalFacts

  it "derives proposal facts from v3 headers" $
    forAll genBlockHeaderV3 $ \h -> do
      let facts = proposalFactsFromHeader 1 (getBlockRound h) h
      pfProposer facts `shouldBe` Address 0 -- unsealed
      pfRound facts `shouldBe` getBlockRound h
      Validator (pfIntendedProposer facts) `shouldSatisfy` (`elem` getBlockValidators h)

-- Shorthands for driving the tracer the way the SolidVM hooks do.
enter :: Maybe VmTracer -> CallType -> Address -> Address -> Integer -> IO ()
enter mt ct from to gas = traceEnterFrame mt ct from to "C" "f" [] gas

theRoot :: [CallFrame] -> IO CallFrame
theRoot [r] = pure r
theRoot rs = fail $ "expected exactly one root frame, got " ++ show (length rs)

firstCall :: CallFrame -> IO CallFrame
firstCall f = case cfCalls f of
  (c : _) -> pure c
  [] -> fail "expected a child call"

callTraceSpec :: Spec
callTraceSpec = describe "VmTrace" $ do
  let a1 = Address 0x100
      a2 = Address 0x200

  it "builds a nested call tree with gas accounting" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 Nothing
    traceExitFrame mt 70 Nothing
    (roots, truncated) <- takeTraceRoots t
    truncated `shouldBe` False
    map cfType roots `shouldBe` [CTCall]
    root <- theRoot roots
    cfGasUsed root `shouldBe` 30
    map cfGasUsed (cfCalls root) `shouldBe` [10]
    cfFrom root `shouldBe` a1
    child <- firstCall root
    cfTo child `shouldBe` a1

  it "marks every unwinding frame with the error" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 (Just "boom")
    traceExitFrame mt 75 (Just "boom")
    ([root], _) <- takeTraceRoots t
    cfError root `shouldBe` Just "boom"
    map cfError (cfCalls root) `shouldBe` [Just "boom"]

  it "attaches the output to the most recently completed frame" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 Nothing
    traceSetLastOutput mt "7"
    traceExitFrame mt 70 Nothing
    traceSetLastOutput mt "42"
    ([root], _) <- takeTraceRoots t
    cfOutput root `shouldBe` Just "42"
    map cfOutput (cfCalls root) `shouldBe` [Just "7"]

  it "attaches logs to the open frame and drops logs outside any frame" $ do
    t <- newVmTracer False
    let mt = Just t
        lg = TraceLog a2 "Added" [("amount", "5")]
    traceAddLog mt lg -- no open frame: dropped
    enter mt CTCall a1 a2 100
    traceAddLog mt lg
    traceExitFrame mt 90 Nothing
    ([root], _) <- takeTraceRoots t
    cfLogs root `shouldBe` [lg]

  it "records statements only when enabled" $ do
    tOn <- newVmTracer True
    enter (Just tOn) CTCall a1 a2 100
    traceStatement (Just tOn) "A.sol" 1 1 1 99
    traceStatement (Just tOn) "A.sol" 2 1 1 98
    traceExitFrame (Just tOn) 90 Nothing
    ([rootOn], _) <- takeTraceRoots tOn
    length (cfStatements rootOn) `shouldBe` 2

    tOff <- newVmTracer False
    enter (Just tOff) CTCall a1 a2 100
    traceStatement (Just tOff) "A.sol" 1 1 1 99
    traceExitFrame (Just tOff) 90 Nothing
    ([rootOff], _) <- takeTraceRoots tOff
    cfStatements rootOff `shouldBe` []

  it "caps statement entries and reports truncation" $ do
    t <- newVmTracer True
    let mt = Just t
    enter mt CTCall a1 a2 1000000
    forM_ [1 .. 50001 :: Int] $ \i ->
      traceStatement mt "A.sol" i 1 1 (toInteger i)
    traceExitFrame mt 0 Nothing
    ([root], truncated) <- takeTraceRoots t
    truncated `shouldBe` True
    length (cfStatements root) `shouldBe` 50000

  it "drops the zero-work bookkeeping constructor frame" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCreate a2 a1 90 -- create''s empty bookkeeping frame
    traceExitFrame mt 90 Nothing
    enter mt CTCreate a2 a1 90 -- the real constructor
    traceStatement mt "A.sol" 1 1 2 89 -- statements disabled, so prove work via gas
    traceExitFrame mt 85 Nothing
    traceExitFrame mt 80 Nothing
    ([root], _) <- takeTraceRoots t
    map cfType (cfCalls root) `shouldBe` [CTCreate]
    map cfGasUsed (cfCalls root) `shouldBe` [5]

  it "does nothing when tracing is disabled" $ do
    enter Nothing CTCall a1 a2 100
    traceExitFrame Nothing 0 Nothing
    traceSetLastOutput Nothing "x"
    t <- newVmTracer False
    (roots, truncated) <- takeTraceRoots t
    roots `shouldBe` []
    truncated `shouldBe` False

  it "closes frames left open by an exception as unwound" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    (roots, _) <- takeTraceRoots t
    map cfError roots `shouldSatisfy` all (== Just "unwound")
    root <- theRoot roots
    map cfError (cfCalls root) `shouldBe` [Just "unwound"]
