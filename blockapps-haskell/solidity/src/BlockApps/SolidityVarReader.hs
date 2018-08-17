{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}

module BlockApps.SolidityVarReader (
  decodeStorageKey,
  decodeValue,
  decodeValues,
  decodeValuesFromList,
  decodeMapValue,
  encodeValues,
  encodeValue,
  word256ToByteString,
  byteStringToWord256,
  valueToSolidityValue
  ) where

import           Control.Monad.Except
import qualified Data.Bimap                       as Bimap
import           Data.Binary.Get                  (runGet, getWord64be)
import           Data.Bits
import qualified Data.ByteArray                   as ByteArray
import           Data.ByteString                  (ByteString)
import qualified Data.ByteString                  as ByteString
import qualified Data.ByteString.Base16           as B16
import qualified Data.ByteString.Builder          as BB
import qualified Data.ByteString.Char8            as BC
import qualified Data.ByteString.Lazy             as BL
import           Data.LargeWord
import           Data.List
import           Data.Map.Strict                  (Map)
import qualified Data.Map.Strict                  as Map
import qualified Data.Map.Ordered                 as OMap
import           Data.Maybe                       (maybe)
import           Data.Text                        (Text)
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text
import           Data.Word
import           Text.Printf
import           Text.Read

import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs
import           BlockApps.Solidity.Value
import           BlockApps.Storage                (Storage)
import qualified BlockApps.Storage                as Storage

valueToSolidityValue::Value->SolidityValue
valueToSolidityValue (SimpleValue (ValueBool x)) = SolidityBool x

valueToSolidityValue (SimpleValue (ValueInt8 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt16 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt24 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt32 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt40 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt48 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt56 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt64 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt72 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt80 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt88 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt96 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt104 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt112 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt120 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt128 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt136 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt144 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt152 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt160 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt168 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt176 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt184 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt192 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueInt200 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt208 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt216 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt224 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt232 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt240 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt248 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt256 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueInt v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt8 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt16 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt24 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt32 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt40 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt48 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt56 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt64 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt72 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt80 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt88 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt96 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt104 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt112 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt120 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt128 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt136 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt144 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt152 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt160 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt168 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt176 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt184 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt192 v)) = SolidityValueAsString $ Text.pack $ show v

valueToSolidityValue (SimpleValue (ValueUInt200 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt208 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt216 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt224 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt232 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt240 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt248 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt256 v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueUInt v)) = SolidityValueAsString $ Text.pack $ show v




valueToSolidityValue (SimpleValue (ValueString s)) = SolidityValueAsString s
valueToSolidityValue (SimpleValue (ValueAddress (Address addr))) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueContract (Address addr)) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueArrayFixed _ values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (ValueArrayDynamic values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (SimpleValue (ValueBytes bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes1 byte)) = SolidityValueAsString $ Text.pack $ BC.unpack $ ByteString.pack [byte]
valueToSolidityValue (SimpleValue (ValueBytes2 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes3 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes4 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes5 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes6 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes7 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes8 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes9 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes10 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes11 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes12 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes13 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes14 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes15 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes16 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes17 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes18 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes19 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes20 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes21 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes22 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes23 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes24 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes25 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes26 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes27 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes28 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes29 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes30 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes31 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes32 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (ValueEnum _ _ index)              = SolidityValueAsString $ Text.pack $ show index -- SolidityValueAsString $ name `Text.append` "." `Text.append` value
valueToSolidityValue (ValueStruct namedItems) =
  SolidityObject $ map (fmap valueToSolidityValue) namedItems
valueToSolidityValue (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString $ Text.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"


word256ToByteString::Word256->ByteString
word256ToByteString (LargeKey w1 (LargeKey w2 (LargeKey w3 w4))) =
  ByteString.concat $ map (BL.toStrict . BB.toLazyByteString . BB.word64BE) [w4,w3,w2,w1]

byteStringToWord256 :: ByteString->Word256
byteStringToWord256 bs =
  let
    [w4,w3,w2,w1] = flip runGet (BL.fromStrict bs) $ do
      w_4 <- getWord64be
      w_3 <- getWord64be
      w_2 <- getWord64be
      w_1 <- getWord64be
      return [w_4,w_3,w_2,w_1]
  in LargeKey w1 (LargeKey w2 (LargeKey w3 w4))

getArrayStartingKey :: Word256 -> Word256
getArrayStartingKey = byteStringToWord256 . ByteArray.convert . digestKeccak256 . keccak256 . word256ToByteString

decodeStorageKeySimple :: SimpleType -> Word256 -> [(Word256, Word256)]
decodeStorageKeySimple TypeString o = [(o, 1 `shiftL` 32)] -- TODO: Create real string instance
decodeStorageKeySimple TypeBytes  o = [(o, 1 `shiftL` 32)] -- TODO: Create real bytes instance
decodeStorageKeySimple _          o = [(o, 1)] -- All other simple types fit into one storage cell

decodeStorageKey
  :: TypeDefs
  -> Struct
  -> [Text]
  -> Word256
  -> Maybe Int
  -> Maybe Int
  -> Bool
  -> [(Word256, Word256)]
decodeStorageKey _ _ [] _ _ _ _ = []
decodeStorageKey typeDefs'@TypeDefs{..} struct' (varName:_) _ mOffset mCount len =
  case OMap.lookup varName (fields struct') of
    Nothing -> []
    Just (Left _, _) -> []
    Just (Right Storage.Position{..}, theType) ->
      case theType of
        SimpleType ty -> decodeStorageKeySimple ty offset
        TypeArrayDynamic ty -> do
          if len
            then [(offset, 1)]
            else
              let startingKey = getArrayStartingKey offset
                  ofs = fromIntegral $ maybe 0 id mOffset
                  cnt = fromIntegral $ maybe 100 id mCount -- Default to page size of 100 entries
                  (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
              in [(offset, 1), (startingKey + ofs, elementSize * cnt)]
        TypeArrayFixed n ty -> do
          if len
            then []
            else
              let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
              in [(offset, elementSize * fromIntegral n)]
        TypeMapping _ _ -> undefined -- TODO: The only way to get the offset of a mapping is by supplying the key
        TypeFunction name _ _ -> error $ "Cannot retrieve "
                                       ++ show (ByteString.unpack name)
                                       ++ ": Functions are not kept in storage"
        TypeStruct name ->
          case Map.lookup name structDefs of
            Nothing -> error ""
            Just theStruct -> [(offset, size theStruct)] -- TODO: support struct field accessors, e.g. vehicle.vin
              -- case vs of
              -- [] -> [(offset, size theStruct)]
              -- vs' -> decodeStorageKey typeDefs' struct' vs' (offset + offset') mOffset mCount len
        TypeEnum _ -> [(offset, 1)]
        TypeContract _ -> [(offset, 1)]

decodeValues
  :: TypeDefs
  -> Struct
  -> Storage
  -> Word256
  -> [(Text, Value)]
decodeValues typeDefs' struct'@Struct{..} storage offset =
  decodeValuesFromList typeDefs' struct' storage offset Nothing Nothing False (map fst $ OMap.assocs fields)

decodeValuesFromList
  :: TypeDefs
  -> Struct
  -> Storage
  -> Word256
  -> Maybe Int
  -> Maybe Int
  -> Bool
  -> [Text]
  -> [(Text, Value)]
decodeValuesFromList typeDefs' struct'@Struct{..} storage offset ofs cnt len varNames =
  flip zipMaybe varNames (decodeValue typeDefs' storage offset struct' ofs cnt len)
  where
    zipMaybe :: (a -> Maybe b) -> [a] -> [(a,b)]
    zipMaybe _ [] = []
    zipMaybe f (a:as) = case (f a) of
                          Nothing -> zipMaybe f as
                          Just b -> (a,b) : (zipMaybe f as)

decodeValue
  :: TypeDefs
  -> Storage
  -> Word256
  -> Struct
  -> Maybe Int
  -> Maybe Int
  -> Bool
  -> Text
  -> Maybe Value
decodeValue typeDefs' storage offset Struct{..} ofs cnt len varName = case OMap.lookup varName fields of
   Nothing -> Nothing
   Just (Right position, theType) ->
     Just $ decodeValue' typeDefs' storage ofs cnt len (position `Storage.addOffset` fromIntegral offset) theType
   Just (Left text, theType) -> case (textToValue (Just typeDefs') text theType) of
      Left err -> error $ "decodeValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
      Right val -> Just val


decodeValue'
  :: TypeDefs
  -> Storage
  -> Maybe Int
  -> Maybe Int
  -> Bool
  -> Storage.Position
  -> Type
  -> Value
decodeValue' typeDefs'@TypeDefs{..} storage ofs cnt len position@Storage.Position{..} = \case
  SimpleType TypeBool ->
    let
      SimpleValue (ValueInt8 word8) = decodeValue' typeDefs' storage ofs cnt len position (SimpleType TypeInt8)
    in
     SimpleValue $ ValueBool $ word8 /= 0

  SimpleType TypeUInt -> decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeUInt256


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




  SimpleType TypeInt -> decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeInt256

  SimpleType TypeAddress ->
    let
      SimpleValue (ValueUInt160 addr) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeUInt160
    in
      SimpleValue . ValueAddress . Address $ fromIntegral addr
  TypeContract _ ->
    let
      SimpleValue (ValueAddress addr) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeAddress
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
      len' = lastWord64 (storage offset) `div` 2
      lastWord64::Word256->Word64
      lastWord64 (LargeKey x _) = x
      startingKey=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ word256ToByteString offset
    in SimpleValue $ ValueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey+)) [0..]

  SimpleType TypeBytes -> --small string, less than 32 bytes
    let
      len' = lastWord64 (storage offset) .&. 0xfe `div` 2
      lastWord64::Word256->Word64
      lastWord64 (LargeKey x _) = x
    in
      SimpleValue $ ValueBytes $ ByteString.take (fromIntegral len') $ word256ToByteString $ storage offset

  SimpleType TypeString ->
    let
      SimpleValue (ValueBytes bytes) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeBytes
    in
      SimpleValue $ ValueString $ Text.decodeUtf8 bytes

  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArrayFixed size ty -> if len
    then SimpleValue $ ValueUInt $ fromIntegral size
    else ValueArrayFixed size theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      ofs' :: Word256 = fromIntegral . toInteger $ maybe 0 id ofs
      cnt' :: Word256 = max 0 . min ((fromIntegral size) - ofs') . fromIntegral $ maybe 100 id cnt
      theList = map (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` offset) . arrayPosition elementSize) [ofs' .. (ofs' + cnt' - 1)]

  TypeArrayDynamic ty -> if len
    then SimpleValue $ ValueUInt (storage offset)
    else ValueArrayDynamic theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      --The double fromIntegral in the definition of theList is terrible but necessary, since the range only works with Int, and we eventually need a range of Word256s
      ofs' = maybe 0 id ofs
      cnt' = max 0 . min ((fromIntegral $ storage offset) - ofs') $ maybe 100 id cnt
      theList = (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` startingKey) . arrayPosition elementSize . fromIntegral) <$> [ofs'..(ofs' + cnt' - 1)]
      startingKey=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ word256ToByteString offset

  TypeMapping tyk tyv -> SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
     Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
     Just enumset ->
       let
         len' = fromIntegral $ Bimap.size enumset `shiftR` 8 + 1
         val = fromIntegral $ (.&. ((1 `shiftL` 8*len') - 1)) $ (`shiftR` (byte*8)) $ storage offset
       in
        case Bimap.lookup val enumset of
         Nothing -> error "bad enum value"
         Just x  -> ValueEnum name x (fromIntegral val)

  TypeStruct name ->
    case Map.lookup name structDefs of
     Nothing -> error ""
     Just theStruct -> ValueStruct $ decodeValues typeDefs' theStruct storage (Storage.alignedByte position)




--  x -> error $ "Missing case in decodeValue': " ++ show x


decodeMapValue
  :: TypeDefs
  -> Struct
  -> Storage
  -> Text
  -> Text
  -> Either String Value
--decodeMapValue typeDefs' Struct{..} storage mappingName keyName =
--  undefined typeDefs' storage mappingName keyName
decodeMapValue typeDefs' Struct{..} storage mappingName keyName = do
  (eTxtPos, maybeMappingType) <- OMap.lookup mappingName fields `orFail` ("There is no mapping in the contract named '" ++ Text.unpack mappingName ++ "'")

  position <-
    case eTxtPos of
      Right pos -> return pos
      Left txt -> throwError $ Text.unpack mappingName ++ " is a constant with value \"" ++ show txt ++ "\", which is not allowed."

  (fromType, toType) <-
    case maybeMappingType of
     TypeMapping fromType toType -> return (fromType, toType)
     x -> throwError $ Text.unpack mappingName ++ " is not a map, it is of type " ++ show x

  -- 78338746147236970124700731725183845421594913511827187288591969170390706184117:1

  keyByteString <-
    case fromType of
     TypeInt256 -> do
       keyAsInteger <- readMaybe (Text.unpack keyName) `orFail` ("Can not parse key as an Integer: " ++ Text.unpack keyName)
       return $ word256ToByteString $ fromInteger keyAsInteger
     x -> throwError $ "Sorry, This route doesn't support maps with keys of type: " ++ show x

  let valPositionInt=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ keyByteString `ByteString.append` word256ToByteString (Storage.offset position)
      getValPosition::SimpleType->Text->Storage.Position->Storage.Position
      getValPosition _ _ _ = Storage.positionAt valPositionInt  --TODO fill in this dummy stub
      valPosition = getValPosition fromType keyName position

  let val = decodeValue' typeDefs' storage Nothing Nothing False valPosition toType

  return val

encodeValues
  :: TypeDefs
  -> Struct
  -> Word256
  -> [(Text,Text)]
  -> Map Word256 Word256
encodeValues typeDefs' struct'@Struct{..} offset vars =
  zipMapMaybe (uncurry $ encodeValue typeDefs' offset struct') vars Map.empty
  where
    zipMapMaybe _ [] m = m
    zipMapMaybe f (a:as) m = case (f a) of
      Nothing -> zipMapMaybe f as m
      Just b -> zipMapMaybe f as $ foldl' (apply (.|.)) m b
    apply f m (a,b) = case Map.lookup a m of
      Nothing -> Map.insert a b m
      Just c -> Map.insert a (f c b) m

encodeValue
  :: TypeDefs
  -> Word256
  -> Struct
  -> Text
  -> Text
  -> Maybe [(Word256,Word256)]
encodeValue typeDefs' offset Struct{..} varName val = case OMap.lookup varName fields of
   Nothing -> Nothing
   Just (Right position, theType) -> case (textToValue (Just typeDefs') val theType) of
     Left err -> error $ "encodeValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
     Right v -> Just $ encodeValue' typeDefs' (position `Storage.addOffset` fromIntegral offset) v
   Just (Left _, _) -> error "decodeValue: cannot convert constant variable to storage"

encodeValue'
  :: TypeDefs
  -> Storage.Position
  -> Value
  -> [(Word256,Word256)]
encodeValue' typeDefs'@TypeDefs{..} position@Storage.Position{..} = \case
  SimpleValue (ValueBool v) -> encodeInt offset byte ((if v then 1 else 0) :: Word8)
  SimpleValue (ValueUInt v) -> encodeValue' typeDefs' position . SimpleValue $ ValueUInt256 v

  SimpleValue (ValueInt8 v) -> encodeInt offset byte v
  SimpleValue (ValueInt16 v) -> encodeInt offset byte v
  SimpleValue (ValueInt24 v) -> encodeInt offset byte v
  SimpleValue (ValueInt32 v) -> encodeInt offset byte v
  SimpleValue (ValueInt40 v) -> encodeInt offset byte v
  SimpleValue (ValueInt48 v) -> encodeInt offset byte v
  SimpleValue (ValueInt56 v) -> encodeInt offset byte v
  SimpleValue (ValueInt64 v) -> encodeInt offset byte v

  SimpleValue (ValueInt72 v) -> encodeInt offset byte v
  SimpleValue (ValueInt80 v) -> encodeInt offset byte v
  SimpleValue (ValueInt88 v) -> encodeInt offset byte v
  SimpleValue (ValueInt96 v) -> encodeInt offset byte v
  SimpleValue (ValueInt104 v) -> encodeInt offset byte v
  SimpleValue (ValueInt112 v) -> encodeInt offset byte v
  SimpleValue (ValueInt120 v) -> encodeInt offset byte v
  SimpleValue (ValueInt128 v) -> encodeInt offset byte v

  SimpleValue (ValueInt136 v) -> encodeInt offset byte v
  SimpleValue (ValueInt144 v) -> encodeInt offset byte v
  SimpleValue (ValueInt152 v) -> encodeInt offset byte v
  SimpleValue (ValueInt160 v) -> encodeInt offset byte v
  SimpleValue (ValueInt168 v) -> encodeInt offset byte v
  SimpleValue (ValueInt176 v) -> encodeInt offset byte v
  SimpleValue (ValueInt184 v) -> encodeInt offset byte v
  SimpleValue (ValueInt192 v) -> encodeInt offset byte v

  SimpleValue (ValueInt200 v) -> encodeInt offset byte v
  SimpleValue (ValueInt208 v) -> encodeInt offset byte v
  SimpleValue (ValueInt216 v) -> encodeInt offset byte v
  SimpleValue (ValueInt224 v) -> encodeInt offset byte v
  SimpleValue (ValueInt232 v) -> encodeInt offset byte v
  SimpleValue (ValueInt240 v) -> encodeInt offset byte v
  SimpleValue (ValueInt248 v) -> encodeInt offset byte v
  SimpleValue (ValueInt256 v) -> encodeInt offset byte v

  SimpleValue (ValueUInt8 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt16 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt24 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt32 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt40 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt48 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt56 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt64 v) -> encodeInt offset byte v

  SimpleValue (ValueUInt72 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt80 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt88 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt96 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt104 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt112 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt120 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt128 v) -> encodeInt offset byte v

  SimpleValue (ValueUInt136 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt144 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt152 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt160 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt168 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt176 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt184 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt192 v) -> encodeInt offset byte v

  SimpleValue (ValueUInt200 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt208 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt216 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt224 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt232 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt240 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt248 v) -> encodeInt offset byte v
  SimpleValue (ValueUInt256 v) -> encodeInt offset byte v

  SimpleValue (ValueInt v) -> encodeValue' typeDefs' position . SimpleValue $ ValueInt256 v

  SimpleValue (ValueAddress (Address a)) -> encodeValue' typeDefs' position . SimpleValue $ ValueUInt160 a
  ValueContract (Address a) -> encodeValue' typeDefs' position . SimpleValue $ ValueUInt160 a

{-
  ValueFixed (Just (n,m)) ->
    let
      ValueInt x = EncodeValue' storage offset (ValueInt (Just 256))
    in
      ValueFixed $ fromIntegral x / 2 ** fromIntegral n
  ValueFixed Nothing -> EncodeValue' storage offset (ValueFixed (Just (128,128)))
-}
  SimpleValue (ValueBytes1 v) -> [(offset, fromIntegral v)]
  SimpleValue (ValueBytes2 v) -> encodeByteString offset byte 2 v
  SimpleValue (ValueBytes3 v) -> encodeByteString offset byte 3 v
  SimpleValue (ValueBytes4 v) -> encodeByteString offset byte 4 v
  SimpleValue (ValueBytes5 v) -> encodeByteString offset byte 5 v
  SimpleValue (ValueBytes6 v) -> encodeByteString offset byte 6 v
  SimpleValue (ValueBytes7 v) -> encodeByteString offset byte 7 v
  SimpleValue (ValueBytes8 v) -> encodeByteString offset byte 8 v
  SimpleValue (ValueBytes9 v) -> encodeByteString offset byte 9 v
  SimpleValue (ValueBytes10 v) -> encodeByteString offset byte 10 v
  SimpleValue (ValueBytes11 v) -> encodeByteString offset byte 11 v
  SimpleValue (ValueBytes12 v) -> encodeByteString offset byte 12 v
  SimpleValue (ValueBytes13 v) -> encodeByteString offset byte 13 v
  SimpleValue (ValueBytes14 v) -> encodeByteString offset byte 14 v
  SimpleValue (ValueBytes15 v) -> encodeByteString offset byte 15 v
  SimpleValue (ValueBytes16 v) -> encodeByteString offset byte 16 v
  SimpleValue (ValueBytes17 v) -> encodeByteString offset byte 17 v
  SimpleValue (ValueBytes18 v) -> encodeByteString offset byte 18 v
  SimpleValue (ValueBytes19 v) -> encodeByteString offset byte 19 v
  SimpleValue (ValueBytes20 v) -> encodeByteString offset byte 20 v
  SimpleValue (ValueBytes21 v) -> encodeByteString offset byte 21 v
  SimpleValue (ValueBytes22 v) -> encodeByteString offset byte 22 v
  SimpleValue (ValueBytes23 v) -> encodeByteString offset byte 23 v
  SimpleValue (ValueBytes24 v) -> encodeByteString offset byte 24 v
  SimpleValue (ValueBytes25 v) -> encodeByteString offset byte 25 v
  SimpleValue (ValueBytes26 v) -> encodeByteString offset byte 26 v
  SimpleValue (ValueBytes27 v) -> encodeByteString offset byte 27 v
  SimpleValue (ValueBytes28 v) -> encodeByteString offset byte 28 v
  SimpleValue (ValueBytes29 v) -> encodeByteString offset byte 29 v
  SimpleValue (ValueBytes30 v) -> encodeByteString offset byte 30 v
  SimpleValue (ValueBytes31 v) -> encodeByteString offset byte 31 v
  SimpleValue (ValueBytes32 v) -> encodeByteString offset byte 32 v

  -- SimpleValue (ValueBytes _) -> error "Large strings not supported yet" --large string, 32+ bytes
   --  let
   --    len' = storage offset `div` 2
   --    startingKey=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ word256ToByteString offset
   --  in SimpleValue $ ValueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey+)) [0..]

  SimpleValue (ValueBytes v) -> [(offset, byteStringToWord256 v)]

  SimpleValue (ValueString v) -> encodeValue' typeDefs' position . SimpleValue . ValueBytes $ Text.encodeUtf8 v

  ValueFunction _ _ _ -> error "Cannot convert function to storage"

  ValueArrayFixed _ _ -> error "Arrays not supported yet" --if len
    -- then SimpleValue $ ValueUInt $ fromIntegral size
    -- else ValueArrayFixed size theList
    -- where
    --   (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
    --   ofs' :: Word256 = fromIntegral . toInteger $ maybe 0 id ofs
    --   cnt' :: Word256 = max 0 . min ((fromIntegral size) - ofs') . fromIntegral $ maybe 100 id cnt
    --   theList = map (flip (encodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` offset) . arrayPosition elementSize) [ofs' .. (ofs' + cnt' - 1)]

  ValueArrayDynamic _ -> error "Arrays not supported yet" --if len
    -- then SimpleValue $ ValueUInt (storage offset)
    -- else ValueArrayDynamic theList
    -- where
    --   (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
    --   --The double fromIntegral in the definition of theList is terrible but necessary, since the range only works with Int, and we eventually need a range of Word256s
    --   ofs' = maybe 0 id ofs
    --   cnt' = max 0 . min ((fromIntegral $ storage offset) - ofs') $ maybe 100 id cnt
    --   theList = (flip (EncodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` startingKey) . arrayPosition elementSize . fromIntegral) <$> [ofs'..(ofs' + cnt' - 1)]
    --   startingKey=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ word256ToByteString offset

  -- ValueMapping _ -> error "Mappings not supported yet" --SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleValue tyk ++ " => " ++ formatValue tyv ++ ")"

  ValueEnum _ _ index -> encodeInt offset byte index

  ValueStruct _ -> error "Structs not supported yet"
    -- case Map.lookup name structDefs of
    --  Nothing -> error ""
    --  Just theStruct -> ValueStruct $ EncodeValues typeDefs' theStruct storage (Storage.alignedByte position)




orFail::Maybe a->String->Either String a
orFail Nothing msg = Left msg
orFail (Just x) _ = Right x


encodeByteString :: Word256 -> Int -> Int -> ByteString -> [(Word256,Word256)]
encodeByteString offset byte size bs =
  let bss = ByteString.concat [ByteString.replicate (32 - byte - size) 0, bs, ByteString.replicate byte 0]
   in [(offset, byteStringToWord256 bss)]

decodeByteString::Storage->Word256->Int->Int->Value
decodeByteString storage offset byte size = SimpleValue $ ValueBytes $ B16.encode $ ByteString.take size $ ByteString.drop (32 - byte - size) $ word256ToByteString $ storage offset

encodeInt :: (Num t, Integral t, Bits t) => Word256 -> Int -> t -> [(Word256,Word256)]
encodeInt offset byte val = return $ fmap (fromIntegral . (`shiftL` (byte*8))) (offset,val)

decodeInt::Num t=>
           Storage->Word256->Int->(t->SimpleValue)->Value
decodeInt storage offset byte constructor =
  SimpleValue $ constructor $ fromIntegral $ (`shiftR` (byte*8)) $ storage offset



arrayPosition::Word256->Word256->Storage.Position
arrayPosition elementSize x | elementSize <= 32 =
  let
    itemsPerWord = 32 `quot` elementSize
    (o, b) = x `quotRem` itemsPerWord
  in
   Storage.Position{offset=o, byte=fromIntegral $ elementSize * b}

arrayPosition elementSize x = 
  let
    wordsPerItem = elementSize `quot` 32
    o = x * wordsPerItem
  in
    Storage.Position{offset=o, byte=0}
