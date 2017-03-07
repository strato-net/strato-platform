module ComplexState where

import Test.Tasty
import Test.Tasty.HUnit

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout
  
import qualified Data.Binary as BN
import Data.Aeson
import qualified Data.Map.Strict as H
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

fixedArrays = "contract FixedArrays { \n\
               \  uint[7] theUInts; \n\
               \  int[23] theInts; \n\
               \  bool[3] theBools; \n\
               \  address[12] theAddresses; \n\
               \  bytes18[3] theBytes; \n\
               \\n\
               \  function FixedArrays() { \n\
               \    theAddresses[4] = 0xaaaaaaaaaaaaaaaaaaaaaaaa; \n\
               \    theAddresses[5] = 0xbbbbbbbbbbbbbbbbbbbbbbbb; \n\
               \    theAddresses[6] = 0xcccccccccccccccccccccccc; \n\
               \    theAddresses[7] = 0xdddddddddddddddddddddddd; \n\
               \\n\
               \    theUInts[4] = 123451234512345; \n\
               \    theInts[20]= -123451234512345; \n\
               \    theBools[2] = true; \n\
               \    theBytes[2] = 0xabcdabcd; \n\
               \  }\n\
               \}"

{-
  Fixed Length Arrays

strato-dev4 reports the state of the FixedArrays ( 6b0d5add21a2954c706b21b7b2bbd09e0d205dd9 ) 
  Contract as:
[
  {
    value: "000000000000000000000000000000000000000000000000000070473afaedd9",
    key:   "0000000000000000000000000000000000000000000000000000000000000004"
  },
  {
    value: "ffffffffffffffffffffffffffffffffffffffffffffffffffff8fb8c5051227",
    key:   "000000000000000000000000000000000000000000000000000000000000001b"
  },
  {
    value: "0000000000000000000000000000000000000000000000000000000000010000",
    key:   "000000000000000000000000000000000000000000000000000000000000001e"
  },
  {
    value: "0000000000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaa",
    key:   "0000000000000000000000000000000000000000000000000000000000000023"
  },
  {
    value: "0000000000000000000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbb",
    key:   "0000000000000000000000000000000000000000000000000000000000000024"
  },
  {
    value: "0000000000000000000000000000000000000000cccccccccccccccccccccccc",
    key:   "0000000000000000000000000000000000000000000000000000000000000025"
  },
  {
    value: "0000000000000000000000000000000000000000dddddddddddddddddddddddd",
    key:   "0000000000000000000000000000000000000000000000000000000000000026"
  },
  {
    value: "00000000000000000000000000000000000000000000000000000000abcdabcd",
    key:   "000000000000000000000000000000000000000000000000000000000000002d"
  }
]

The state reported by `bloc` is 
{
  theUInts: [
    "0",
    "0",
    "0",
    "0",
    "123451234512345",
    "0", 
    "0"
  ],

  theAddresses: [
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000aaaaaaaaaaaaaaaaaaaaaaaa",
    "0000000000000000bbbbbbbbbbbbbbbbbbbbbbbb",
    "0000000000000000cccccccccccccccccccccccc",
    "0000000000000000dddddddddddddddddddddddd",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000"
  ],

  theInts: [
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "-70473afaedd9",
    "0",
    "0"
   ],

  theBools: [
    false,
    false,
    true
  ],
 
  theBytes: [
    "",
    "",
    "�ͫ�"
  ]
}

-}

fixedArraysStateList = 
  [
    (
      "0000000000000000000000000000000000000000000000000000000000000004",
      "000000000000000000000000000000000000000000000000000070473afaedd9"
    ),
    ( 
      "000000000000000000000000000000000000000000000000000000000000001b",      
      "ffffffffffffffffffffffffffffffffffffffffffffffffffff8fb8c5051227"
    ),
    (
      "000000000000000000000000000000000000000000000000000000000000001e",
      "0000000000000000000000000000000000000000000000000000000000010000"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000023",
      "0000000000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaa"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000024",
      "0000000000000000000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbb"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000025",
      "0000000000000000000000000000000000000000cccccccccccccccccccccccc"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000026",
      "0000000000000000000000000000000000000000dddddddddddddddddddddddd"                                   
    ),
    (
      "000000000000000000000000000000000000000000000000000000000000002d",
      "00000000000000000000000000000000000000000000000000000000abcdabcd"
    )                                                                                                             
 ] 

fixedArraysValueListWord256 :: [Word256]
fixedArraysValueListWord256 = map (fromIntegral . fst . head . readHex . snd) fixedArraysStateList

fixedArraysValueVec = map (V.fromList . BS.unpack . BN.encode) fixedArraysValueListWord256         

fixedArraysStateMap  = Map.fromList $ zip (map (fromIntegral . fst . head . readHex . fst) fixedArraysStateList)  
                                          fixedArraysValueVec

fixedArraysUnlabeledState =
  SolidityUnlabeledState {
    unlabeledState = fixedArraysStateMap
  , unlabeledAddress = (fromIntegral 120)
  }

bytePacking = "contract BytePacking { \n\
               \  bytes8[12] theBytes; \n\
               \\n\
               \  function BytePacking() { \n\
               \    theBytes[0] = 0xaaaaaaaaaaaaaaaa; \n\
               \    theBytes[1] = 0xbbbbbbbbbbbbbbbb; \n\
               \    theBytes[2] = 0xcccccccccccccccc; \n\
               \    theBytes[3] = 0xdddddddddddddddd; \n\
               \    theBytes[4] = 0xeeeeeeeeeeeeeeee; \n\
               \    theBytes[5] = 0xffffffffffffffff; \n\
               \    theBytes[6] = 0x1111111111111111; \n\
               \    theBytes[7] = 0x2222222222222222; \n\
               \    theBytes[8] = 0x3333333333333333; \n\
               \    theBytes[9] = 0x4444444444444444; \n\
               \    theBytes[10] = 0x5555555555555555; \n\
               \    theBytes[11] = 0x6666666666666666; \n\
               \\n\ 
               \  }\n\
               \}"

{-
byte packing state on strato-dev4 (14e64031b5b5d3448ea33bea79c40b2b00631b82)

[
  {
    value: "ddddddddddddddddccccccccccccccccbbbbbbbbbbbbbbbbaaaaaaaaaaaaaaaa",
    key:   "0000000000000000000000000000000000000000000000000000000000000000"
  },
  {
    value: "22222222222222221111111111111111ffffffffffffffffeeeeeeeeeeeeeeee",
    key:   "0000000000000000000000000000000000000000000000000000000000000001"
  },
  {
    key:   "0000000000000000000000000000000000000000000000000000000000000002"
    value: "6666666666666666555555555555555544444444444444443333333333333333",
  }
]

(unintelligible) state as reported by bloc:

{
  theBytes: [
    "��������",
    "��������",
    "��������",
    "��������",
    "��������",
    "��������",
    "",
    """""""""",
    "33333333",
    "DDDDDDDD",
    "UUUUUUUU",
    "ffffffff"
  ]
}
-}


bytePackingStateList = 
  [
    (
      "0000000000000000000000000000000000000000000000000000000000000000",
      "ddddddddddddddddccccccccccccccccbbbbbbbbbbbbbbbbaaaaaaaaaaaaaaaa"
    ),
    ( 
      "0000000000000000000000000000000000000000000000000000000000000001",      
      "22222222222222221111111111111111ffffffffffffffffeeeeeeeeeeeeeeee"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000002",
      "6666666666666666555555555555555544444444444444443333333333333333"
    )
  ]

bytePackingValueListWord256 :: [Word256]
bytePackingValueListWord256 = map (fromIntegral . fst . head . readHex . snd) bytePackingStateList

bytePackingValueVec = map (V.fromList . BS.unpack . BN.encode) bytePackingValueListWord256         

bytePackingStateMap  = Map.fromList $ zip (map (fromIntegral . fst . head . readHex . fst) bytePackingStateList) bytePackingValueVec
  

bytePackingUnlabeledState =
  SolidityUnlabeledState {
    unlabeledState = bytePackingStateMap
  , unlabeledAddress = (fromIntegral 120)
  }

bytePackingII = "contract BytePackingII { \n\
                \  bytes4[19] theBytes; \n\
                \  address[10] theAddresses; \n\
                \\n\
                \  function BytePackingII() { \n\
                \    theBytes[0] = 0xaaaaaaaa; \n\
                \    theBytes[1] = 0xbbbbbbbb; \n\
                \    theBytes[2] = 0xcccccccc; \n\
                \    theBytes[3] = 0xdddddddd; \n\
                \    theBytes[4] = 0xeeeeeeee; \n\
                \    theBytes[5] = 0xffffffff; \n\
                \    theBytes[6] = 0x11111111; \n\
                \    theBytes[7] = 0x22222222; \n\
                \    theBytes[8] = 0x33333333; \n\
                \    theBytes[9] = 0x44444444; \n\
                \    theBytes[10] = 0x55555555; \n\
                \    theBytes[11] = 0x66666666; \n\
                \    theBytes[12] = 0x77777777; \n\
                \    theBytes[13] = 0x88888888; \n\
                \    theBytes[14] = 0x99999999; \n\
                \    theBytes[15] = 0xaaaaaaaa; \n\
                \    theBytes[16] = 0xbbbbbbbb; \n\
                \    theBytes[17] = 0xcccccccc; \n\
                \    theBytes[18] = 0xdddddddd; \n\
                \\n\
                \    theAddresses[0] = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef; \n\
                \    theAddresses[1] = 0xcccccccccccccccccccccccccccccccccccccccc; \n\
                \ } \n\
                \}"

{-
byte packing II state on strato-dev4 (fe17003b9e33ed9818d6eafe696a0e14d71a04e9)

[
  {
    value: "2222222211111111ffffffffeeeeeeeeddddddddccccccccbbbbbbbbaaaaaaaa",
    key: "  0000000000000000000000000000000000000000000000000000000000000000"
  },
  {
    value: "aaaaaaaa99999999888888887777777766666666555555554444444433333333",
    key:   "0000000000000000000000000000000000000000000000000000000000000001"
  },
  {
    value: "0000000000000000000000000000000000000000ddddddddccccccccbbbbbbbb",
    key:   "0000000000000000000000000000000000000000000000000000000000000002"
  },
  {
    value: "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    key:   "0000000000000000000000000000000000000000000000000000000000000003"
  },
  {
    value: "000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
    key: "  0000000000000000000000000000000000000000000000000000000000000004"
  }
]

state as reported by bloc:

{
  theAddresses: [
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    "cccccccccccccccccccccccccccccccccccccccc",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000"
  ],

  theBytes: [
    "����",
    "����",
    "����",
    "����",
    "����",
    "����",
    "",
    """""",
    "3333",
    "DDDD",
    "UUUU",
    "ffff",
    "wwww",
    "����",
    "����",
    "����",
    "����",
    "����",
    "����"
  ]
}

-}


bytePackingIIStateList = 
  [
    (
      "0000000000000000000000000000000000000000000000000000000000000000",
      "2222222211111111ffffffffeeeeeeeeddddddddccccccccbbbbbbbbaaaaaaaa"
    ),
    ( 
      "0000000000000000000000000000000000000000000000000000000000000001",      
      "aaaaaaaa99999999888888887777777766666666555555554444444433333333"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000002",
      "0000000000000000000000000000000000000000ddddddddccccccccbbbbbbbb"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000003",
      "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    ),
    (
      "0000000000000000000000000000000000000000000000000000000000000004",
      "000000000000000000000000cccccccccccccccccccccccccccccccccccccccc"
    )  
  ]

bytePackingIIValueListWord256 :: [Word256]
bytePackingIIValueListWord256 = map (fromIntegral . fst . head . readHex . snd) bytePackingIIStateList

bytePackingIIValueVec = map (V.fromList . BS.unpack . BN.encode) bytePackingIIValueListWord256         

bytePackingIIStateMap  = Map.fromList $ zip (map (fromIntegral . fst . head . readHex . fst) bytePackingIIStateList) bytePackingIIValueVec
  

bytePackingIIUnlabeledState =
  SolidityUnlabeledState {
    unlabeledState = bytePackingIIStateMap
  , unlabeledAddress = (fromIntegral 120)
  }


{-
  Nested Fix Length Arrays

-}

{-
  Byte Overflow Test

  strato-dev4 address: 79ccf721b3d861be5b5d28a41eb1e22860b83057

[
  {
    value: "0000ccccccccccccccccccccbbbbbbbbbbbbbbbbbbbbaaaaaaaaaaaaaaaaaaaa",
    key:   "0000000000000000000000000000000000000000000000000000000000000000"
  },
  {
    value: "00000000000000000000000000000000000000000000dddddddddddddddddddd",
    key:   "0000000000000000000000000000000000000000000000000000000000000001"
  }
]
 
  bloc state:

{
  theBytes: [
    "����������",
    "����������",
    "����������",
    "����������"
  ]
}

-}


test_complex_state = testGroup "complex state identification" $ 
  [ 
    testCase "convertSingleValue succeeds on array of bytes8" $ do 
      let bytesI = [0,205,171,205,171,205,171,205] :: [Word8]
          bytesII = [222,173,190,239,222,173,190,239] :: [Word8]
          bytesIII = [171,205,171,205,171,205,171,205] :: [Word8]
          bytesIV = [222,173,190,239,222,173,190,239] :: [Word8]
   
          bytesArray = concat $ [ bytesI, bytesII, bytesIII, bytesIV ] 
          solArray =  FixedArray (FixedBytes 8) 4   
          theKey = 0
          value = convertValueSingleKey theKey (V.fromList bytesArray) solArray
     
      assertBool "convertSingleValue output is correct" $ 
        value ==  
          FixedSizeArray {
            unSize = 4, 
            unFixedValues = 
            V.fromList $ [
              Bytes {
                unBytes = Bytes8 $ V.fromList [222,173,190,239,222,173,190,239]
              },
              Bytes {
                unBytes = Bytes8 $ V.fromList [171,205,171,205,171,205,171,205]
              },
              Bytes {
                unBytes = Bytes8 $ V.fromList [222,173,190,239,222,173,190,239]
              },
              Bytes {
                unBytes = Bytes8 $ V.fromList [0,205,171,205,171,205,171,205]
              }
            ]
          }
        
  , 
    testCase "fixedArrays contract layout is as expected" $ do
      let parsed = parse (\src -> "TheImportName") "FixedArrays.sol" fixedArrays
          eitherLayout = layout <$> parsed
          contractsLayout = lookupContracts <$> parsed <*> eitherLayout

          layoutShouldBe = 
           Right [
             ContractLayout {
               objsLayout = 
                 Map.fromList [
                   ("theAddresses",ObjLayout {objStartBytes = 992, objEndBytes = 1375}),
                   ("theBools",ObjLayout {objStartBytes = 960, objEndBytes = 991}),
                   ("theBytes",ObjLayout {objStartBytes = 1376, objEndBytes = 1471}),
                   ("theInts",ObjLayout {objStartBytes = 224, objEndBytes = 959}),
                   ("theUInts",ObjLayout {objStartBytes = 0, objEndBytes = 223})
                 ], 
               typesLayout = 
                 Map.fromList [
                   ("FixedArrays",ContractTLayout {typeUsedBytes = 20})
                 ]
             }
           ]

      assertBool "contract layout matches" (contractsLayout == layoutShouldBe) 

      let addressesLayout = ObjLayout {objStartBytes = 992, objEndBytes = 1375}
          startAddresses = startKey addressesLayout
          endAddresses = endKey addressesLayout

      assertBool "startAddresses is correct" (startAddresses == 31)
      assertBool "endAddresses is correct" (endAddresses == 42)
  , 

    testCase "fixedArrays state matches expectations" $ do
      let parsed = parse (\src -> "TheImportName") "FixedArrays.sol" fixedArrays
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x
          
      let contracts = lookupContracts solFile (layout solFile)

      assertBool "contracts found" (contracts /= [])

      let layout = lookupObjectLayout 
                     (head . filter (\obj -> (objName obj) == "theAddresses") $ 
                       (contractObjs . head) solFile)
                     (head contracts)

      assertBool "layout for variable theAddresses found" (isJust layout)

      let eitherVariables = extractVariables <$> parsed      

      assertBool "extractingVariables didn't crash" (isRight eitherVariables)

      let state = translateState solFile fixedArraysUnlabeledState 

      print (toJSON state)
      BS.putStr $ (Aeson.encodePretty state)

      assertBool "fixedArray state matches" False
  , 
    testCase "bytePacking contract layout is as expected" $ do
      let parsed = parse (\src -> "TheImportName") "BytePacking.sol" bytePacking
          eitherLayout = layout <$> parsed
          contractsLayout = lookupContracts <$> parsed <*> eitherLayout
          
          layoutShouldBe = 
            Right [
              ContractLayout {
                objsLayout =
                  Map.fromList [
                    ("theBytes",ObjLayout {objStartBytes = 0, objEndBytes = 95})
                  ],  
                typesLayout = 
                  Map.fromList [
                    ("BytePacking",ContractTLayout {typeUsedBytes = 20})
                  ]
              }
            ]

      assertBool "contract layout matches" (contractsLayout == layoutShouldBe) 
  ,

    testCase "bytePacking state matches expectations" $ do
      let parsed = parse (\src -> "TheImportName") "FixedArrays.sol" bytePacking
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x
          
      let contracts = lookupContracts solFile (layout solFile)

      assertBool "contracts found" (contracts /= [])

      let eitherVariables = extractVariables <$> parsed      

      assertBool "extractingVariables didn't crash" (isRight eitherVariables)

      let state = translateState solFile bytePackingUnlabeledState 

      print (toJSON state)
      BS.putStr $ (Aeson.encodePretty state)

      assertBool "bytePacking state matches" False
  , 
    testCase "bytePackingII contract layout is as expected" $ do
      let parsed = parse (\src -> "TheImportName") "BytePackingII.sol" bytePackingII
          eitherLayout = layout <$> parsed
          contractsLayout = lookupContracts <$> parsed <*> eitherLayout

          layoutShouldBe = 
            Right [
              ContractLayout {
                objsLayout =
                  Map.fromList [
                    ("theBytes",ObjLayout {objStartBytes = 0, objEndBytes = 95}),
                    ("theAddresses", ObjLayout {objStartBytes = 96, objEndBytes = 415})
                  ],  
                typesLayout = 
                  Map.fromList [
                    ("BytePackingII",ContractTLayout {typeUsedBytes = 20})
                  ]
              }
            ]

      assertBool "contract layout matches" (contractsLayout == layoutShouldBe) 
  , 

    testCase "bytePackingII state matches expectations" $ do
      let parsed = parse (\src -> "TheImportName") "BytePackingII.sol" bytePackingII
          solFile = case parsed of 
            (Left _) -> error "failed to parse"
            Right x -> x
          
      let contracts = lookupContracts solFile (layout solFile)

      assertBool "contracts found" (contracts /= [])

      let eitherVariables = extractVariables <$> parsed      

      assertBool "extractingVariables didn't crash" (isRight eitherVariables)

      let state = translateState solFile bytePackingIIUnlabeledState 

      print (toJSON state)
      BS.putStr $ (Aeson.encodePretty state)

      assertBool "bytePackingII state matches" False
  , 
    testCase "flatten spanning two keys works correctly" $ do
      let objLayout = ObjLayout {objStartBytes = 20, objEndBytes = 39}
          startString = "abcdabcdabcdabcdabcdabcd0000000000000000000000000000000000000000"
          startWord256 = fromIntegral . fst . head . readHex $ startString :: Word256
          startVec = V.fromList $ (BS.unpack . BN.encode) startWord256

          continueString = "000000000000000000000000000000000000000000000000abcdabcdabcdabcd"
          continueWord256 = fromIntegral . fst . head . readHex $ continueString :: Word256
          continueVec = V.fromList $ (BS.unpack . BN.encode) continueWord256

          stateMapTwoKeys = 
            Map.fromList 
            [
              (
                0 :: Word256,
                startVec
              )
            ,
              (
                1 :: Word256,
                continueVec
              )
            ]

          startK = startKey objLayout 
          endK = endKey objLayout
          
          flattened = flattenRelevantValues objLayout stateMapTwoKeys
      
      assertBool "start key is 0" (startK == 0)
      assertBool "end key is 1" (endK == 1)

      assertBool "length of startVec is 32" (V.length startVec == 32)

      assertBool "total length is 20 bytes" (V.length (unKey flattened) == 20)
      assertBool "bytes match" (unKey flattened == V.fromList [171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205,171,205])


  ]
