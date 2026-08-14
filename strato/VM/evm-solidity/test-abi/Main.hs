{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import BlockApps.Solidity.ABI
import Control.Monad (unless)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Default (def)
import qualified Data.Map as M
import Data.Source (SourceAnnotation)
import qualified Data.Text as T
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.Event (EventF (..), EventLog (..))
import SolidVM.Model.CodeCollection.VarDef (FieldType (..), IndexedType (..))
import SolidVM.Model.SolidString (SolidString, stringToLabel)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..), Variable (Constant))
import System.Exit (exitFailure)

main :: IO ()
main = do
  testNestedTupleCodec
  testAcrossSelectorAndLiteral
  testEmptyBytesLiteral
  testRefundLeafArrays
  testDynamicTupleEvent
  testAcrossFilledRelayTopic
  testAcrossTokensBridgedTopic
  putStrLn "ABI bridge tests passed"

testNestedTupleCodec :: IO ()
testNestedTupleCodec = do
  let tupleType = TTuple [TBytesN 32, TUint 256, TBytes]
      tupleValue = STuple . V.fromList $ map Constant
        [ SBytes $ B.replicate 32 0x11
        , SInteger 7
        , SBytes $ B.pack [0xaa, 0xbb, 0xcc]
        ]
      types = [tupleType, TUint 256, TBytesN 32]
      values = [tupleValue, SInteger 9, SBytes $ B.replicate 32 0x22]
      expected = hex
        "0000000000000000000000000000000000000000000000000000000000000060\
        \0000000000000000000000000000000000000000000000000000000000000009\
        \2222222222222222222222222222222222222222222222222222222222222222\
        \1111111111111111111111111111111111111111111111111111111111111111\
        \0000000000000000000000000000000000000000000000000000000000000007\
        \0000000000000000000000000000000000000000000000000000000000000060\
        \0000000000000000000000000000000000000000000000000000000000000003\
        \aabbcc0000000000000000000000000000000000000000000000000000000000"
      encoded = encodeValues types values
  assertEqual "nested tuple encoding matches standard Solidity ABI" expected encoded
  assertEqual "nested tuple decoder round-trips canonical ABI" expected $ encodeValues types (decodeValues types expected)
  assertEqual "canonical tuple parser" (Just tupleType) $ parseTypeDescriptor "(bytes32,uint256,bytes)"

testAcrossSelectorAndLiteral :: IO ()
testAcrossSelectorAndLiteral = do
  let relayName = stringToLabel "V3RelayData"
      relayFields =
        [ field "depositor" bytes32
        , field "recipient" bytes32
        , field "exclusiveRelayer" bytes32
        , field "inputToken" bytes32
        , field "outputToken" bytes32
        , field "inputAmount" uint256
        , field "outputAmount" uint256
        , field "originChainId" uint256
        , field "depositId" uint256
        , field "fillDeadline" uint32
        , field "exclusivityDeadline" uint32
        , field "message" dynamicBytes
        ]
      contract = (def :: CC.Contract) {CC._structs = M.singleton relayName relayFields}
      relayType = SVMType.Struct Nothing relayName
      canonical = "(bytes32,bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256,uint32,uint32,bytes)"
      selector = computeSelectorWithContract contract (stringToLabel "fillRelay") [relayType, uint256, bytes32]
      shortStructName = stringToLabel "ShortRelay"
      shortFields = [field "id" bytes32, field "amount" uint256, field "message" dynamicBytes]
      shortContract = contract {CC._structs = M.insert shortStructName shortFields (CC._structs contract)}
      shortType = SVMType.Struct Nothing shortStructName
      shortDescriptor = TTuple [TBytesN 32, TUint 256, TBytes]
      encoded = encodeValues [shortDescriptor]
        [STuple . V.fromList $ map Constant [SBytes $ B.replicate 32 0x11, SInteger 7, SBytes $ B.pack [0xaa, 0xbb, 0xcc]]]
      decoded = decodeABIArgsWithContract shortContract encoded [shortType]
  assertEqual "Across relay tuple canonical type" canonical $ svmTypeToCanonicalWithContract contract relayType
  assertEqual "Across fillRelay selector" (B.pack [0xde, 0xff, 0x4b, 0x24]) selector
  case decoded of
    [value] -> assertEqual "SolidVM struct literal" expectedLiteral $ valueToArgTextWithType shortContract shortType value
    _ -> failTest "SolidVM struct literal" "decoder did not return one struct"
  where
    expectedLiteral =
      "{id:hex\"1111111111111111111111111111111111111111111111111111111111111111\",amount:7,message:hex\"aabbcc\"}"

testEmptyBytesLiteral :: IO ()
testEmptyBytesLiteral =
  assertEqual "empty dynamic bytes use the canonical SolidVM hex literal" "hex\"\"" $ valueToArgText (SBytes B.empty)

testRefundLeafArrays :: IO ()
testRefundLeafArrays = do
  let leafType = TTuple
        [ TUint 256
        , TUint 256
        , TArrayOf $ TUint 256
        , TUint 32
        , TAddress
        , TArrayOf TAddress
        ]
      leafValue = STuple . V.fromList $ map Constant
        [ SInteger 1
        , SInteger 2
        , SArray . V.fromList $ map (Constant . SInteger) [3, 4]
        , SInteger 5
        , SAddress 0x1111111111111111111111111111111111111111 False
        , SArray . V.fromList $ map (Constant . (`SAddress` False))
            [ 0x2222222222222222222222222222222222222222
            , 0x3333333333333333333333333333333333333333
            ]
        ]
      expected = hex
        "0000000000000000000000000000000000000000000000000000000000000020\
        \0000000000000000000000000000000000000000000000000000000000000001\
        \0000000000000000000000000000000000000000000000000000000000000002\
        \00000000000000000000000000000000000000000000000000000000000000c0\
        \0000000000000000000000000000000000000000000000000000000000000005\
        \0000000000000000000000001111111111111111111111111111111111111111\
        \0000000000000000000000000000000000000000000000000000000000000120\
        \0000000000000000000000000000000000000000000000000000000000000002\
        \0000000000000000000000000000000000000000000000000000000000000003\
        \0000000000000000000000000000000000000000000000000000000000000004\
        \0000000000000000000000000000000000000000000000000000000000000002\
        \0000000000000000000000002222222222222222222222222222222222222222\
        \0000000000000000000000003333333333333333333333333333333333333333"
      encoded = encodeValues [leafType] [leafValue]
  assertEqual "refund leaf with two dynamic arrays matches standard ABI" expected encoded
  assertEqual "refund leaf dynamic arrays round-trip" expected $ encodeValues [leafType] (decodeValues [leafType] expected)

testDynamicTupleEvent :: IO ()
testDynamicTupleEvent = do
  let infoName = stringToLabel "Info"
      fillTypeName = stringToLabel "FillType"
      infoFields =
        [ field "updatedRecipient" bytes32
        , field "amount" uint256
        -- The compiler stores a source enum member as an unresolved label in
        -- its enclosing struct. The ABI bridge must resolve that label from
        -- the contract instead of falling back to uint256.
        , field "fillType" $ SVMType.UnknownLabel fillTypeName
        ]
      contract = (def :: CC.Contract)
        { CC._structs = M.singleton infoName infoFields
        , CC._enums = M.singleton fillTypeName ([stringToLabel "FastFill", stringToLabel "SlowFill"], def)
        }
      eventDef :: EventF ()
      eventDef = Event
        { _eventAnonymous = False
        , _eventLogs =
            [ EventLog "id" True $ IndexedType 0 bytes32 Nothing
            , EventLog "message" False $ IndexedType 1 dynamicBytes Nothing
            , EventLog "info" False $ IndexedType 2 (SVMType.Struct Nothing infoName) Nothing
            ]
        , _eventContext = ()
        }
      attrs = M.fromList
        [ ("id", T.replicate 64 "1")
        , ("message", "aabbcc")
        , ("info", "Info{updatedRecipient: 2222222222222222222222222222222222222222222222222222222222222222, amount: 7, fillType: FillType.FastFill (= 0)}")
        ]
      expectedTopic0 = hex "c91005d1d2aecff57e57df25b63cfca0a7339bd89c1c2cf0b3d2c75035dd361c"
      expectedData = hex
        "0000000000000000000000000000000000000000000000000000000000000080\
        \2222222222222222222222222222222222222222222222222222222222222222\
        \0000000000000000000000000000000000000000000000000000000000000007\
        \0000000000000000000000000000000000000000000000000000000000000000\
        \0000000000000000000000000000000000000000000000000000000000000003\
        \aabbcc0000000000000000000000000000000000000000000000000000000000"
      (topics, eventData) = encodeEventToLog contract (stringToLabel "Test") eventDef attrs
  assertEqual "event topics include canonical struct signature and indexed id"
    [expectedTopic0, B.replicate 32 0x11] topics
  assertEqual "event data uses one shared ABI head/tail" expectedData eventData

testAcrossFilledRelayTopic :: IO ()
testAcrossFilledRelayTopic = do
  let infoName = stringToLabel "V3RelayExecutionEventInfo"
      fillTypeName = stringToLabel "FillType"
      infoFields =
        [ field "updatedRecipient" bytes32
        , field "updatedMessageHash" bytes32
        , field "updatedOutputAmount" uint256
        , field "fillType" $ SVMType.UnknownLabel fillTypeName
        ]
      contract = (def :: CC.Contract)
        { CC._structs = M.singleton infoName infoFields
        , CC._enums = M.singleton fillTypeName
            ([stringToLabel "FastFill", stringToLabel "ReplacedSlowFill", stringToLabel "SlowFill"], def)
        }
      eventDef :: EventF ()
      eventDef = Event
        { _eventAnonymous = False
        , _eventLogs = zipWith3 mkLog [0..]
            [ "inputToken", "outputToken", "inputAmount", "outputAmount", "repaymentChainId"
            , "originChainId", "depositId", "fillDeadline", "exclusivityDeadline"
            , "exclusiveRelayer", "relayer", "depositor", "recipient", "messageHash"
            , "relayExecutionInfo"
            ]
            [ bytes32, bytes32, uint256, uint256, uint256, uint256, uint256, uint32, uint32
            , bytes32, bytes32, bytes32, bytes32, bytes32, SVMType.Struct Nothing infoName
            ]
        , _eventContext = ()
        }
      attrs = M.fromList
        [ ("inputToken", T.replicate 64 "1")
        , ("outputToken", T.replicate 64 "2")
        , ("inputAmount", "100")
        , ("outputAmount", "90")
        , ("repaymentChainId", "229025714941789")
        , ("originChainId", "1")
        , ("depositId", "424242")
        , ("fillDeadline", "1786592123")
        , ("exclusivityDeadline", "0")
        , ("exclusiveRelayer", T.replicate 64 "0")
        , ("relayer", T.replicate 24 "0" <> T.replicate 40 "7")
        , ("depositor", T.replicate 64 "3")
        , ("recipient", T.replicate 64 "4")
        , ("messageHash", T.replicate 64 "0")
        , ("relayExecutionInfo", "V3RelayExecutionEventInfo{\"fillType\": 0, \"updatedMessageHash\": \"" <> T.replicate 64 "0" <> "\", \"updatedOutputAmount\": 90, \"updatedRecipient\": \"" <> T.replicate 64 "4" <> "\"}")
        ]
      (topics, eventData) = encodeEventToLog contract (stringToLabel "FilledRelay") eventDef attrs
      expectedTopic = hex "44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208"
      expectedData = B.concat
        [ B.replicate 32 0x11, B.replicate 32 0x22, word 100, word 90, word 229025714941789
        , word 1786592123, word 0, B.replicate 32 0x00, B.replicate 32 0x33
        , B.replicate 32 0x44, B.replicate 32 0x00, B.replicate 32 0x44
        , B.replicate 32 0x00, word 90, word 0
        ]
  case topics of
    topic0 : _ -> assertEqual "Across FilledRelay topic matches the official ABI" expectedTopic topic0
    [] -> failTest "Across FilledRelay topic matches the official ABI" "no topic was emitted"
  assertEqual "Across FilledRelay data includes its nested execution tuple" expectedData eventData
  where
    mkLog idx name typ = EventLog (T.pack name) (name `elem` ["originChainId", "depositId", "relayer"]) $ IndexedType idx typ Nothing
    word :: Integer -> B.ByteString
    word value = B.replicate (32 - B.length encoded) 0 <> encoded
      where
        encoded = integerBytes value
    integerBytes :: Integer -> B.ByteString
    integerBytes 0 = B.singleton 0
    integerBytes value = B.reverse $ B.unfoldr step value
    step 0 = Nothing
    step value = Just (fromIntegral value, value `div` 256)

testAcrossTokensBridgedTopic :: IO ()
testAcrossTokensBridgedTopic = do
  let eventDef :: EventF ()
      eventDef = Event
        { _eventAnonymous = False
        , _eventLogs = zipWith3 mkLog [0..]
            ["amountToReturn", "chainId", "leafId", "l2TokenAddress", "caller"]
            [uint256, uint256, uint32, bytes32, address]
        , _eventContext = ()
        }
      attrs = M.fromList
        [ ("amountToReturn", "25")
        , ("chainId", "229025714941789")
        , ("leafId", "4")
        , ("l2TokenAddress", T.replicate 64 "1")
        , ("caller", T.replicate 40 "2")
        ]
      (topics, eventData) = encodeEventToLog (def :: CC.Contract)
        (stringToLabel "TokensBridged") eventDef attrs
      expectedTopic = hex "fa7fa7cf6d7dde5f9be65a67e6a1a747e7aa864dcd2d793353c722d80fbbb357"
  assertEqual "Across TokensBridged topic and indexed words match the official ABI"
    [expectedTopic, word 229025714941789, word 4, B.replicate 32 0x11] topics
  assertEqual "Across TokensBridged data contains amount and caller"
    (word 25 <> B.replicate 12 0 <> B.replicate 20 0x22) eventData
  where
    mkLog idx name typ = EventLog (T.pack name)
      (name `elem` ["chainId", "leafId", "l2TokenAddress"]) $ IndexedType idx typ Nothing
    word :: Integer -> B.ByteString
    word value = B.replicate (32 - B.length encoded) 0 <> encoded
      where
        encoded = integerBytes value
    integerBytes :: Integer -> B.ByteString
    integerBytes 0 = B.singleton 0
    integerBytes value = B.reverse $ B.unfoldr step value
    step 0 = Nothing
    step value = Just (fromIntegral value, value `div` 256)

field :: String -> SVMType.Type -> (SolidString, FieldType, SourceAnnotation ())
field name typ = (stringToLabel name, FieldType 0 typ, def)

bytes32 :: SVMType.Type
bytes32 = SVMType.Bytes Nothing $ Just 32

dynamicBytes :: SVMType.Type
dynamicBytes = SVMType.Bytes (Just True) Nothing

uint256 :: SVMType.Type
uint256 = SVMType.Int Nothing Nothing

uint32 :: SVMType.Type
uint32 = SVMType.Int Nothing $ Just 4

address :: SVMType.Type
address = SVMType.Address False

hex :: String -> B.ByteString
hex input = case B16.decode $ BC.pack input of
  Right value -> value
  Left err -> error $ "invalid test hex: " ++ err

assertEqual :: (Eq a, Show a) => String -> a -> a -> IO ()
assertEqual label expected actual =
  unless (expected == actual) $ failTest label $ "expected " ++ show expected ++ ", got " ++ show actual

failTest :: String -> String -> IO a
failTest label detail = do
  putStrLn $ "FAIL: " ++ label ++ ": " ++ detail
  exitFailure
