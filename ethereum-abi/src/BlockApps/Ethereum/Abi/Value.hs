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
      ValueBool value -> pad32Left0 $ ByteString.singleton $ bool 0 1 value
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
