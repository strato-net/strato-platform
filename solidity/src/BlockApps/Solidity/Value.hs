{-# LANGUAGE
    LambdaCase
  , OverloadedStrings
#-}

module BlockApps.Solidity.Value where

import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Base16 as Base16
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Text.Read

import BlockApps.Ethereum
import BlockApps.Solidity.Int
import BlockApps.Solidity.Type

data Value
  = SimpleValue SimpleValue
  | ValueArrayDynamic [Value]
  | ValueArrayFixed Word [Value]
  | ValueContract Address
  | ValueEnum Text Text
  | ValueFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  -- | ValueMapping (Map SimpleValue Value)
  | ValueStruct [(Text, Value)]
  deriving (Show)

data SimpleValue
  = ValueBool Bool
  | ValueUInt8 Word8
  | ValueUInt16 Word16
  | ValueUInt24 Word24
  | ValueUInt32 Word32
  | ValueUInt40 Word40
  | ValueUInt48 Word48
  | ValueUInt56 Word56
  | ValueUInt64 Word64
  | ValueUInt72 Word72
  | ValueUInt80 Word80
  | ValueUInt88 Word88
  | ValueUInt96 Word96
  | ValueUInt104 Word104
  | ValueUInt112 Word112
  | ValueUInt120 Word120
  | ValueUInt128 Word128
  | ValueUInt136 Word136
  | ValueUInt144 Word144
  | ValueUInt152 Word152
  | ValueUInt160 Word160
  | ValueUInt168 Word168
  | ValueUInt176 Word176
  | ValueUInt184 Word184
  | ValueUInt192 Word192
  | ValueUInt200 Word200
  | ValueUInt208 Word208
  | ValueUInt216 Word216
  | ValueUInt224 Word224
  | ValueUInt232 Word232
  | ValueUInt240 Word240
  | ValueUInt248 Word248
  | ValueUInt256 Word256
  | ValueUInt Word256
  | ValueInt8 Int8
  | ValueInt16 Int16
  | ValueInt24 Int24
  | ValueInt32 Int32
  | ValueInt40 Int40
  | ValueInt48 Int48
  | ValueInt56 Int56
  | ValueInt64 Int64
  | ValueInt72 Int72
  | ValueInt80 Int80
  | ValueInt88 Int88
  | ValueInt96 Int96
  | ValueInt104 Int104
  | ValueInt112 Int112
  | ValueInt120 Int120
  | ValueInt128 Int128
  | ValueInt136 Int136
  | ValueInt144 Int144
  | ValueInt152 Int152
  | ValueInt160 Int160
  | ValueInt168 Int168
  | ValueInt176 Int176
  | ValueInt184 Int184
  | ValueInt192 Int192
  | ValueInt200 Int200
  | ValueInt208 Int208
  | ValueInt216 Int216
  | ValueInt224 Int224
  | ValueInt232 Int232
  | ValueInt240 Int240
  | ValueInt248 Int248
  | ValueInt256 Int256
  | ValueInt Int256
  | ValueAddress Address
  -- | ValueFixed
  -- | ValueUFixed
  | ValueBytes1 Word8
  | ValueBytes2 ByteString
  | ValueBytes3 ByteString
  | ValueBytes4 ByteString
  | ValueBytes5 ByteString
  | ValueBytes6 ByteString
  | ValueBytes7 ByteString
  | ValueBytes8 ByteString
  | ValueBytes9 ByteString
  | ValueBytes10 ByteString
  | ValueBytes11 ByteString
  | ValueBytes12 ByteString
  | ValueBytes13 ByteString
  | ValueBytes14 ByteString
  | ValueBytes15 ByteString
  | ValueBytes16 ByteString
  | ValueBytes17 ByteString
  | ValueBytes18 ByteString
  | ValueBytes19 ByteString
  | ValueBytes20 ByteString
  | ValueBytes21 ByteString
  | ValueBytes22 ByteString
  | ValueBytes23 ByteString
  | ValueBytes24 ByteString
  | ValueBytes25 ByteString
  | ValueBytes26 ByteString
  | ValueBytes27 ByteString
  | ValueBytes28 ByteString
  | ValueBytes29 ByteString
  | ValueBytes30 ByteString
  | ValueBytes31 ByteString
  | ValueBytes32 ByteString
  | ValueBytes ByteString
  | ValueString Text
  -- | ValueContract
  deriving (Show)


bytesToValue :: ByteString -> Type -> Value
bytesToValue = undefined

valueToText :: Value -> Text
valueToText = undefined

textToValue :: Text -> Type -> Maybe Value
textToValue str = \case
  SimpleType ty -> SimpleValue <$> textToSimpleValue str ty
  TypeArrayDynamic ty -> ValueArrayDynamic <$>
    traverse (flip textToValue ty)
      (Text.split (== ',') (Text.dropAround (\ c -> c == '[' || c == ']') str))
  TypeArrayFixed len ty -> ValueArrayFixed len <$>
    traverse (flip textToValue ty)
      (Text.split (== ',') (Text.dropAround (\ c -> c == '[' || c == ']') str))
  TypeMapping _ _ -> Nothing -- TODO: Fixme
  TypeFunction _ _ _ -> Nothing -- TODO: Fixme
  TypeContract _ -> ValueContract <$> stringAddress (Text.unpack str)
  TypeEnum _ -> Nothing -- TODO: Fixme
  TypeStruct _ -> Nothing  -- TODO: Fixme

textToSimpleValue :: Text -> SimpleType -> Maybe SimpleValue
textToSimpleValue str = \case
  TypeBool -> case Text.toLower str of
    "true" -> Just $ ValueBool True
    "false" -> Just $ ValueBool False
    _ -> Nothing
  TypeUInt8 -> ValueUInt8 <$> readNum
  TypeUInt16 -> ValueUInt16 <$> readNum
  TypeUInt24 -> ValueUInt24 <$> readNum
  TypeUInt32 -> ValueUInt32 <$> readNum
  TypeUInt40 -> ValueUInt40 <$> readNum
  TypeUInt48 -> ValueUInt48 <$> readNum
  TypeUInt56 -> ValueUInt56 <$> readNum
  TypeUInt64 -> ValueUInt64 <$> readNum
  TypeUInt72 -> ValueUInt72 <$> readNum
  TypeUInt80 -> ValueUInt80 <$> readNum
  TypeUInt88 -> ValueUInt88 <$> readNum
  TypeUInt96 -> ValueUInt96 <$> readNum
  TypeUInt104 -> ValueUInt104 <$> readNum
  TypeUInt112 -> ValueUInt112 <$> readNum
  TypeUInt120 -> ValueUInt120 <$> readNum
  TypeUInt128 -> ValueUInt128 <$> readNum
  TypeUInt136 -> ValueUInt136 <$> readNum
  TypeUInt144 -> ValueUInt144 <$> readNum
  TypeUInt152 -> ValueUInt152 <$> readNum
  TypeUInt160 -> ValueUInt160 <$> readNum
  TypeUInt168 -> ValueUInt168 <$> readNum
  TypeUInt176 -> ValueUInt176 <$> readNum
  TypeUInt184 -> ValueUInt184 <$> readNum
  TypeUInt192 -> ValueUInt192 <$> readNum
  TypeUInt200 -> ValueUInt200 <$> readNum
  TypeUInt208 -> ValueUInt208 <$> readNum
  TypeUInt216 -> ValueUInt216 <$> readNum
  TypeUInt224 -> ValueUInt224 <$> readNum
  TypeUInt232 -> ValueUInt232 <$> readNum
  TypeUInt240 -> ValueUInt240 <$> readNum
  TypeUInt248 -> ValueUInt248 <$> readNum
  TypeUInt256 -> ValueUInt256 <$> readNum
  TypeUInt -> ValueUInt <$> readNum
  TypeInt8 -> ValueInt8 <$> readNum
  TypeInt16 -> ValueInt16 <$> readNum
  TypeInt24 -> ValueInt24 <$> readNum
  TypeInt32 -> ValueInt32 <$> readNum
  TypeInt40 -> ValueInt40 <$> readNum
  TypeInt48 -> ValueInt48 <$> readNum
  TypeInt56 -> ValueInt56 <$> readNum
  TypeInt64 -> ValueInt64 <$> readNum
  TypeInt72 -> ValueInt72 <$> readNum
  TypeInt80 -> ValueInt80 <$> readNum
  TypeInt88 -> ValueInt88 <$> readNum
  TypeInt96 -> ValueInt96 <$> readNum
  TypeInt104 -> ValueInt104 <$> readNum
  TypeInt112 -> ValueInt112 <$> readNum
  TypeInt120 -> ValueInt120 <$> readNum
  TypeInt128 -> ValueInt128 <$> readNum
  TypeInt136 -> ValueInt136 <$> readNum
  TypeInt144 -> ValueInt144 <$> readNum
  TypeInt152 -> ValueInt152 <$> readNum
  TypeInt160 -> ValueInt160 <$> readNum
  TypeInt168 -> ValueInt168 <$> readNum
  TypeInt176 -> ValueInt176 <$> readNum
  TypeInt184 -> ValueInt184 <$> readNum
  TypeInt192 -> ValueInt192 <$> readNum
  TypeInt200 -> ValueInt200 <$> readNum
  TypeInt208 -> ValueInt208 <$> readNum
  TypeInt216 -> ValueInt216 <$> readNum
  TypeInt224 -> ValueInt224 <$> readNum
  TypeInt232 -> ValueInt232 <$> readNum
  TypeInt240 -> ValueInt240 <$> readNum
  TypeInt248 -> ValueInt248 <$> readNum
  TypeInt256 -> ValueInt256 <$> readNum
  TypeInt -> ValueInt <$> readNum
  TypeAddress -> ValueAddress <$> stringAddress (Text.unpack str)
  TypeBytes1 -> ValueBytes1 . ByteString.head <$> readBytes 1
  TypeBytes2 -> ValueBytes <$> readBytes 2
  TypeBytes3 -> ValueBytes3 <$> readBytes 3
  TypeBytes4 -> ValueBytes4 <$> readBytes 4
  TypeBytes5 -> ValueBytes5 <$> readBytes 5
  TypeBytes6 -> ValueBytes6 <$> readBytes 6
  TypeBytes7 -> ValueBytes7 <$> readBytes 7
  TypeBytes8 -> ValueBytes8 <$> readBytes 8
  TypeBytes9 -> ValueBytes9 <$> readBytes 9
  TypeBytes10 -> ValueBytes10 <$> readBytes 10
  TypeBytes11 -> ValueBytes11 <$> readBytes 11
  TypeBytes12 -> ValueBytes12 <$> readBytes 12
  TypeBytes13 -> ValueBytes13 <$> readBytes 13
  TypeBytes14 -> ValueBytes14 <$> readBytes 14
  TypeBytes15 -> ValueBytes15 <$> readBytes 15
  TypeBytes16 -> ValueBytes16 <$> readBytes 16
  TypeBytes17 -> ValueBytes17 <$> readBytes 17
  TypeBytes18 -> ValueBytes18 <$> readBytes 18
  TypeBytes19 -> ValueBytes19 <$> readBytes 19
  TypeBytes20 -> ValueBytes20 <$> readBytes 20
  TypeBytes21 -> ValueBytes21 <$> readBytes 21
  TypeBytes22 -> ValueBytes22 <$> readBytes 22
  TypeBytes23 -> ValueBytes23 <$> readBytes 23
  TypeBytes24 -> ValueBytes24 <$> readBytes 24
  TypeBytes25 -> ValueBytes25 <$> readBytes 25
  TypeBytes26 -> ValueBytes26 <$> readBytes 26
  TypeBytes27 -> ValueBytes27 <$> readBytes 27
  TypeBytes28 -> ValueBytes28 <$> readBytes 28
  TypeBytes29 -> ValueBytes29 <$> readBytes 29
  TypeBytes30 -> ValueBytes30 <$> readBytes 30
  TypeBytes31 -> ValueBytes31 <$> readBytes 31
  TypeBytes32 -> ValueBytes32 <$> readBytes 32
  TypeBytes -> ValueBytes <$> readBytesDyn
  TypeString -> Just $ ValueString str
  where
    readNum :: Num x => Maybe x
    readNum = fromInteger <$> readMaybe (Text.unpack str)
    readBytes :: Int -> Maybe ByteString
    readBytes n =
      let
        (bytes, leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty || ByteString.length bytes /= n
          then Nothing
          else Just bytes
    readBytesDyn :: Maybe ByteString
    readBytesDyn =
      let
        (bytes, leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty
          then Nothing
          else Just bytes
