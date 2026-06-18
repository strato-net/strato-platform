{-# LANGUAGE OverloadedStrings #-}

-- | Regression test for audit finding 19: 'Blockchain.SolidVM.SetGet.fromBasic'
-- now uses 'readMaybe' (with a fallback to 0) for 'BDecimal' values
-- instead of partial 'read', which crashed the VM on storage corruption.
module SetGetAuditFixSpec (spec) where

import Blockchain.SolidVM.SetGet (fromBasic)
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value
import Test.Hspec

spec :: Spec
spec = do
  describe "Audit finding 19: BDecimal fromBasic is total" $ do
    it "well-formed BDecimal bytes parse to the expected SDecimal" $ do
      case fromBasic (MS.BDecimal "1.25") of
        SDecimal d -> show d `shouldBe` "1.25"
        other      -> expectationFailure $ "expected SDecimal; got " ++ show other

    it "integer-shaped BDecimal bytes parse to an SDecimal" $ do
      case fromBasic (MS.BDecimal "42") of
        SDecimal d -> show d `shouldBe` "42"
        other      -> expectationFailure $ "expected SDecimal; got " ++ show other

    it "malformed BDecimal bytes fall back to SDecimal 0 instead of crashing" $ do
      -- Pre-fix this raised an ErrorCall via partial 'read'. The fix
      -- swaps to 'readMaybe' with a fromMaybe-0 fallback so the VM
      -- survives storage corruption.
      let v = fromBasic (MS.BDecimal "not-a-number")
      case v of
        SDecimal 0 -> pure ()
        other      -> expectationFailure $ "expected SDecimal 0; got " ++ show other

    it "empty BDecimal bytes also fall back to 0" $ do
      case fromBasic (MS.BDecimal "") of
        SDecimal 0 -> pure ()
        other      -> expectationFailure $ "expected SDecimal 0; got " ++ show other

  describe "fromBasic non-Decimal sanity" $ do
    -- Smoke tests for the rest of fromBasic, partly to catch any
    -- accidental regression of the surrounding match clauses when
    -- the BDecimal path is touched in the future.
    it "BInteger 7 → SInteger 7" $
      fromBasic (MS.BInteger 7) `shouldBe` SInteger 7
    it "BBool True → SBool True" $
      fromBasic (MS.BBool True) `shouldBe` SBool True
    it "BString \"hi\" → SString \"hi\"" $
      fromBasic (MS.BString "hi") `shouldBe` SString "hi"
    it "BDefault → SNULL" $
      fromBasic MS.BDefault `shouldBe` SNULL
