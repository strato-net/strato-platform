{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | Consensus behaviour introduced with stake-weighted proposer selection:
-- per-height rounds, view-aware timeouts, stake bookkeeping and the extra
-- checks on proposed blocks.
module StakingConsensusSpec (spec) where

import BlockApps.Logging (LoggingT, runNoLoggingT)
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Model.Authentication (proposalMessage)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.ProposerSelection
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Lens hiding (view)
import Conduit (runConduit, sinkNull, yieldMany, (.|))
import Control.Monad (forM_)
import Control.Monad.Composable.Vault
import Control.Monad.State.Strict
import qualified Data.ByteString.Char8 as C8
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import qualified LabeledError
import Test.Hspec
import Prelude hiding (round, sequence)

myPriv :: PrivateKey
myPriv = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "myPriv" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

me :: Address
me = fromPrivateKey myPriv

other :: Address
other = Address 0xabc

instance Monad m => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  putBlockstanbulContext = put
  getBlockstanbulContext = get

instance {-# OVERLAPPING #-} Monad m => HasVault (StateT BlockstanbulContext m) where
  sign bs = return $ signMsg myPriv bs
  getPub = error "getPub is not used by these tests"
  postKey = error "postKey is not used by these tests"
  getShared _ = error "getShared is not used by these tests"

-- | A context at sequence 10 (so the next height is 11), round 0, with two
-- validators and no signature checks.
mkContext :: Maybe Integer -> BlockstanbulContext
mkContext activation =
  (newContext "test" 1 ckpt (Just me) True activation) {_productionAuth = False}
  where
    ckpt = Checkpoint (View 0 10) [Validator me, Validator other] (Just zeroHash) [] 0

runWith :: BlockstanbulContext -> StateT BlockstanbulContext (LoggingT IO) a -> IO a
runWith ctx = runNoLoggingT . flip evalStateT ctx

activeCtx, legacyCtx :: BlockstanbulContext
activeCtx = mkContext Nothing
legacyCtx = mkContext (Just 1000000)

dummySig :: Signature
dummySig = signMsg myPriv (keccak256ToByteString $ hash "dummy")

-- | A version-3 header for height 11: validators, stakes, round, removed
-- validators and stake updates.
v3 :: [Validator] -> [(Validator, Integer)] -> Integer -> [Validator] -> [(Validator, Integer)] -> BlockHeader
v3 vals stakes' rnd removed updates =
  BlockHeaderV3
    { parentHash = zeroHash,
      stateRoot = "",
      transactionsRoot = "",
      receiptsRoot = "",
      logsBloom = "",
      number = 11,
      timestamp = posixSecondsToUTCTime 0,
      extraData = "",
      currentValidators = vals,
      newValidators = [],
      removedValidators = removed,
      proposalRound = rnd,
      currentStakes = stakes',
      stakeUpdates = updates,
      proposalSignature = Nothing,
      signatures = []
    }

spec :: Spec
spec = describe "stake-weighted consensus" $ do
  describe "rounds and timers" $ do
    it "keeps the round across heights and re-arms the timer per height" $
      forM_ [activeCtx, legacyCtx] $ \ctx0 -> do
        (out, ctx) <- runWith ctx0 $ do
          _ <- sendMessages [ForcedConfigChange (ForcedRound 3)]
          out <- sendMessages [ForcedConfigChange (ForcedSequence 11)]
          (,) out <$> get
        _round (_view ctx) `shouldBe` 3
        out `shouldSatisfy` elem (ResetTimer (View 3 11))

    it "changes round on a timeout for the current view" $ do
      out <- runWith activeCtx $ sendMessages [Timeout (View 0 10)]
      [rn | OMsg _ (RoundChange (View rn _) _) <- out] `shouldBe` [1]

    it "ignores timeouts for other heights" $ do
      out <- runWith activeCtx $ sendMessages [Timeout (View 0 9), Timeout (View 5 11)]
      [() | OMsg _ RoundChange {} <- out] `shouldBe` []

    it "only counts round changes for the current height" $ do
      ctx <- runWith activeCtx $ do
        _ <- sendMessages [IMsg (MsgAuth other dummySig) (RoundChange (View 2 11) 0)]
        get
      _roundChanged ctx `shouldBe` M.empty
      ctx' <- runWith activeCtx $ do
        _ <- sendMessages [IMsg (MsgAuth other dummySig) (RoundChange (View 2 10) 0)]
        get
      M.keys (_roundChanged ctx') `shouldBe` [2]

  describe "stake bookkeeping" $ do
    it "applies stake updates and drops removed validators on commit" $ do
      let hdr = v3 [] [] 0 [Validator other] [(Validator me, 5), (Validator other, 9)]
      ctx <- runWith activeCtx {_stakes = M.fromList [(Validator other, 1)]} $ do
        applyValidatorChanges hdr
        get
      _stakes ctx `shouldBe` M.fromList [(Validator me, 5)]
      _validators ctx `shouldBe` S.fromList [Validator me]

    it "remembers the committed block's round as the start of the next height" $ do
      ctx <- runWith activeCtx $ do
        runConduit $ yieldMany ([] :: [InEvent]) .| commitBlock (Block (v3 [Validator me, Validator other] [] 7 [] []) [] []) .| sinkNull
        get
      _lastRound ctx `shouldBe` 7
      _sequence (_view ctx) `shouldBe` 11

    it "selects the leader by stake once active and round-robin before" $ do
      let weights = M.fromList [(Validator me, 1000), (Validator other, 0)]
      computeLeader activeCtx {_stakes = weights} `shouldBe` Validator me
      computeLeader (activeCtx {_stakes = weights} & view . round .~ 1) `shouldBe` Validator other
      computeLeader legacyCtx `shouldBe` (0 `S.elemAt` _validators legacyCtx)
      computeLeader (legacyCtx & view . round .~ 1) `shouldBe` (1 `S.elemAt` _validators legacyCtx)

  describe "stake-weighted quorum" $ do
    let pair = S.fromList [Validator me, Validator other]
    it "weighs votes by stake once active, one each before, and one each while nobody has stake" $ do
      voteWeights True pair (M.fromList [(Validator me, 10)]) `shouldBe` M.fromList [(Validator me, 10), (Validator other, 0)]
      voteWeights False pair (M.fromList [(Validator me, 10)]) `shouldBe` M.fromList [(Validator me, 1), (Validator other, 1)]
      voteWeights True pair M.empty `shouldBe` M.fromList [(Validator me, 1), (Validator other, 1)]

    it "needs more than two thirds of the weight" $ do
      let w = M.fromList [(Validator me, 70), (Validator other, 30)]
      hasSupermajority w (S.singleton (Validator me)) `shouldBe` True
      hasSupermajority w (S.singleton (Validator other)) `shouldBe` False
      hasMinority w (S.singleton (Validator other)) `shouldBe` False
      hasMinority (M.fromList [(Validator me, 60), (Validator other, 40)]) (S.singleton (Validator other)) `shouldBe` True

    it "commits on stake, not on headcount, once active" $ do
      let blk = Block (v3 [Validator me, Validator other] [(Validator me, 1000)] 0 [] []) [] []
          di = blockHash blk
          prepare who = IMsg (MsgAuth who dummySig) (Prepare (View 0 10) di)
          commitsOut out = length [() | OMsg _ Commit {} <- out]
      out <- runWith activeCtx {_stakes = M.fromList [(Validator me, 1000)]} $ do
        proposal .= Just blk
        o1 <- sendMessages [prepare other]
        o2 <- sendMessages [prepare me]
        pure (commitsOut o1, commitsOut o2)
      out `shouldBe` (0, 1)
      legacy <- runWith legacyCtx $ do
        proposal .= Just blk
        o1 <- sendMessages [prepare other]
        o2 <- sendMessages [prepare me]
        pure (commitsOut o1, commitsOut o2)
      legacy `shouldBe` (0, 1)

  describe "proposal checks" $ do
    let solo = activeCtx {_validators = S.singleton (Validator me), _stakes = M.fromList [(Validator me, 7)]}
        vw = View 0 10
        seal hdr = let blk = Block hdr [] [] in addProposerSeal (signMsg myPriv (proposalMessage blk)) blk

    it "accepts a correctly stamped and sealed proposal" $
      checkProposalHeader solo vw (seal $ v3 [Validator me] [(Validator me, 7)] 0 [] []) `shouldBe` Right ()

    it "rejects proposals that are not version 3 once active" $ do
      let hdr = BlockHeaderV2 zeroHash "" "" "" "" 11 (posixSecondsToUTCTime 0) "" [Validator me] [] [] Nothing []
      checkProposalHeader solo vw (seal hdr) `shouldSatisfy` either (const True) (const False)

    it "rejects proposals whose round is ahead of the view, behind the parent, or whose sets differ" $ do
      let rejected = either (const True) (const False)
      checkProposalHeader solo vw (seal $ v3 [Validator me] [(Validator me, 7)] 1 [] []) `shouldSatisfy` rejected
      checkProposalHeader solo {_lastRound = 2} (View 2 10) (seal $ v3 [Validator me] [(Validator me, 7)] 1 [] []) `shouldSatisfy` rejected
      checkProposalHeader solo {_lastRound = 2} (View 2 10) (seal $ v3 [Validator me] [(Validator me, 7)] 2 [] []) `shouldBe` Right ()
      checkProposalHeader solo vw (seal $ v3 [Validator me] [] 0 [] []) `shouldSatisfy` rejected
      checkProposalHeader solo vw (seal $ v3 [] [(Validator me, 7)] 0 [] []) `shouldSatisfy` rejected

    it "rejects proposals sealed by someone other than the selected proposer" $ do
      let hdr = v3 [Validator me, Validator other] [(Validator other, 7)] 0 [] []
          ctx = activeCtx {_stakes = M.fromList [(Validator other, 7)]}
      selectProposer 1 11 (_validators ctx) (_stakes ctx) 0 0 `shouldBe` Validator other
      checkProposalHeader ctx vw (seal hdr) `shouldSatisfy` either (const True) (const False)

    it "does not apply the extra checks before activation" $
      checkProposalHeader legacyCtx vw (Block (v3 [] [] 5 [] []) [] []) `shouldBe` Right ()
