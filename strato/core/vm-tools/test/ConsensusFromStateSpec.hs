{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | The header's validator-set and stake-weight changes derived from contract
-- state, and the block builder's rule for a reward run that ran nothing.
module ConsensusFromStateSpec (spec) where

import Blockchain.Bagger (discardsRewardRun)
import Blockchain.Bagger.Transactions (consensusDeltasFromHeld, consensusOutcome, shadowMismatch)
import Blockchain.Strato.Model.Validator
import qualified Data.Map as M
import qualified Data.Set as S
import Data.Maybe (isJust)
import SolidVM.Model.Delta (applyStakeDelta, fromDelta, toDelta)
import Test.Hspec
import Test.QuickCheck

a, b, c, d :: Validator
a = Validator 0xa
b = Validator 0xb
c = Validator 0xc
d = Validator 0xd

-- | What the consensus layer does with a header's changes (applyValidatorChanges).
applied :: S.Set Validator -> M.Map Validator Integer -> [(Validator, Integer)] -> (S.Set Validator, M.Map Validator Integer)
applied inForce stakes held =
  let (vd, sd) = consensusDeltasFromHeld inForce stakes held
      (added, removed) = fromDelta vd
   in ((inForce `S.union` S.fromList added) S.\\ S.fromList removed, applyStakeDelta removed sd stakes)

spec :: Spec
spec = do
  describe "consensus changes read from contract state" $ do
    let inForce = S.fromList [a, b, c]
        stakes = M.fromList [(a, 10), (b, 20), (c, 30)]

    it "carries nothing when state holds exactly what is in force" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes [(a, 10), (b, 20), (c, 30)]
      fromDelta vd `shouldBe` ([], [])
      sd `shouldBe` M.empty

    it "adds, removes and re-weighs to reach what state holds" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes [(d, 5), (a, 10), (c, 31)]
      fromDelta vd `shouldBe` ([d], [b])
      sd `shouldBe` M.fromList [(c, 31), (d, 5)]

    it "writes its lists in ascending order whatever order state lists them in" $ do
      let one = consensusDeltasFromHeld S.empty M.empty [(d, 1), (b, 1), (c, 1), (a, 1)]
          other = consensusDeltasFromHeld S.empty M.empty [(a, 1), (c, 1), (b, 1), (d, 1)]
      fromDelta (fst one) `shouldBe` ([a, b, c, d], [])
      fromDelta (fst one) `shouldBe` fromDelta (fst other)
      snd one `shouldBe` snd other

    it "treats a validator without a weight on record as weighing zero" $ do
      -- no entry in force and zero in state: nothing to say
      snd (consensusDeltasFromHeld (S.fromList [a]) M.empty [(a, 0)]) `shouldBe` M.empty
      -- a weight in force that state no longer holds is written down as zero
      snd (consensusDeltasFromHeld (S.fromList [a]) (M.fromList [(a, 7)]) [(a, 0)]) `shouldBe` M.fromList [(a, 0)]

    it "holds the first weights back until every validator has one" $ do
      let set = S.fromList [a, b, c]
      -- one vote each today; state has a weight for one validator only
      let (vd, sd) = consensusDeltasFromHeld set M.empty [(a, 0), (b, 0), (c, 0), (d, 1000)]
      fromDelta vd `shouldBe` ([d], [])
      sd `shouldBe` M.empty
      -- every validator has one: the weights arrive together
      snd (consensusDeltasFromHeld set M.empty [(a, 5), (b, 6), (c, 7)]) `shouldBe` M.fromList [(a, 5), (b, 6), (c, 7)]
      -- once weights are in force, a validator without one is written as state has it
      snd (consensusDeltasFromHeld set (M.fromList [(a, 5), (b, 6), (c, 7)]) [(a, 5), (b, 0), (c, 7)]) `shouldBe` M.fromList [(b, 0)]

    it "changes nothing when state gives it nothing to go by" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes []
      fromDelta vd `shouldBe` ([], [])
      sd `shouldBe` M.empty

    it "leaves the consensus layer holding exactly what state holds" $
      property $ \(inForceKeys :: [Word]) (weights :: [(Word, NonNegative Integer)]) (heldRaw :: [(Word, NonNegative Integer)]) -> do
        let v = Validator . fromIntegral
            inForce' = S.fromList (map v inForceKeys)
            stakes' = M.fromList [(v k, getNonNegative w) | (k, w) <- weights]
            held = M.toList $ M.fromList [(v k, getNonNegative w) | (k, w) <- heldRaw]
            (set', stakes'') = applied inForce' stakes' held
            firstWeightsPartial = all (<= 0) (M.elems stakes') && any ((<= 0) . snd) held && any ((> 0) . snd) held
        if null held
          then (set', stakes'') `shouldBe` (inForce', stakes')
          else do
            set' `shouldBe` S.fromList (map fst held)
            if firstWeightsPartial
              then all (<= 0) [M.findWithDefault 0 k stakes'' | (k, _) <- held] `shouldBe` True
              else [M.findWithDefault 0 k stakes'' | (k, _) <- held] `shouldBe` map snd held

  describe "the shadow comparison before the fork" $ do
    let inForce = S.fromList [a, b, c]
        stakes = M.fromList [(a, 10), (b, 20), (c, 30)]
        fromState held = consensusDeltasFromHeld inForce stakes held

    it "agrees when events and state leave the same set and weights, however the changes are written" $ do
      -- events re-publish an unchanged weight and add then remove a validator; state shows neither
      let fromEvents = (toDelta [d] [d], M.fromList [(a, 10), (c, 31)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 20), (c, 31)]) `shouldBe` Nothing
      consensusOutcome inForce stakes fromEvents `shouldBe` (inForce, M.fromList [(a, 10), (b, 20), (c, 31)])

    it "reports a validator that events add and state does not hold" $ do
      -- the rolled-back call: its ValidatorAdded and ValidatorStakeUpdated events, nothing in storage
      let fromEvents = (toDelta [d] [], M.fromList [(d, 1000)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 20), (c, 30)]) `shouldSatisfy` isJust

    it "reports a weight that state holds and no event carried" $ do
      let fromEvents = (toDelta [] [], M.empty)
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 25), (c, 30)]) `shouldSatisfy` isJust

    it "treats a weight of zero and no weight at all as the same" $ do
      let fromEvents = (toDelta [] [], M.fromList [(b, 0)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 0), (c, 30)]) `shouldBe` Nothing
      snd (consensusOutcome inForce stakes fromEvents) `shouldBe` M.fromList [(a, 10), (c, 30)]

  describe "a run that was to pay the block rewards" $ do
    it "is thrown away when it failed without running a transaction" $
      discardsRewardRun True True True `shouldBe` True

    it "is kept when it ran a transaction, succeeded, or was not the paying run" $ do
      discardsRewardRun True True False `shouldBe` False
      discardsRewardRun True False False `shouldBe` False
      discardsRewardRun False True True `shouldBe` False
