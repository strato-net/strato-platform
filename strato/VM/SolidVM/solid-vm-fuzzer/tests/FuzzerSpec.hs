{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module FuzzerSpec where

import Data.Source
import qualified Data.Text as T
import SolidVM.Solidity.Fuzzer
import SolidVM.Solidity.SourceTools
import Test.Hspec
import Text.RawString.QQ

runTheFuzzer :: String -> IO [FuzzerResult]
runTheFuzzer c = fuzzer (defaultSourceTools Nothing) (SourceMap [("A.sol", T.pack c)])

isSuccess :: FuzzerResult -> Bool
isSuccess (FuzzerSuccess _) = True
isSuccess _ = False

spec :: Spec
spec = describe "Fuzzer tests" $ do
  it "can ignore contracts that don't begin with Describe_" $ do
    results <-
      runTheFuzzer
        [r|
contract A {
  function it_wontRun() external returns (bool) {
  }
}
|]
    length results `shouldBe` 0
  it "can run a successful unit test" $ do
    results <-
      runTheFuzzer
        [r|
contract Describe_A {
  function it_willRun() external returns (bool) {
    return true;
  }
}
|]
    length results `shouldBe` 1
    results `shouldSatisfy` all isSuccess
  it "can run a successful property test" $ do
    results <-
      runTheFuzzer
        [r|
contract Describe_A {
  function property_identity(uint x) external returns (bool) {
    return x == x;
  }
}
|]
    length results `shouldBe` 1
    results `shouldSatisfy` all isSuccess
  it "can run a faulty unit test" $ do
    results <-
      runTheFuzzer
        [r|
contract Describe_A {
  function it_willRun() external returns (bool) {
    return false;
  }
}
|]
    length results `shouldBe` 1
    results `shouldSatisfy` all (not . isSuccess)
  it "can run a faulty property test" $ do
    results <-
      runTheFuzzer
        [r|
contract Describe_A {
  function property_not_identity(uint x) external returns (bool) {
    return x == x + 1;
  }
}
|]
    length results `shouldBe` 1
    results `shouldSatisfy` all (not . isSuccess)
  it "can run a faulty property test that won't fail deterministically" $ do
    results <-
      runTheFuzzer
        [r|
contract Describe_A {
  function property_less_than(uint x, uint y) external returns (bool) {
    return x < y;
  }
}
|]
    length results `shouldBe` 1
    results `shouldSatisfy` all (not . isSuccess)
