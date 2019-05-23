{-# LANGUAGE OverloadedStrings #-}

module Main where

import Test.Framework
import Test.Framework.Providers.HUnit
import Test.Hspec
import Test.HUnit

import qualified Data.ByteString as B

import Blockchain.Data.RLP

testNumber::Assertion
testNumber = do
  let n = 20::Integer
  assertEqual "rlp encoding failed for small number" (rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode n) n

testConsistent :: RLPObject -> Expectation
testConsistent obj =
  let oldEnc = rlpSerialize_safe obj
      newEnc = rlpSerialize obj
  in newEnc `shouldBe` oldEnc


main::IO ()
main =
  defaultMainWithOpts
  [ testCase "test RLP number encoding" testNumber
  , testCase "test numbers" . mapM_ (testConsistent . RLPScalar) $ [0..255]
  , testCase "test strings" . mapM_ (testConsistent . RLPString . flip B.replicate 0xfa) $
        [0, 10, 55, 56, 1024, 1024 * 1024]
  , testCase "test array of strings" . testConsistent $ RLPArray [RLPString "hello", RLPString "world", RLPString "!"]
  , testCase "test array of a long string" . testConsistent $ RLPArray [RLPString $ B.replicate 55 0xcc]
  ] mempty
