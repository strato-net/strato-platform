{-# LANGUAGE OverloadedStrings #-}

-- | Regression tests for the post-audit pure 'Blockchain.SolidVM.Builtins'
-- functions. Each one is fork-gated at runtime (see
-- 'Blockchain.SolidVM.SolidVM' for the dispatch); this spec exercises
-- the strict variants directly so the cryptographic behaviour itself
-- is pinned down regardless of fork plumbing.
--
-- Covers audit findings 1, 3, 11, 32, 49, 50.
module BuiltinsAuditFixSpec (spec) where

import Blockchain.SolidVM.Builtins
  ( ecAddPostAudit,
    ecMulPostAudit,
    ecPairingPostAudit,
    modExp,
    modExpPostAudit,
    poseidonHash,
    poseidonHashPostAudit,
  )
import Control.Exception (ArithException, evaluate, try)
import Test.Hspec

----------------------------------------------------------------------
-- BN254 (alt_bn128) constants. Repeated locally so the test pins
-- them down independently of the library — if Builtins ever drifts
-- to the wrong curve, these tests notice.

bn254FieldPrime :: Integer
bn254FieldPrime =
  21888242871839275222246405745257275088696311157297823662689037894645226208583

bn254ScalarOrder :: Integer
bn254ScalarOrder =
  21888242871839275222246405745257275088548364400416034343698204186575808495617

----------------------------------------------------------------------
-- BN254 generator point.

g1 :: (Integer, Integer)
g1 = (1, 2)

-- An obviously-off-G1 point: (1, 1) does not satisfy y² ≡ x³ + 3.
offCurveG1 :: (Integer, Integer)
offCurveG1 = (1, 1)

-- A coordinate equal to the field prime — out-of-field by the
-- audit-fix definition (must lie in [0, p)).
outOfFieldG1 :: (Integer, Integer)
outOfFieldG1 = (bn254FieldPrime, 2)

----------------------------------------------------------------------
-- spec

spec :: Spec
spec = do
  ----------------------------------------------------------------
  describe "Audit finding 3 / 32: modExpPostAudit" $ do
    it "matches modExp on simple inputs (3^4 mod 7 = 4)" $ do
      modExpPostAudit 3 4 7 `shouldBe` 4
      modExp           3 4 7 `shouldBe` 4

    it "returns 0 when the modulus is 0 (no DivideByZero)" $ do
      modExpPostAudit 5 3 0 `shouldBe` 0

    it "pre-audit modExp m=0 still throws ArithException" $ do
      r <- try (evaluate (modExp 5 3 0))
      case (r :: Either ArithException Integer) of
        Left _  -> pure ()
        Right v -> expectationFailure $ "expected ArithException; got " ++ show v

    it "0^0 mod m == 1 (matches the EVM MODEXP precompile)" $ do
      modExpPostAudit 0 0 7 `shouldBe` 1
      modExpPostAudit 0 0 1 `shouldBe` 0   -- 1 `mod` 1 = 0

    it "fixes the operator-precedence bug in the odd-exponent branch" $ do
      -- Pre-fix the recursion read as @b * (modExp b (e-1) m `mod` m)@,
      -- which leaves intermediates unreduced before the next multiply.
      -- The post-audit version parenthesises so each step is bounded.
      modExpPostAudit 7 7 13 `shouldBe` (7 ^ (7 :: Int) `mod` 13)
      modExpPostAudit 12345 67 1009
        `shouldBe` (12345 ^ (67 :: Int) `mod` 1009)

  ----------------------------------------------------------------
  describe "Audit finding 11: ecAddPostAudit / ecMulPostAudit reject off-curve" $ do
    it "ecAddPostAudit accepts on-curve generator + identity" $ do
      ecAddPostAudit g1 (0, 0) `shouldBe` Just g1

    it "ecAddPostAudit rejects off-curve LHS" $ do
      ecAddPostAudit offCurveG1 g1 `shouldBe` Nothing

    it "ecAddPostAudit rejects off-curve RHS" $ do
      ecAddPostAudit g1 offCurveG1 `shouldBe` Nothing

    it "ecAddPostAudit rejects out-of-field coordinate" $ do
      ecAddPostAudit outOfFieldG1 g1 `shouldBe` Nothing

    it "ecMulPostAudit accepts on-curve generator * 0 == identity" $ do
      ecMulPostAudit g1 0 `shouldBe` Just (0, 0)

    it "ecMulPostAudit rejects off-curve point" $ do
      ecMulPostAudit offCurveG1 1 `shouldBe` Nothing

    it "ecMulPostAudit rejects out-of-field coordinate" $ do
      ecMulPostAudit outOfFieldG1 1 `shouldBe` Nothing

  ----------------------------------------------------------------
  describe "Audit findings 1 / 50: ecPairingPostAudit reverts on bad input" $ do
    it "rejects empty input (finding 1: pre-audit returned True)" $ do
      ecPairingPostAudit [] `shouldBe` Nothing

    it "rejects input whose length isn't a multiple of 6" $ do
      ecPairingPostAudit [1, 2, 3, 4, 5] `shouldBe` Nothing

    it "rejects input with off-curve G1 point (finding 11)" $ do
      -- (1, 1) is the G1 part; G2 is the identity (all zeros) —
      -- but the off-curve G1 should already trip the validation.
      ecPairingPostAudit [1, 1, 0, 0, 0, 0] `shouldBe` Nothing

  ----------------------------------------------------------------
  describe "Audit finding 49: poseidonHashPostAudit rejects out-of-field" $ do
    it "accepts inputs strictly inside the BN254 scalar field" $ do
      let xs = [0, 1, 2, bn254ScalarOrder - 1]
      case poseidonHashPostAudit xs of
        Just _  -> pure ()
        Nothing -> expectationFailure "in-field input rejected"

    it "rejects an input equal to the scalar order" $ do
      poseidonHashPostAudit [bn254ScalarOrder] `shouldBe` Nothing

    it "rejects an input larger than the scalar order" $ do
      poseidonHashPostAudit [bn254ScalarOrder + 7] `shouldBe` Nothing

    it "rejects a negative input" $ do
      poseidonHashPostAudit [-1] `shouldBe` Nothing

    it "in-field hash matches the legacy poseidonHash on the same input" $ do
      let xs = [42, 7, bn254ScalarOrder - 1]
      poseidonHashPostAudit xs `shouldBe` Just (poseidonHash xs)
