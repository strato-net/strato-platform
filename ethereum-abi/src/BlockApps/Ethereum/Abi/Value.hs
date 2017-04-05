{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Ethereum.Abi.Value
  ( Value(..)
  , ValueStatic(..)
  , ValueDynamic(..)
  , valueIsDynamic
  , encodeValue
  , encodeValues
  , decodeValue
  , decodeValues
  ) where

import Data.Bool (bool)
import Data.ByteString (ByteString)
import Data.Maybe
import Data.Monoid
import Data.Text (Text)

import qualified Data.Binary as Binary
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Lazy as ByteString.Lazy
import qualified Data.Text.Encoding as Text.Encoding

import BlockApps.Ethereum
import BlockApps.Ethereum.Abi.Int
import BlockApps.Ethereum.Abi.Type

data Value
  = ValueStatic ValueStatic
  | ValueDynamic ValueDynamic
  deriving (Eq,Show)

valueIsDynamic :: Value -> Bool
valueIsDynamic = \case
  ValueStatic _ -> False
  ValueDynamic _ -> True

data ValueStatic
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
  | ValueArrayStatic [ValueStatic]
  deriving (Eq,Show)

data ValueDynamic
  = ValueBytes ByteString
  | ValueString Text
  | ValueArrayDynamic [ValueStatic]
  deriving (Eq,Show)

encodeValue :: Value -> ByteString
encodeValue = \case
  ValueStatic value -> encodeStatic value
  ValueDynamic value -> encodeDynamic value
  where

    encodeDynamic = \case
      ValueBytes value ->
        encodeStatic (ValueUInt256 (fromIntegral (ByteString.length value)))
        <> pad32Right0 value
      ValueString value ->
        encodeDynamic . ValueBytes $ Text.Encoding.encodeUtf8 value
      ValueArrayDynamic values ->
        encodeStatic (ValueUInt256 (fromIntegral (length values)))
        <> encodeValues (map ValueStatic values)

    encodeStatic = \case
      ValueBool value -> encodeStatic . ValueUInt256 $ bool 0 1 value
      ValueUInt8 value -> pad32Left0 $ encodeStrict value
      ValueUInt16 value -> pad32Left0 $ encodeStrict value
      ValueUInt24 value -> pad32Left0 $ encodeStrict value
      ValueUInt32 value -> pad32Left0 $ encodeStrict value
      ValueUInt40 value -> pad32Left0 $ encodeStrict value
      ValueUInt48 value -> pad32Left0 $ encodeStrict value
      ValueUInt56 value -> pad32Left0 $ encodeStrict value
      ValueUInt64 value -> pad32Left0 $ encodeStrict value
      ValueUInt72 value -> pad32Left0 $ encodeStrict value
      ValueUInt80 value -> pad32Left0 $ encodeStrict value
      ValueUInt88 value -> pad32Left0 $ encodeStrict value
      ValueUInt96 value -> pad32Left0 $ encodeStrict value
      ValueUInt104 value -> pad32Left0 $ encodeStrict value
      ValueUInt112 value -> pad32Left0 $ encodeStrict value
      ValueUInt120 value -> pad32Left0 $ encodeStrict value
      ValueUInt128 value -> pad32Left0 $ encodeStrict value
      ValueUInt136 value -> pad32Left0 $ encodeStrict value
      ValueUInt144 value -> pad32Left0 $ encodeStrict value
      ValueUInt152 value -> pad32Left0 $ encodeStrict value
      ValueUInt160 value -> pad32Left0 $ encodeStrict value
      ValueUInt168 value -> pad32Left0 $ encodeStrict value
      ValueUInt176 value -> pad32Left0 $ encodeStrict value
      ValueUInt184 value -> pad32Left0 $ encodeStrict value
      ValueUInt192 value -> pad32Left0 $ encodeStrict value
      ValueUInt200 value -> pad32Left0 $ encodeStrict value
      ValueUInt208 value -> pad32Left0 $ encodeStrict value
      ValueUInt216 value -> pad32Left0 $ encodeStrict value
      ValueUInt224 value -> pad32Left0 $ encodeStrict value
      ValueUInt232 value -> pad32Left0 $ encodeStrict value
      ValueUInt240 value -> pad32Left0 $ encodeStrict value
      ValueUInt248 value -> pad32Left0 $ encodeStrict value
      ValueUInt256 value -> pad32Left0 $ encodeStrict value
      ValueUInt value -> encodeStatic $ ValueUInt256 value
      ValueInt8 value -> pad32LeftSign value $ encodeStrict value
      ValueInt16 value -> pad32LeftSign value $ encodeStrict value
      ValueInt24 value -> pad32LeftSign value $ encodeStrict value
      ValueInt32 value -> pad32LeftSign value $ encodeStrict value
      ValueInt40 value -> pad32LeftSign value $ encodeStrict value
      ValueInt48 value -> pad32LeftSign value $ encodeStrict value
      ValueInt56 value -> pad32LeftSign value $ encodeStrict value
      ValueInt64 value -> pad32LeftSign value $ encodeStrict value
      ValueInt72 value -> pad32LeftSign value $ encodeStrict value
      ValueInt80 value -> pad32LeftSign value $ encodeStrict value
      ValueInt88 value -> pad32LeftSign value $ encodeStrict value
      ValueInt96 value -> pad32LeftSign value $ encodeStrict value
      ValueInt104 value -> pad32LeftSign value $ encodeStrict value
      ValueInt112 value -> pad32LeftSign value $ encodeStrict value
      ValueInt120 value -> pad32LeftSign value $ encodeStrict value
      ValueInt128 value -> pad32LeftSign value $ encodeStrict value
      ValueInt136 value -> pad32LeftSign value $ encodeStrict value
      ValueInt144 value -> pad32LeftSign value $ encodeStrict value
      ValueInt152 value -> pad32LeftSign value $ encodeStrict value
      ValueInt160 value -> pad32LeftSign value $ encodeStrict value
      ValueInt168 value -> pad32LeftSign value $ encodeStrict value
      ValueInt176 value -> pad32LeftSign value $ encodeStrict value
      ValueInt184 value -> pad32LeftSign value $ encodeStrict value
      ValueInt192 value -> pad32LeftSign value $ encodeStrict value
      ValueInt200 value -> pad32LeftSign value $ encodeStrict value
      ValueInt208 value -> pad32LeftSign value $ encodeStrict value
      ValueInt216 value -> pad32LeftSign value $ encodeStrict value
      ValueInt224 value -> pad32LeftSign value $ encodeStrict value
      ValueInt232 value -> pad32LeftSign value $ encodeStrict value
      ValueInt240 value -> pad32LeftSign value $ encodeStrict value
      ValueInt248 value -> pad32LeftSign value $ encodeStrict value
      ValueInt256 value -> pad32LeftSign value $ encodeStrict value
      ValueInt value -> encodeStatic $ ValueInt256 value
      ValueAddress value -> encodeStatic . ValueUInt160 $ unAddress value
      ValueBytes1 value -> pad32Right0 $ ByteString.singleton value
      ValueBytes2 value -> pad32Right0 value
      ValueBytes3 value -> pad32Right0 value
      ValueBytes4 value -> pad32Right0 value
      ValueBytes5 value -> pad32Right0 value
      ValueBytes6 value -> pad32Right0 value
      ValueBytes7 value -> pad32Right0 value
      ValueBytes8 value -> pad32Right0 value
      ValueBytes9 value -> pad32Right0 value
      ValueBytes10 value -> pad32Right0 value
      ValueBytes11 value -> pad32Right0 value
      ValueBytes12 value -> pad32Right0 value
      ValueBytes13 value -> pad32Right0 value
      ValueBytes14 value -> pad32Right0 value
      ValueBytes15 value -> pad32Right0 value
      ValueBytes16 value -> pad32Right0 value
      ValueBytes17 value -> pad32Right0 value
      ValueBytes18 value -> pad32Right0 value
      ValueBytes19 value -> pad32Right0 value
      ValueBytes20 value -> pad32Right0 value
      ValueBytes21 value -> pad32Right0 value
      ValueBytes22 value -> pad32Right0 value
      ValueBytes23 value -> pad32Right0 value
      ValueBytes24 value -> pad32Right0 value
      ValueBytes25 value -> pad32Right0 value
      ValueBytes26 value -> pad32Right0 value
      ValueBytes27 value -> pad32Right0 value
      ValueBytes28 value -> pad32Right0 value
      ValueBytes29 value -> pad32Right0 value
      ValueBytes30 value -> pad32Right0 value
      ValueBytes31 value -> pad32Right0 value
      ValueBytes32 value -> pad32Right0 value
      ValueArrayStatic values -> encodeValues (map ValueStatic values)

    encodeStrict x = ByteString.Lazy.toStrict $ Binary.encode x

    pad size dir ch bs =
      let
        len = ByteString.length bs
        padSize = (size - (len `mod` size)) `mod` size
        padding = ByteString.replicate padSize ch
      in case dir of
        Left _ -> padding <> bs
        Right _ -> bs <> padding

    sign value = if signum value == -1 then -1 else 0

    pad32Left0 = pad 32 (Left ()) 0
    pad32Right0 = pad 32 (Right ()) 0
    pad32LeftSign value = pad 32 (Left ()) (sign value)

encodeValues :: [Value] -> ByteString
encodeValues values =
  let
    head' =
      [ if valueIsDynamic value then Nothing else Just (encodeValue value)
      | value <- values
      ]
    tail' =
      [ if valueIsDynamic value then encodeValue value else ByteString.empty
      | value <- values
      ]
    tailLengths = scanl (\len bytes -> len + ByteString.length bytes) 0 tail'
    headLength = sum $ map (maybe 32 ByteString.length) head'
    resolveHead
      = fromMaybe
      . encodeValue
      . ValueStatic
      . ValueUInt256
      . fromIntegral
      . (headLength +)
    head'' = zipWith resolveHead tailLengths head'
  in
    ByteString.concat $ head'' <> tail'

decodeValue :: ByteString -> Type -> Maybe Value
decodeValue bytes' = \case
  TypeStatic ty -> ValueStatic <$> decodeValueStatic bytes' ty
  TypeDynamic ty -> ValueDynamic <$> decodeValueDynamic bytes' ty
  where

    decodeValueStatic bytes = \case
      TypeBool -> ValueBool . (==1) <$> (decodeStrict bytes::Maybe Word256)
      TypeUInt8 -> ValueUInt8 <$> decodeStrict bytes
      TypeUInt16 -> ValueUInt16 <$> decodeStrict bytes
      TypeUInt24 -> ValueUInt24 <$> decodeStrict bytes
      TypeUInt32 -> ValueUInt32 <$> decodeStrict bytes
      TypeUInt40 -> ValueUInt40 <$> decodeStrict bytes
      TypeUInt48 -> ValueUInt48 <$> decodeStrict bytes
      TypeUInt56 -> ValueUInt56 <$> decodeStrict bytes
      TypeUInt64 -> ValueUInt64 <$> decodeStrict bytes
      TypeUInt72 -> ValueUInt72 <$> decodeStrict bytes
      TypeUInt80 -> ValueUInt80 <$> decodeStrict bytes
      TypeUInt88 -> ValueUInt88 <$> decodeStrict bytes
      TypeUInt96 -> ValueUInt96 <$> decodeStrict bytes
      TypeUInt104 -> ValueUInt104 <$> decodeStrict bytes
      TypeUInt112 -> ValueUInt112 <$> decodeStrict bytes
      TypeUInt120 -> ValueUInt120 <$> decodeStrict bytes
      TypeUInt128 -> ValueUInt128 <$> decodeStrict bytes
      TypeUInt136 -> ValueUInt136 <$> decodeStrict bytes
      TypeUInt144 -> ValueUInt144 <$> decodeStrict bytes
      TypeUInt152 -> ValueUInt152 <$> decodeStrict bytes
      TypeUInt160 -> ValueUInt160 <$> decodeStrict bytes
      TypeUInt168 -> ValueUInt168 <$> decodeStrict bytes
      TypeUInt176 -> ValueUInt176 <$> decodeStrict bytes
      TypeUInt184 -> ValueUInt184 <$> decodeStrict bytes
      TypeUInt192 -> ValueUInt192 <$> decodeStrict bytes
      TypeUInt200 -> ValueUInt200 <$> decodeStrict bytes
      TypeUInt208 -> ValueUInt208 <$> decodeStrict bytes
      TypeUInt216 -> ValueUInt216 <$> decodeStrict bytes
      TypeUInt224 -> ValueUInt224 <$> decodeStrict bytes
      TypeUInt232 -> ValueUInt232 <$> decodeStrict bytes
      TypeUInt240 -> ValueUInt240 <$> decodeStrict bytes
      TypeUInt248 -> ValueUInt248 <$> decodeStrict bytes
      TypeUInt256 -> ValueUInt256 <$> decodeStrict bytes
      TypeUInt -> ValueUInt <$> decodeStrict bytes
      TypeInt8 -> ValueInt8 <$> decodeStrict bytes
      TypeInt16 -> ValueInt16 <$> decodeStrict bytes
      TypeInt24 -> ValueInt24 <$> decodeStrict bytes
      TypeInt32 -> ValueInt32 <$> decodeStrict bytes
      TypeInt40 -> ValueInt40 <$> decodeStrict bytes
      TypeInt48 -> ValueInt48 <$> decodeStrict bytes
      TypeInt56 -> ValueInt56 <$> decodeStrict bytes
      TypeInt64 -> ValueInt64 <$> decodeStrict bytes
      TypeInt72 -> ValueInt72 <$> decodeStrict bytes
      TypeInt80 -> ValueInt80 <$> decodeStrict bytes
      TypeInt88 -> ValueInt88 <$> decodeStrict bytes
      TypeInt96 -> ValueInt96 <$> decodeStrict bytes
      TypeInt104 -> ValueInt104 <$> decodeStrict bytes
      TypeInt112 -> ValueInt112 <$> decodeStrict bytes
      TypeInt120 -> ValueInt120 <$> decodeStrict bytes
      TypeInt128 -> ValueInt128 <$> decodeStrict bytes
      TypeInt136 -> ValueInt136 <$> decodeStrict bytes
      TypeInt144 -> ValueInt144 <$> decodeStrict bytes
      TypeInt152 -> ValueInt152 <$> decodeStrict bytes
      TypeInt160 -> ValueInt160 <$> decodeStrict bytes
      TypeInt168 -> ValueInt168 <$> decodeStrict bytes
      TypeInt176 -> ValueInt176 <$> decodeStrict bytes
      TypeInt184 -> ValueInt184 <$> decodeStrict bytes
      TypeInt192 -> ValueInt192 <$> decodeStrict bytes
      TypeInt200 -> ValueInt200 <$> decodeStrict bytes
      TypeInt208 -> ValueInt208 <$> decodeStrict bytes
      TypeInt216 -> ValueInt216 <$> decodeStrict bytes
      TypeInt224 -> ValueInt224 <$> decodeStrict bytes
      TypeInt232 -> ValueInt232 <$> decodeStrict bytes
      TypeInt240 -> ValueInt240 <$> decodeStrict bytes
      TypeInt248 -> ValueInt248 <$> decodeStrict bytes
      TypeInt256 -> ValueInt256 <$> decodeStrict bytes
      TypeInt -> ValueInt <$> decodeStrict bytes
      TypeAddress -> ValueAddress . Address <$> decodeStrict bytes
      TypeBytes1 -> Just . ValueBytes1 $ ByteString.head bytes
      TypeBytes2 -> Just . ValueBytes2 $ ByteString.take 2 bytes
      TypeBytes3 -> Just . ValueBytes3 $ ByteString.take 3 bytes
      TypeBytes4 -> Just . ValueBytes4 $ ByteString.take 4 bytes
      TypeBytes5 -> Just . ValueBytes5 $ ByteString.take 5 bytes
      TypeBytes6 -> Just . ValueBytes6 $ ByteString.take 6 bytes
      TypeBytes7 -> Just . ValueBytes7 $ ByteString.take 7 bytes
      TypeBytes8 -> Just . ValueBytes8 $ ByteString.take 8 bytes
      TypeBytes9 -> Just . ValueBytes9 $ ByteString.take 9 bytes
      TypeBytes10 -> Just . ValueBytes10 $ ByteString.take 10 bytes
      TypeBytes11 -> Just . ValueBytes11 $ ByteString.take 11 bytes
      TypeBytes12 -> Just . ValueBytes12 $ ByteString.take 12 bytes
      TypeBytes13 -> Just . ValueBytes13 $ ByteString.take 13 bytes
      TypeBytes14 -> Just . ValueBytes14 $ ByteString.take 14 bytes
      TypeBytes15 -> Just . ValueBytes15 $ ByteString.take 15 bytes
      TypeBytes16 -> Just . ValueBytes16 $ ByteString.take 16 bytes
      TypeBytes17 -> Just . ValueBytes17 $ ByteString.take 17 bytes
      TypeBytes18 -> Just . ValueBytes18 $ ByteString.take 18 bytes
      TypeBytes19 -> Just . ValueBytes19 $ ByteString.take 19 bytes
      TypeBytes20 -> Just . ValueBytes20 $ ByteString.take 20 bytes
      TypeBytes21 -> Just . ValueBytes21 $ ByteString.take 21 bytes
      TypeBytes22 -> Just . ValueBytes22 $ ByteString.take 22 bytes
      TypeBytes23 -> Just . ValueBytes23 $ ByteString.take 23 bytes
      TypeBytes24 -> Just . ValueBytes24 $ ByteString.take 24 bytes
      TypeBytes25 -> Just . ValueBytes25 $ ByteString.take 25 bytes
      TypeBytes26 -> Just . ValueBytes26 $ ByteString.take 26 bytes
      TypeBytes27 -> Just . ValueBytes27 $ ByteString.take 27 bytes
      TypeBytes28 -> Just . ValueBytes28 $ ByteString.take 28 bytes
      TypeBytes29 -> Just . ValueBytes29 $ ByteString.take 29 bytes
      TypeBytes30 -> Just . ValueBytes30 $ ByteString.take 30 bytes
      TypeBytes31 -> Just . ValueBytes31 $ ByteString.take 31 bytes
      TypeBytes32 -> Just . ValueBytes32 $ ByteString.take 32 bytes
      TypeArrayStatic _len _ty -> undefined

    decodeValueDynamic bytes = \case
      TypeBytes -> do
        let
          (bytesLen,bytes'') = ByteString.splitAt 32 bytes
        len <- decodeStrict bytesLen
        return . ValueBytes $ ByteString.take len bytes''
      TypeString -> do
        ValueBytes str <- decodeValueDynamic bytes TypeBytes
        return . ValueString $ Text.Encoding.decodeUtf8 str
      TypeArrayDynamic _ty -> do
        -- let
        --   (bytesLen,bytes'') = ByteString.splitAt 32 bytes
        -- len <- decodeStrict bytesLen
        undefined

    decodeStrict x =
      case Binary.decodeOrFail (ByteString.Lazy.fromStrict x) of
        Left _ -> Nothing
        Right (_,_,y) -> Just y

decodeValues :: ByteString -> [Type] -> Maybe [Value]
decodeValues = undefined
