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

runTheFuzzer :: String -> IO [FuzzerTestAndResult]
runTheFuzzer c = fuzzer (defaultSourceTools Nothing) (SourceMap [("A.sol", T.pack c)])

isSuccess :: FuzzerResultF a -> Bool
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
  it "reads public byte-key mappings through the same keys as internal access" $ do
    results <- runTheFuzzer [r|
contract GetterKeys {
  mapping(bytes32 => uint) public counts;
  mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) public votes;
  mapping(bytes => uint) public dynamicKeys;
  mapping(uint => mapping(address => mapping(bool => mapping(string => uint)))) public otherKeys;

  constructor() {
    counts[bytes32(0xc009e7c12890c67a2e36deb34ca9540060e3e542f456c818a91761be623b7fce)] = 3;
    counts[bytes32(1)] = 7;
    counts[bytes32(0)] = 9;
    votes[bytes32(1)][address(0x1234)][bytes32(2)] = true;
    dynamicKeys[bytes(hex"005d5cff00")] = 11;
    otherKeys[42][address(0x1234)][true]["key"] = 13;
  }
}

contract Describe_GetterKeys {
  GetterKeys keys;
  function beforeAll() { keys = new GetterKeys(); }

  function it_reads_binary_digest() returns (bool) {
    return keys.counts(bytes32(0xc009e7c12890c67a2e36deb34ca9540060e3e542f456c818a91761be623b7fce)) == 3;
  }
  function it_reads_rpc_style_hex_argument() returns (bool) {
    uint count = address(keys).call("counts", 0xc009e7c12890c67a2e36deb34ca9540060e3e542f456c818a91761be623b7fce);
    return count == 3;
  }
  function it_preserves_leading_and_all_zero_bytes() returns (bool) {
    uint one = address(keys).call("counts", 0x0000000000000000000000000000000000000000000000000000000000000001);
    uint zero = address(keys).call("counts", 0);
    return one == 7 && keys.counts(bytes32(1)) == 7 && zero == 9;
  }
  function it_reads_nested_byte_keys() returns (bool) {
    bool voted = address(keys).call("votes", 1, address(0x1234), 2);
    return voted && keys.votes(bytes32(1), address(0x1234), bytes32(2));
  }
  function it_reads_dynamic_byte_keys() returns (bool) {
    return keys.dynamicKeys(bytes(hex"005d5cff00")) == 11;
  }
  function it_preserves_other_key_types() returns (bool) {
    return keys.otherKeys(42, address(0x1234), true, "key") == 13;
  }
  function it_returns_zero_for_an_unset_digest() returns (bool) {
    return keys.counts(bytes32(2)) == 0;
  }
}
|]
    length results `shouldBe` 7
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
