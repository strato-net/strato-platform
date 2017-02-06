module ArrayDeclarations where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import Data.Either

arrayStructType = "contract Contract { \n\
                  \  struct s { int x; } \n\
                  \  s[] sarray; \n\
                  \}"

fixedArrayArraySimpleType = "contract Contract { \n\
                            \ int[12][] iarray12array; \n\
                            \}"

arrayArraySimpleType = "contract Contract { \n\
                       \ int[][] iarrayarray; \n\
                       \}"

arrayArrayStructType = "contract Contract { \n\
                       \  struct s { int x; } \n\
                       \  s[][] sarrayarray; \n\
                       \}"

arraySimpleType = "contract Contract { \n\
                  \  int[] iarray; \n\
                  \}"

arrayEnumType = "contract Contract { \n\
                \  enum e { One, Two, Three } e[] earray; \n\
                \}"

fixedArraySimpleType = "contract Contract { \n\
                       \  int[12] iarray12; \n\
                       \}"

arrayFixedArraySimpleType = "contract Contract { \n\
                            \  int[][12] iarrayarray12; \n\
                            \}"

test_array_decl = testGroup "array parsing" $ 
  [ 
    testCase "parse array struct" $ do
      let parsed = parse (\src -> "TheImportName") "arrayStructType.sol" arrayStructType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse fixed array array simple" $ do
      let parsed = parse (\src -> "TheImportName") "fixedArrayArraySimpleType.sol" fixedArrayArraySimpleType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse array array simple" $ do
      let parsed = parse (\src -> "TheImportName") "arrayArraySimpleType.sol" arrayArraySimpleType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse array simple" $ do
      let parsed = parse (\src -> "TheImportName") "arraySimpleType.sol" arraySimpleType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse array enum" $ do
      let parsed = parse (\src -> "TheImportName") "arrayEnumType.sol" arrayEnumType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse fixed array simple" $ do
      let parsed = parse (\src -> "TheImportName") "fixedArraySimpleType.sol" fixedArraySimpleType

      assertBool "parse succeeded" (isRight parsed),

    testCase "parse array fixed array simple" $ do
      let parsed = parse (\src -> "TheImportName") "arrayFixedArraySimpleType.sol" arrayFixedArraySimpleType

      assertBool "parse succeeded" (isRight parsed)
  ]
