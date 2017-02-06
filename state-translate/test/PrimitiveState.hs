{-# LANGUAGE OverloadedStrings #-}

module PrimitiveState where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout
  
import qualified Data.Binary as BN
import Data.Aeson
import qualified Data.HashMap.Strict as H
import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import qualified Data.Vector as V
import qualified Data.Text as T

import Data.Maybe
import Data.Word
import Data.Either
import Data.LargeWord

import qualified Data.Map as Map
import Numeric

import SolidityStateTypes
import SolidityStateTranslate

import ProcessSimpleTypes
import ProcessComplexTypes


bytesContract :: String
bytesContract =  "contract BytesSizedContract { \n\
                  \  bytes3 bytes3Var; \n\
                  \}"

addressContract :: String
addressContract = "contract AddressContract { \n\
                  \  address addrVar; \n\
                  \  function set(address addr) { \n\
                  \    addrVar = addr; \n\
                  \  }\n\
                  \}"

addrKeyString :: String
addrKeyString = "0000000000000000000000000000000000000000000000000000000000000000"

addrValueString :: String 
addrValueString = "000000000000000000000000abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"

addrValueWord256 :: Word256
addrValueWord256 = fromIntegral . fst . head . readHex $ addrValueString

stateMap :: Map.Map StorageKey Vector8
stateMap = 
  Map.fromList 
      [
        (
          (fromIntegral . fst . head . readHex $ addrKeyString),
          V.fromList $ (BS.unpack . BN.encode) addrValueWord256
        )
      ]


addressContractUnlabeledState :: SolidityUnlabeledState
addressContractUnlabeledState = 
  SolidityUnlabeledState {
    unlabeledState = stateMap
  , unlabeledAddress = fromIntegral 120 
  }

boolDecl :: String
boolDecl = "contract Contract { \n\
           \  bool boolVar; \n\
           \}"

boolKeyString :: String
boolKeyString = "0000000000000000000000000000000000000000000000000000000000000000"

boolValueString :: String
boolValueString = "0000000000000000000000000000000000000000000000000000000000000001"

boolContractUnlabeledState :: SolidityUnlabeledState
boolContractUnlabeledState = 
  SolidityUnlabeledState {
    unlabeledState =
      Map.fromList 
      [
        (
          (fromIntegral . fst . head . readHex $ boolKeyString),
          V.fromList $ 
            map (\ch -> fromIntegral . fromEnum $ ch :: Word8) 
                boolValueString
        )
      ]
  , unlabeledAddress = (fromIntegral 120) 
  }


intSizeDecl = "contract Contract { \n\
              \  int64 int64Var; \n\ 
              \}"

uintSizeDecl = "contract Contract { \n\
               \  uint160 uint160Var; \n\
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


manyTypesDecl = "contract ManyTypes { \n\
                \  bool theBool; \n\
                \  int64 theInt64; \n\
                \  uint160 theUint160; \n\
                \  byte theByte; \n\
                \  address theAddress; \n\
                \  bytes3 theBytes3; \n\
                \  int theInt; \n\
                \  uint theUint; \n\
                \}"

manyTypesVars = [ 
                  "theBool", 
                  "theInt64",
                  "theUint160",
                  "theByte",
                  "theAddress",
                  "theBytes3",
                  "theInt",
                  "theUint"
                ]

negativeIntDecl = "contract NegativeInt { \n\
                   \  int theInt; \n\
                   \\n\
                   \  function NegativeInt() { \n\
                   \    theInt = -111111111111; \n\
                   \ } \n\
                   \}"
{-
contract NegativeInt is deployed on strato-dev4 at address 7d4cd637876180cb925862cc0f42d1438f52dae2

bloc reports its state as:

{
  theInt: "-19debd01c7"
}

The state on strato-dev4 is:

[
  {
    value: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffe62142fe39",
    key: "0000000000000000000000000000000000000000000000000000000000000000"
  }
]

-}


negativeIntII = "contract NegativeIntII { \n\
                 \  int theInt; \n\
                 \  int128 i1281; \n\
                 \  int128 i1282; \n\
                 \  int96 i96; \n\
                 \  int64 i641; \n\
                 \  int64 i642; \n\
                 \\n\
                 \  function NegativeIntII() { \n\
                 \    theInt = -111111111111; \n\
                 \    i1281 = -1000;          \n\
                 \    i1282 =  1000; \n\
                 \    i96 = -11111111111; \n\
                 \    i641 = -1000; \n\
                 \    i642 = 1000; \n\
                 \ } \n\
                 \}"

{-
contract NegativeInt is deployed on strato-dev4 at address 7d4cd637876180cb925862cc0f42d1438f52dae2

bloc reports its state as:

{
  i1281: "fffffffffffffffffffffffffffffc18",
  i96: "fffffffffffffffd69b9e639",
  i642: "3e8",
  i641: "fffffffffffffc18",
  theInt: "-19debd01c7",
  i1282: "3e8"
}

The state on strato-dev4 is:

[
  {
    value: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffe62142fe39",
    key: "0000000000000000000000000000000000000000000000000000000000000000"
  },
  {
    value: "000000000000000000000000000003e8fffffffffffffffffffffffffffffc18",
    key: "0000000000000000000000000000000000000000000000000000000000000001"
  },
  {
    value: "0000000000000000000003e8fffffffffffffc18fffffffffffffffd69b9e639",
    key: "0000000000000000000000000000000000000000000000000000000000000002"
  }
]

-}


manyValuesDecl = "contract ManyValues { \n\
                \   bool theBool; \n\
                \   int64 theInt64; \n\
                \   uint160 theUInt160; \n\
                \   byte theByte; \n\
                \   address theAddress; \n\
                \   bytes3 theBytes3; \n\
                \   int theInt; \n\
                \   uint theUInt; \n\
                \\n\
                \   function SetValues(bool b,          \n\         
                \                      int64 i64,       \n\
                \                      uint160 u160,    \n\
                \                      byte bt,         \n\
                \                      address a,       \n\
                \                      bytes3 bt3,      \n\
                \                      int i,           \n\
                \                      uint u) {        \n\
                \     theBool = b;   \n\
                \     theInt64 = i64; \n\
                \     theUInt160 = u160; \n\
                \     theByte = bt; \n\
                \     theAddress = a; \n\
                \     theBytes3 = bt3; \n\
                \     theInt = i; \n\
                \     theUInt = u; \n\
                \n  } \n\
                \}"


{-

function SetValues in contract ManyValues invoked with

  b = true,
  i64 = 2222222222222,
  u160 = 23452345,
  a = deadbeefdeadbeef,
  bt = ab,
  bt3 = abcdef,
  u = 222553535353,
  i = 1111111111

yields the following state on strato-dev4: (contract address a8852d6c107614a3bdf9f74839d610bbccced235)

[
  {
    value: "0000ab000000000000000000000000000000000165dab90000020566c4238e01",
    key:   "0000000000000000000000000000000000000000000000000000000000000000"
  },
  {
    value: "000000000000000000abcdef000000000000000000000000deadbeefdeadbeef",
    key:   "0000000000000000000000000000000000000000000000000000000000000001"
  },
  { 
    value: "00000000000000000000000000000000000000000000000000000000423a35c7",
    key:   "0000000000000000000000000000000000000000000000000000000000000002"
  },
  {
    value: "00000000000000000000000000000000000000000000000000000033d1397379",
    key:   "0000000000000000000000000000000000000000000000000000000000000003"
  }
]
The state reported by `bloc` is:

{
  SetValues: "function (Bool, Int, Int, Bytes, Address, Bytes, Int, Int) returns ()",
  theUInt: "222553535353",
  theInt64: "20566c4238e",
  theBytes3: "���",
  theBool: true,
  theAddress: "000000000000000000000000deadbeefdeadbeef",
  theInt: "423a35c7",
  theUInt160: "23452345",
  theByte: "�"
}.

This is our big test of correct variable recovery - without fixed size arrays

-}

manyValuesValue0 = "0000ab000000000000000000000000000000000165dab90000020566c4238e01"
manyValuesKey0 = "0000000000000000000000000000000000000000000000000000000000000000"

manyValuesValue1 = "000000000000000000abcdef000000000000000000000000deadbeefdeadbeef"
manyValuesKey1 = "0000000000000000000000000000000000000000000000000000000000000001"
  
manyValuesValue2 = "00000000000000000000000000000000000000000000000000000000423a35c7"
manyValuesKey2 =   "0000000000000000000000000000000000000000000000000000000000000002"

manyValuesValue3 = "00000000000000000000000000000000000000000000000000000033d1397379"
manyValuesKey3 = "0000000000000000000000000000000000000000000000000000000000000003"
 

manyValuesListWord256 :: [Word256]
manyValuesListWord256 = map (fromIntegral . fst . head . readHex) [ manyValuesValue0, 
                                                                    manyValuesValue1,
                                                                    manyValuesValue2,
                                                                    manyValuesValue3 ]

manyValuesVecList = map (V.fromList . BS.unpack . BN.encode) manyValuesListWord256         
manyValuesStateMap  = Map.fromList $ zip [0,1,2,3] manyValuesVecList

manyValuesUnlabeledState =
  SolidityUnlabeledState {
    unlabeledState = manyValuesStateMap
  , unlabeledAddress = (fromIntegral 120)
  }


test_primitive_state = testGroup "primitive state identification" $ 
  [ 
    testCase "lookupContracts succeeds on int" $ do
      let parsed = parse (\src -> "TheImportName") "intDecl.sol" intDecl
          eitherLayout = layout <$> parsed
          contractsLayout = lookupContracts <$> parsed <*> eitherLayout

      assertBool "contract layout found" (isRight contractsLayout)
 ,  
    testCase "extractVariables produces expected output on manyTypes" $ do
      let parsed = parse (\src -> "TheImportName") "manyTypesDecl.sol" manyTypesDecl
          eitherVariables = extractVariables <$> parsed
          objNames =  map (objName . primObjDef . primVar) <$> eitherVariables

      assertBool "extractVariables matches" (objNames == (Right manyTypesVars))
  ,
    testCase "address contract layout is as expected" $ do
      let parsed = parse (\src -> "TheImportName") "addressContract.sol" addressContract
          eitherLayout = layout <$> parsed
          contractsLayout = lookupContracts <$> parsed <*> eitherLayout
          
          layoutShouldBe = 
            Right [
              ContractLayout {
                objsLayout = 
                  Map.fromList [("addrVar",ObjLayout {objStartBytes = 0, objEndBytes = 19})], 
                typesLayout = 
                  Map.fromList [("AddressContract",ContractTLayout {typeUsedBytes = 20})]
              }
            ]

      assertBool "contract layout matches" (contractsLayout == layoutShouldBe) 

  ,
 
    testCase "inspect variables and identify address state" $ do
      let parsed = parse (const "TheImportName") "addressContract.sol" addressContract
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x

      assertBool "address contract parses" (isRight parsed)

      let contracts = lookupContracts solFile (layout solFile)

      assertBool "contracts found" (contracts /= [])

      let layoutAddr = lookupObjectLayout 
                         (head . filter (\obj -> objName obj == "addrVar") $ 
                           ( contractObjs . head) solFile)
                         (head contracts)

      assertBool "layout for variable addrVar found" (isJust layoutAddr)

      let eitherVariables = extractVariables <$> parsed      

      assertBool "extractingVariables didn't crash" (isRight eitherVariables)

      let state = translateState solFile addressContractUnlabeledState

      assertBool "address state matches" 
        (state == 
          SolidityLabeledState {
            labeledState = Map.fromList [
             (
               PrimitiveVariable {
                 primVar = PrimitiveStateVariable {
                   primObjDef = ObjDef {
                     objName = "addrVar", 
                     objValueType = SingleValue Address, 
                     objArgType = NoValue, 
                     objDefn = ""
                   }, 
                   primObjLayout = ObjLayout {
                     objStartBytes = 0, 
                     objEndBytes = 19
                   }, 
                   primVarContractName = "AddressContract", 
                   primVarContractAddress = Nothing
                 }
               }
             ,
               PrimitiveValue (
                 AddressBytes (
                   Bytes20 (V.fromList [171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205] :: V.Vector Word8)
                 )
               )
             )
            ], 
            labeledAddress = Nothing
          })

      -- BS.putStr (Aeson.encodePretty state)

      assertBool "JSON representation matches"  
        (toJSON state == 
          Object (
            H.fromList [
              ( T.pack "addrVar",
                Data.Aeson.String . T.pack $ "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd" )]))

  ,
    testCase "boolean value" $ do
      let parsed = parse (const "TheImportName") "boolDecl.sol" boolDecl
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x
         
          state = translateState solFile boolContractUnlabeledState

      assertBool "bool state matches" 
        (state == 
          SolidityLabeledState {
            labeledState = Map.fromList [
             (
               PrimitiveVariable {
                 primVar = PrimitiveStateVariable {
                   primObjDef = ObjDef {
                     objName = "boolVar", 
                     objValueType = SingleValue Boolean, 
                     objArgType = NoValue, 
                     objDefn = ""
                   }, 
                   primObjLayout = ObjLayout {
                     objStartBytes = 0, 
                     objEndBytes = 0
                   }, 
                   primVarContractName = "Contract", 
                   primVarContractAddress = Nothing
                 }
               }
             ,
               PrimitiveValue (
                 SolBool True                 
               )
             )
            ], 
            labeledAddress = Nothing
          })

  , testCase "large word tests" $ do
      let a = 217 :: Word256
          b = 11111111111111111111111 :: Word256
          c = -10000000 :: Word256
          d =  10000000 :: Word256

          word = LargeKey a b
          wordEncoded = BS.unpack . BN.encode $ word
          cEncoded = BS.unpack . BN.encode $ c
          dEncoded = BS.unpack . BN.encode $ d

          negString =  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffe62142fe39"                       
          negParsed = readHex negString :: [(Integer,String)]

          negValueWord256 = fromIntegral . fst . head $ negParsed :: Word256
          negValueInteger = fromIntegral . fst . head $ negParsed :: Integer

      print wordEncoded
      print $ length wordEncoded
    
      print cEncoded
      print $ length cEncoded    

      print dEncoded

      print (BN.decode . BS.pack $ dEncoded :: Word256)

      print negValueWord256
      print negValueInteger

      assertFailure "not what I expected in large word tests"
  ,
    testCase "many values" $ do
      let parsed = parse (const "TheImportName") "manyValueDecl.sol" manyValuesDecl
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x
          eitherVariables = extractVariables <$> parsed
          state = translateState solFile manyValuesUnlabeledState

{-
          addressObjLayout = ObjLayout {objStartBytes = 32, objEndBytes = 51} -- theAddress

          addressStartKey = startKey addressObjLayout
          addressEndKey = endKey addressObjLayout
          
          addressFlattened = flattenRelevantValues addressObjLayout manyValuesStateMap

          int64ObjLayout = ObjLayout { objStartBytes = 1, objEndBytes = 8 } -- i64

          int64StartKey = startKey int64ObjLayout
          int64EndKey = endKey int64ObjLayout

          int64Flattened = flattenRelevantValues int64ObjLayout manyValuesStateMap
-}

{-
      assertBool "extractingVariables didn't crash" (isRight eitherVariables)    

      assertBool "addressStartKey is 1" (addressStartKey == 1)
      assertBool "addressEndKey is 1" (addressEndKey == 1)
     
      print manyValuesStateMap

      assertBool "value at key 1 is correct" (Map.lookup addressStartKey manyValuesStateMap == (Just . V.fromList $ [0,0,0,0,0,0,0,0,0,171,205,239,0,0,0,0,0,0,0,0,0,0,0,0,222,173,190,239,222,173,190,239] ) )

      -- assertBool "addressFlattened is correct" (addressFlattened == (SingleKey . V.fromList $ [0,0,0,0,0,0,0,0,0,0,0,0,222,173,190,239,222,173,190,239]))

      assertBool "int64StartKey is 0" (int64StartKey == 0)
      assertBool "int64EndKey is 0" (int64EndKey == 0)

      assertBool "int64Flattened is" ((SingleKey . V.fromList $ [0,0,2,5,102,196,35,142]) == int64Flattened)
      assertBool "int64Length is 8" (V.length (unKey int64Flattened) == 8)
      assertBool "vector2Word64 works correctly" ((vector2Word64 . unKey $ int64Flattened) == 2222222222222)
      
      print state

-}

     {- todo - remove hideous Show instances and replace String wrapper by Integer wrapper -}
      assertBool "many values state matches in json form" $ 
        toJSON state == 
          Object (
            H.fromList [
              ("theUInt",Data.Aeson.String "UInt256 222553535353"),
              ("theInt64",Data.Aeson.String "Int64 2222222222222"),
              ("theBytes3",Data.Aeson.String "abcdef"),
              ("theBool",Data.Aeson.Bool True),
              ("theAddress",Data.Aeson.String "000000000000000000000000deadbeefdeadbeef"),
              ("theInt",Data.Aeson.String "Int256 1111111111"),
              ("theUInt160",Data.Aeson.String "UInt160 23452345"),
              ("theByte",Data.Aeson.String "ab")
            ]
          )

  ]
