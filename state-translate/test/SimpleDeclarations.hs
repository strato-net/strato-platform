module SimpleDeclarations where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import Data.Either

bytesDecl = "contract Contract { \n\
            \  bytes bytesVar; \n\
            \}"

bytesSizeDecl =  "contract Contract { \n\
                 \  bytes3 bytes3Var; \n\
                 \}"

addressDecl = "contract Contract { \n\
              \  address addrVar; \n\
              \}"

boolDecl = "contract Contract { \n\
           \  bool boolVar; \n\
           \}"

intSizeDecl = "contract Contract { \n\
              \  int64 int64Var; \n\ 
              \}"

uintSizeDecl = "contract Contract { \n\
               \  uint160 uint160Var; \n\
               \}"

realDecls = "contract Contract { \n\
            \  real r; \n\
            \  ureal ur; \n\
            \  real32x160 rs; \n\
            \  ureal8x248 urs; \n\
            \}"

byteDecl = "contract Contract { \n\
           \  byte byteVar; \n\
           \}"

uintDecl = "contract Contract { \n\
           \  uint uintVar; \n\
           \}"

intDecl =  "contract Contract { \n\
           \  int intVar; \n\
           \}"


test_simple_decl = testGroup "simple declaration parsing" $ 
  [ 
    testCase "parse bytes" $ do
      let parsed = parse (\src -> "TheImportName") "bytesDecl.sol" bytesDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse byte size" $ do
      let parsed = parse (\src -> "TheImportName") "bytesSizeDecl.sol" bytesSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse address" $ do
      let parsed = parse (\src -> "TheImportName") "addressDecl.sol" addressDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse bool" $ do
      let parsed = parse (\src -> "TheImportName") "boolDecl.sol" boolDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse int size" $ do
      let parsed = parse (\src -> "TheImportName") "intSizeDecl.sol" intSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse uint size" $ do
      let parsed = parse (\src -> "TheImportName") "uintSizeDecl.sol" uintSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse real" $ do
      let parsed = parse (\src -> "TheImportName") "realDecls.sol" realDecls

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse byte" $ do
      let parsed = parse (\src -> "TheImportName") "byteDecl.sol" byteDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse uint" $ do
      let parsed = parse (\src -> "TheImportName") "uintDecl.sol" uintDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse int" $ do
      let parsed = parse (\src -> "TheImportName") "intDecl.sol" intDecl

      assertBool "parsed successfully" (isRight parsed)

  ]
