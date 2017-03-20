{-# LANGUAGE
    LambdaCase
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.SolidityVarReader (
  decodeValue,
  decodeValues,
  word256ToByteString,
  byteStringToWord256,
  valueToSolidityValue
  ) where

import qualified Data.Bimap as Bimap
import Data.Binary
import Data.Bits
import qualified Data.ByteArray as ByteArray
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.LargeWord
import qualified Data.Map as Map
import Data.Maybe
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Text.Printf

import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.Storage (Storage)
import BlockApps.Solidity.Contract
import qualified BlockApps.Storage as Storage
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Value


valueToSolidityValue::Value->SolidityValue
valueToSolidityValue (SimpleValue (ValueBool x)) = SolidityBool x

valueToSolidityValue (SimpleValue (ValueInt8 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt16 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt24 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt32 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt40 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt48 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt56 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt64 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt72 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt80 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt88 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt96 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt104 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt112 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt120 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt128 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt136 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt144 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt152 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt160 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt168 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt176 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt184 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt192 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt200 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt208 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt216 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt224 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt232 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt240 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt248 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt256 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt8 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt16 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt24 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt32 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt40 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt48 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt56 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt64 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt72 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt80 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt88 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt96 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt104 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt112 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt120 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt128 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt136 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt144 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt152 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt160 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt168 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt176 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt184 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt192 v)) = SolidityValueAsString $ T.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt200 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt208 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt216 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt224 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt232 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt240 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt248 v)) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt256 v)) = SolidityValueAsString $ T.pack $ show v




valueToSolidityValue (SimpleValue (ValueString s)) = SolidityValueAsString s
valueToSolidityValue (SimpleValue (ValueAddress (Address addr))) =
  SolidityValueAsString $ T.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueContract (Address addr)) =
  SolidityValueAsString $ T.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueArrayFixed _ values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (ValueArrayDynamic values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (SimpleValue (ValueBytes bytes)) = SolidityValueAsString $ T.pack $ BC.unpack bytes
valueToSolidityValue (ValueEnum name value) = SolidityValueAsString $ name `T.append` "." `T.append` value
valueToSolidityValue (ValueStruct namedItems) =
  SolidityObject $ map (fmap valueToSolidityValue) namedItems
valueToSolidityValue (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString $ T.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"
valueToSolidityValue x = error $ "missing value in valueToSolidityValue: " ++ show x


word256ToByteString::Word256->ByteString
word256ToByteString=BL.toStrict . encode


byteStringToWord256::ByteString->Word256
byteStringToWord256 x = sum $ map (\(shiftBits, v) -> v `shiftL` (shiftBits*8)) $ zip [31,30..0] $ map fromIntegral $ ByteString.unpack x


decodeValues
  :: TypeDefs
  -> Struct
  -> Storage
  -> Word256
  -> [(Text, Value)]
decodeValues typeDefs' struct'@Struct{..} storage offset = 
  let
    varNames = Map.keys fields
  in
   --catMaybes will return all items, since a Nothing can only result from a varnamea that isn't in the map, but varNames is the keys of the map
   zip varNames $ catMaybes $ map (decodeValue typeDefs' storage offset struct') varNames

decodeValue
  :: TypeDefs
  -> Storage
  -> Word256
  -> Struct
  -> Text
  -> Maybe Value
decodeValue typeDefs' storage offset Struct{..} varName = do
  case Map.lookup varName fields of
   Nothing -> Nothing
   Just (position, theType) ->
     Just $ decodeValue' typeDefs' storage (position `Storage.addBytes` (fromIntegral $ 32*offset)) theType


decodeValue'
  :: TypeDefs
  -> Storage
  -> Storage.Position
  -> Type
  -> Value
decodeValue' typeDefs'@TypeDefs{..} storage position@Storage.Position{..} = \case
  SimpleType TypeBool ->
    let
      SimpleValue (ValueInt8 word8) = decodeValue' typeDefs' storage position (SimpleType TypeInt8)
    in
     SimpleValue $ ValueBool $ word8 /= 0
     
  SimpleType TypeUInt -> decodeValue' typeDefs' storage position $ SimpleType $ TypeUInt256

  
  SimpleType TypeInt8 -> decodeInt storage offset byte ValueInt8
  SimpleType TypeInt16 -> decodeInt storage offset byte ValueInt16
  SimpleType TypeInt24 -> decodeInt storage offset byte ValueInt24
  SimpleType TypeInt32 -> decodeInt storage offset byte ValueInt32
  SimpleType TypeInt40 -> decodeInt storage offset byte ValueInt40
  SimpleType TypeInt48 -> decodeInt storage offset byte ValueInt48
  SimpleType TypeInt56 -> decodeInt storage offset byte ValueInt56
  SimpleType TypeInt64 -> decodeInt storage offset byte ValueInt64

  SimpleType TypeInt72 -> decodeInt storage offset byte ValueInt72
  SimpleType TypeInt80 -> decodeInt storage offset byte ValueInt80
  SimpleType TypeInt88 -> decodeInt storage offset byte ValueInt88
  SimpleType TypeInt96 -> decodeInt storage offset byte ValueInt96
  SimpleType TypeInt104 -> decodeInt storage offset byte ValueInt104
  SimpleType TypeInt112 -> decodeInt storage offset byte ValueInt112
  SimpleType TypeInt120 -> decodeInt storage offset byte ValueInt120
  SimpleType TypeInt128 -> decodeInt storage offset byte ValueInt128

  SimpleType TypeInt136 -> decodeInt storage offset byte ValueInt136
  SimpleType TypeInt144 -> decodeInt storage offset byte ValueInt144
  SimpleType TypeInt152 -> decodeInt storage offset byte ValueInt152
  SimpleType TypeInt160 -> decodeInt storage offset byte ValueInt160
  SimpleType TypeInt168 -> decodeInt storage offset byte ValueInt168
  SimpleType TypeInt176 -> decodeInt storage offset byte ValueInt176
  SimpleType TypeInt184 -> decodeInt storage offset byte ValueInt184
  SimpleType TypeInt192 -> decodeInt storage offset byte ValueInt192

  SimpleType TypeInt200 -> decodeInt storage offset byte ValueInt200
  SimpleType TypeInt208 -> decodeInt storage offset byte ValueInt208
  SimpleType TypeInt216 -> decodeInt storage offset byte ValueInt216
  SimpleType TypeInt224 -> decodeInt storage offset byte ValueInt224
  SimpleType TypeInt232 -> decodeInt storage offset byte ValueInt232
  SimpleType TypeInt240 -> decodeInt storage offset byte ValueInt240
  SimpleType TypeInt248 -> decodeInt storage offset byte ValueInt248
  SimpleType TypeInt256 -> decodeInt storage offset byte ValueInt256




  SimpleType TypeUInt8 -> decodeInt storage offset byte ValueUInt8
  SimpleType TypeUInt16 -> decodeInt storage offset byte ValueUInt16
  SimpleType TypeUInt24 -> decodeInt storage offset byte ValueUInt24
  SimpleType TypeUInt32 -> decodeInt storage offset byte ValueUInt32
  SimpleType TypeUInt40 -> decodeInt storage offset byte ValueUInt40
  SimpleType TypeUInt48 -> decodeInt storage offset byte ValueUInt48
  SimpleType TypeUInt56 -> decodeInt storage offset byte ValueUInt56
  SimpleType TypeUInt64 -> decodeInt storage offset byte ValueUInt64

  SimpleType TypeUInt72 -> decodeInt storage offset byte ValueUInt72
  SimpleType TypeUInt80 -> decodeInt storage offset byte ValueUInt80
  SimpleType TypeUInt88 -> decodeInt storage offset byte ValueUInt88
  SimpleType TypeUInt96 -> decodeInt storage offset byte ValueUInt96
  SimpleType TypeUInt104 -> decodeInt storage offset byte ValueUInt104
  SimpleType TypeUInt112 -> decodeInt storage offset byte ValueUInt112
  SimpleType TypeUInt120 -> decodeInt storage offset byte ValueUInt120
  SimpleType TypeUInt128 -> decodeInt storage offset byte ValueUInt128

  SimpleType TypeUInt136 -> decodeInt storage offset byte ValueUInt136
  SimpleType TypeUInt144 -> decodeInt storage offset byte ValueUInt144
  SimpleType TypeUInt152 -> decodeInt storage offset byte ValueUInt152
  SimpleType TypeUInt160 -> decodeInt storage offset byte ValueUInt160
  SimpleType TypeUInt168 -> decodeInt storage offset byte ValueUInt168
  SimpleType TypeUInt176 -> decodeInt storage offset byte ValueUInt176
  SimpleType TypeUInt184 -> decodeInt storage offset byte ValueUInt184
  SimpleType TypeUInt192 -> decodeInt storage offset byte ValueUInt192

  SimpleType TypeUInt200 -> decodeInt storage offset byte ValueUInt200
  SimpleType TypeUInt208 -> decodeInt storage offset byte ValueUInt208
  SimpleType TypeUInt216 -> decodeInt storage offset byte ValueUInt216
  SimpleType TypeUInt224 -> decodeInt storage offset byte ValueUInt224
  SimpleType TypeUInt232 -> decodeInt storage offset byte ValueUInt232
  SimpleType TypeUInt240 -> decodeInt storage offset byte ValueUInt240
  SimpleType TypeUInt248 -> decodeInt storage offset byte ValueUInt248
  SimpleType TypeUInt256 -> decodeInt storage offset byte ValueUInt256




  SimpleType TypeInt -> decodeValue' typeDefs' storage position $ SimpleType TypeInt256

  SimpleType TypeAddress ->
    let
      SimpleValue (ValueUInt160 addr) = decodeValue' typeDefs' storage position $ SimpleType TypeUInt160
    in
      SimpleValue . ValueAddress . Address $ fromIntegral addr
  TypeContract _ ->
    let
      SimpleValue (ValueAddress addr) = decodeValue' typeDefs' storage position $ SimpleType TypeAddress
    in
      ValueContract addr

{-
  TypeFixed (Just (n,m)) ->
    let
      ValueInt x = decodeValue' storage offset (TypeInt (Just 256))
    in
      ValueFixed $ fromIntegral x / 2 ** fromIntegral n
  TypeFixed Nothing -> decodeValue' storage offset (TypeFixed (Just (128,128)))
-}
  SimpleType TypeBytes1 -> decodeByteString storage offset byte 1
  SimpleType TypeBytes2 -> decodeByteString storage offset byte 2
  SimpleType TypeBytes3 -> decodeByteString storage offset byte 3
  SimpleType TypeBytes4 -> decodeByteString storage offset byte 4
  SimpleType TypeBytes5 -> decodeByteString storage offset byte 5
  SimpleType TypeBytes6 -> decodeByteString storage offset byte 6
  SimpleType TypeBytes7 -> decodeByteString storage offset byte 7
  SimpleType TypeBytes8 -> decodeByteString storage offset byte 8
  SimpleType TypeBytes9 -> decodeByteString storage offset byte 9
  SimpleType TypeBytes10 -> decodeByteString storage offset byte 10
  SimpleType TypeBytes11 -> decodeByteString storage offset byte 11
  SimpleType TypeBytes12 -> decodeByteString storage offset byte 12
  SimpleType TypeBytes13 -> decodeByteString storage offset byte 13
  SimpleType TypeBytes14 -> decodeByteString storage offset byte 14
  SimpleType TypeBytes15 -> decodeByteString storage offset byte 15
  SimpleType TypeBytes16 -> decodeByteString storage offset byte 16
  SimpleType TypeBytes17 -> decodeByteString storage offset byte 17
  SimpleType TypeBytes18 -> decodeByteString storage offset byte 18
  SimpleType TypeBytes19 -> decodeByteString storage offset byte 19
  SimpleType TypeBytes20 -> decodeByteString storage offset byte 20
  SimpleType TypeBytes21 -> decodeByteString storage offset byte 21
  SimpleType TypeBytes22 -> decodeByteString storage offset byte 22
  SimpleType TypeBytes23 -> decodeByteString storage offset byte 23
  SimpleType TypeBytes24 -> decodeByteString storage offset byte 24
  SimpleType TypeBytes25 -> decodeByteString storage offset byte 25
  SimpleType TypeBytes26 -> decodeByteString storage offset byte 26
  SimpleType TypeBytes27 -> decodeByteString storage offset byte 27
  SimpleType TypeBytes28 -> decodeByteString storage offset byte 28
  SimpleType TypeBytes29 -> decodeByteString storage offset byte 29
  SimpleType TypeBytes30 -> decodeByteString storage offset byte 30
  SimpleType TypeBytes31 -> decodeByteString storage offset byte 31
  SimpleType TypeBytes32 -> decodeByteString storage offset byte 32











  SimpleType TypeBytes | storage offset `testBit` 0 -> --large string, 32+ bytes
    let
      len = storage offset `div` 2
      startingKey=byteStringToWord256 $ ByteArray.convert $ unKeccak256 $ keccak256 $ word256ToByteString offset
    in SimpleValue $ ValueBytes $ ByteString.pack $ take (fromIntegral len) $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey+)) [0..]

  SimpleType TypeBytes -> --small string, less than 32 bytes
    let
      len = storage offset .&. 0xfe `div` 2
    in
      SimpleValue $ ValueBytes $ ByteString.take (fromIntegral len) $ word256ToByteString $ storage offset

  SimpleType TypeString ->
    let
      SimpleValue (ValueBytes bytes) = decodeValue' typeDefs' storage position $ SimpleType TypeBytes
    in
      SimpleValue $ ValueString $ Text.decodeUtf8 bytes

  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArrayFixed size ty -> ValueArrayFixed size theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      theList = map (flip (decodeValue' typeDefs' storage) ty . (`Storage.addBytes` fromIntegral (32*offset)) . arrayPosition elementSize) [0..fromIntegral size - 1]

  TypeArrayDynamic ty -> ValueArrayDynamic theList
    where
      theList = map (flip (decodeValue' typeDefs' storage) ty . Storage.positionAt . (startingKey+)) [0..storage offset-1]
      startingKey=byteStringToWord256 $ ByteArray.convert $ unKeccak256 $ keccak256 $ word256ToByteString offset

  TypeMapping tyk tyv -> SimpleValue $ ValueString $ T.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
     Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
     Just enumset ->
       let
         len = fromIntegral $ Bimap.size enumset `shiftR` 8 + 1
         val = fromIntegral $ (.&. ((1 `shiftL` 8*len) - 1)) $ (`shiftR` (byte*8)) $ storage offset
       in
        case Bimap.lookup val enumset of
         Nothing -> error "bad enum value"
         Just x -> ValueEnum name x

  TypeStruct name ->
    case Map.lookup name structDefs of
     Nothing -> error ""
     Just theStruct -> ValueStruct $ decodeValues typeDefs' theStruct storage (Storage.alignedByte position)



  
--  x -> error $ "Missing case in decodeValue': " ++ show x




decodeByteString::Storage->Word256->Int->Int->Value
decodeByteString storage offset byte size = SimpleValue $ ValueBytes $ ByteString.take size $ ByteString.drop (32 - byte - size) $ word256ToByteString $ storage offset

decodeInt::Num t=>
           Storage->Word256->Int->(t->SimpleValue)->Value
decodeInt storage offset byte constructor =
  SimpleValue $ constructor $ fromIntegral $ (`shiftR` (byte*8)) $ storage offset



arrayPosition::Int->Int->Storage.Position
arrayPosition elementSize x =
  let
    itemsPerWord = 32 `quot` elementSize
    (o, b) = x `quotRem` itemsPerWord
  in
   Storage.Position{offset=fromIntegral o, byte=b}
