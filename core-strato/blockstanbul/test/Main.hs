module Main where

import Test.Hspec

import Blockchain.Blockstanbul.Messages

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "A harness? what do you need that for?" $ do
    it "it secures a seat on the horse" $ do
      let v1 = RoundId 200 30
      roundidSequence v1 `shouldBe` 30

