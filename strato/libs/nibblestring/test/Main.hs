{-# LANGUAGE OverloadedStrings #-}

module Main where

import Data.Functor
import Data.List
import Data.Monoid
import qualified Data.NibbleString as N
import System.Exit
import Test.Framework
import Test.Framework.Providers.HUnit
import Test.HUnit

testLength :: Assertion
testLength = do
  let evenNibbleString = "abcd12"
  assertEqual "length evenNibbleString isn't equal to 6" (N.length evenNibbleString) 6
  let oddNibbleString = "123"
  assertEqual "length oddNibbleString isn't equal to 3" (N.length oddNibbleString) 3
  assertEqual "length of N.empty /= 0" (N.length N.empty) 0

testPack :: Assertion
testPack = do
  assertEqual "[1,2,3,4] doesn't pack correctly" (N.pack [1, 2, 3, 4]) "1234"
  assertEqual "[1,2,3] doesn't pack correctly" (N.pack [1, 2, 3]) "123"

testAppend :: Assertion
testAppend = do
  assertEqual "'123' '456' doesn't append correctly" (N.append "123" "456") "123456"
  assertEqual "'ab' 'cd' doesn't append correctly" (N.append "ab" "cd") "abcd"
  assertEqual "'' '' doesn't append correctly" (N.append "" "") ""

main :: IO ()
main =
  defaultMainWithOpts
    [ testCase "test NibbleString length" testLength,
      testCase "test NibbleString pack" testPack,
      testCase "test NibbleString pack" testAppend
    ]
    mempty
