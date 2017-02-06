module FunctionDeclarations where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import Data.Either

functionOneArgNoRet = "contract Contract { \n\
                      \  function f (uint160 u160) {} \n\
                      \}"

functionThreeArgsSimpleRet = "contract Contract { \n\
                             \  function f (uint160 u160, byte b, address a) returns (int i) {} \n\
                             \}"

functionNoArgsNoRet = "contract Contract { \n\
                      \  function f () {} \n\
                      \}"

functionTwoArgNoRet = "contract Contract { \n\
                      \  function f (uint160 u160, byte b) {} \n\
                      \}"

functionThreeArgsNoRet = "contract Contract { \n\
                         \  function f (uint160 u160, byte b, address a) {} \n\
                         \}"

functionStructArgEnumRet = "contract Contract { \n\
                           \  struct istruct { int i; } \n\
                           \  enum onetwothree { One, Two, Three } \n\
                           \  function f (istruct x) returns (onetwothree e) {} \n\
                           \}"

test_func_decl = testGroup "function declaration parsing" $ 
  [ 
    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionOneArgNoRet.sol" functionOneArgNoRet

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionThreeArgsSimpleRet.sol" functionThreeArgsSimpleRet

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionNoArgsNoRet.sol" functionNoArgsNoRet

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionTwoArgNoRet.sol" functionTwoArgNoRet

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionThreeArgNoRet.sol" functionThreeArgsNoRet

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse" $ do
      let parsed = parse (\src -> "TheImportName") "functionStructArgEnumRet.sol" functionStructArgEnumRet

      assertBool "parsed successfully" (isRight parsed)

  ]
