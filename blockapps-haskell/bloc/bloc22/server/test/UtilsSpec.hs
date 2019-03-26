module UtilsSpec where

import Test.Hspec

import BlockApps.Bloc22.Server.Utils

spec :: Spec
spec = describe "Utils" $ do
  it "should be stable on values" $ do
    let input = [(1, 2), (1, 4)] :: [(Int, Int)]
        output = [(1, [(1, 2), (1, 4)])] :: [(Int, [(Int, Int)])]
    partitionWith fst input `shouldBe` output

