module MappingDeclarations where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS
import Data.Either

mappingArraySimple = "contract Contract { \n\
                      \  mapping (address[] => int) aar_i_map; \n\
                      \}"

mappingArrayArraySimple = "contract Contract { \n\
                           \  mapping (address[][12] => int) aarar_i_map; \n\
                           \}"

mappingMappingArray = "contract Contract { \n\
                       \  mapping (mapping (int => bool) => int[]) m_iar_map; \n\
                       \}" 

mappingStructSimple = "contract Contract { \n\
                      \  struct s { bool b; } \n\
                      \  mapping (s => int) si_map; \n\
                      \}"

mappingSimpleSimple = "contract Contract { \n\
                      \  mapping (int => bool) ib_map; \n\
                      \}" 

mappingEnumSimple = "contract Contract { \n\
                    \  enum e {One, Two, Three} \n\
                    \  mapping (e => int) ei_map; \n\
                    \}"

mappingSimpleStruct = "contract Contract { \n\
                      \  struct s { bool b; } \n\
                      \  mapping (int => s) is_map; \n\
                      \}"

test_mapping_decl = testGroup "test mapping parsing" $
  [ 
    testCase "array simple parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingArraySimple.sol" mappingArraySimple

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "array array simple parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingArrayArraySimple.sol" mappingArrayArraySimple

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "mapping array parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingMappingArray.sol" mappingMappingArray

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "struct simple parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingStructSimple.sol" mappingStructSimple

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "simple simple parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingSimpleSimple.sol" mappingSimpleSimple

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "enum simple parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingEnumimple.sol" mappingEnumSimple

      assertBool "successful parse" (isRight parsed)
    ,

    testCase "simple struct parses" $ do
      let parsed = parse (\src -> "TheImportName") "mappingSimpleStruct.sol" mappingSimpleStruct

      assertBool "successful parse" (isRight parsed)
  --, 

  ]
