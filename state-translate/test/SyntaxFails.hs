module SyntaxFails where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS
import Data.Either

invalid = "nocontract Contract { \n\
           \}"

prefix = "contracted Contract \n\
          \}"

unnamed = "contract { \n\
           \}"

unbraced = "contract Contract"

test_syntax_fails = testGroup "these shouldn't parse" $ 
  [ 
    testCase "parse fails, contract suffixed" $ do
      let parsed = parse (\src -> "TheImportName") "invalidContract.sol" invalid

      assertBool "parse failed (correctly)" (isLeft parsed)
    ,
 
   testCase "parse fails, contract prefixed" $ do
      let parsed = parse (\src -> "TheImportName") "prefixContract.sol" prefix

      assertBool "parse failed (correctly)" (isLeft parsed)
    ,
 
   testCase "parse fails, no name" $ do
      let parsed = parse (\src -> "TheImportName") "unnamedContract.sol" unnamed

      assertBool "parse failed (correctly)" (isLeft parsed)
    ,
 
   testCase "parse fails, no braces" $ do
      let parsed = parse (\src -> "TheImportName") "unbracedContract.sol" unbraced

      assertBool "parse failed (correctly)" (isLeft parsed)
  ]
