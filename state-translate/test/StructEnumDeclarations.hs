module StructEnumDeclarations where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import Data.Either

structByteDecl = "contract Contract { \n\
                 \  struct Struct { byte by; } \n\
                 \  Struct byteStructVar; \n\
                 \}"

structBytesDecl = "contract Contract { \n\
                  \  struct Struct { bytes bys; } \n\
                  \  Struct bytesStructVar; \n\
                  \}"

structBoolFieldDecl = "contract Contract { \n\
                      \  struct Struct { bool b; } \n\
                      \  Struct boolStructVar; \n\
                      \}"

structAddressFieldDecl = "contract Contract { \n\
                         \  struct Struct { address a; } \n\
                         \  Struct addressStructVar; \n\
                         \}"

structUintSizeDecl = "contract Contract { \n\
                     \  struct Struct { uint160 u160; } \n\
                     \  Struct uint160StructVar; \n\
                     \}"

structBytesSizeDecl = "contract Contract { \n\
                      \  struct Struct { bytes3 by3; } \n\
                      \  Struct bytes3StructVar; \n\
                      \}"

structIntDecl = "contract Contract { \n\
                \  struct Struct { int i; } \n\
                \  Struct intStructVar; \n\
                \}"

structIntSizeDecl = "contract Contract { \n\
                    \  struct Struct { int64 i64; } \n\
                    \  Struct int64StructVar; \n\
                    \}"

structUintDecl = "contract Contract { \n\
                 \  struct Struct { uint u; } \n\
                 \  Struct uintStructVar; \n\
                 \}"

enumDecl = "contract Contract { \n\
           \  enum Enum { First, Second, Third } \n\
           \  Enum enumVar; \n\
           \}"


test_struct_decl = testGroup "struct and enum declaration parsing" $ 
  [ 
    testCase "parse struct byte" $ do
      let parsed = parse (\src -> "TheImportName") "structByteDecl.sol" structByteDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct bytes" $ do
      let parsed = parse (\src -> "TheImportName") "structBytesDecl.sol" structBytesDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct bool field" $ do
      let parsed = parse (\src -> "TheImportName") "structBoolFieldDecl.sol" structBoolFieldDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct Uint size" $ do
      let parsed = parse (\src -> "TheImportName") "structUintSizeDecl.sol" structUintSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct address field" $ do
      let parsed = parse (\src -> "TheImportName") "structAddressFieldDecl.sol" structAddressFieldDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct bytes size" $ do
      let parsed = parse (\src -> "TheImportName") "structBytesSizeDecl.sol" structBytesSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct int" $ do
      let parsed = parse (\src -> "TheImportName") "structIntDecl.sol" structIntDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct int size" $ do
      let parsed = parse (\src -> "TheImportName") "structIntSizeDecl.sol" structIntSizeDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse struct uint" $ do
      let parsed = parse (\src -> "TheImportName") "structUintDecl.sol" structUintDecl

      assertBool "parsed successfully" (isRight parsed),

    testCase "parse enum" $ do
      let parsed = parse (\src -> "TheImportName") "enumDecl.sol" enumDecl

      assertBool "parsed successfully" (isRight parsed)
  ]
