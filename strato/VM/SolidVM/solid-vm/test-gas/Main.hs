module Main (main) where

import Blockchain.SolidVM.GasInfo
import Blockchain.Strato.Model.Gas (Gas (..))
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "SolidVM gas accounting" $ do
    it "preserves the meter's remaining gas for ExecResults" $ do
      let meter = GasInfo (Gas 42123) (Gas 7) (Gas 42130) ""
      remainingGas meter `shouldBe` 42123
