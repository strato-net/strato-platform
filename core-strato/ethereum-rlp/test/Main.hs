{-# LANGUAGE OverloadedStrings #-}

module Main where

import Data.Functor
import Data.List
import Data.Monoid
import System.Exit
import Test.Framework
import Test.Framework.Providers.HUnit
import Test.HUnit

import Blockchain.Data.RLP

testNumber::Assertion
testNumber = do
  let n = 20::Integer
  assertEqual "rlp encoding failed for small number" (rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode n) n

main::IO ()
main = 
  defaultMainWithOpts 
  [
   testCase "test RLP number encoding" testNumber
  ] mempty
