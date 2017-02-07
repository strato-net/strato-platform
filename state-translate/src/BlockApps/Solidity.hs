{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Solidity where

import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.Binary
import Data.LargeWord
import Data.Text (Text)
import Numeric.Natural

import BlockApps.Data (Address)

data Type
  = TypeBool
  | TypeUInt8
  | TypeUInt16
  | TypeUInt24
  | TypeUInt32
  | TypeUInt40
  | TypeUInt48
  | TypeUInt56
  | TypeUInt64
  | TypeUInt72
  | TypeUInt80
  | TypeUInt88
  | TypeUInt96
  | TypeUInt104
  | TypeUInt112
  | TypeUInt120
  | TypeUInt128
  | TypeUInt136
  | TypeUInt144
  | TypeUInt152
  | TypeUInt160
  | TypeUInt168
  | TypeUInt176
  | TypeUInt184
  | TypeUInt192
  | TypeUInt200
  | TypeUInt208
  | TypeUInt216
  | TypeUInt224
  | TypeUInt232
  | TypeUInt240
  | TypeUInt248
  | TypeUInt256
  | TypeFixed (Maybe (Int,Int))
  -- ^ fixed<M>x<N>: fixed-point signed number of M+N bits,
  -- 0 < M + N <= 256, M % 8 == N % 8 == 0.
  -- Corresponds to the int256 equivalent binary value divided by 2^N.
  -- fixed: synonyms for fixed128x128,
  -- (not to be used for computing the function selector).
  | TypeUFixed (Maybe (Int,Int))
  -- ^ ufixed<M>x<N>: unsigned variant of fixed<M>x<N>.
  -- ufixed: synonyms for ufixed128x128
  -- (not to be used for computing the function selector).
  | TypeBytes (Maybe Int)
  -- ^ bytes<M>: binary type of M bytes, 0 < M <= 32.
  -- bytes: dynamic sized byte sequence.
  | TypeString
  -- ^ string: dynamic sized unicode string assumed to be UTF-8 encoded.
  | TypeFunction [Type]
  -- ^ function: equivalent to bytes24: an address,
  -- followed by a function selector
  | TypeArray Type (Maybe Int)
  -- ^ <type>[M]: a fixed-length array of the given fixed-length type.
  -- <type>[]: a variable-length array of the given fixed-length type.
  | TypeMapping Type Type

type Word24 = LargeKey Word16 Word8
type Word40 = LargeKey Word32 Word8
type Word48 = LargeKey Word32 Word16
type Word56 = LargeKey Word32 Word24
type Word72 = LargeKey Word64 Word8
type Word80 = LargeKey Word64 Word16
type Word88 = LargeKey Word64 Word24
type Word104 = LargeKey Word96 Word8
type Word112 = LargeKey Word96 Word16
type Word120 = LargeKey Word96 Word24
type Word136 = LargeKey Word128 Word8
type Word144 = LargeKey Word128 Word16
type Word152 = LargeKey Word128 Word24
type Word168 = LargeKey Word160 Word8
type Word176 = LargeKey Word160 Word16
type Word184 = LargeKey Word160 Word24
type Word200 = LargeKey Word192 Word8
type Word208 = LargeKey Word192 Word16
type Word216 = LargeKey Word192 Word24
type Word232 = LargeKey Word224 Word8
type Word240 = LargeKey Word224 Word16
type Word248 = LargeKey Word224 Word24

data Value
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
  | ValueInt Integer
  | ValueAddress Address
  | ValueFixed Double
  | ValueUFixed Double
  | ValueBytes ByteString
  | ValueString Text
  deriving (Eq,Show)

decodeValue
  :: ByteString
  -> Int
  -> Type
  -> Value
decodeValue storage start = \case
  TypeBool -> undefined
  TypeUInt8 -> undefined
  TypeUInt16 -> undefined
  TypeUInt24 -> undefined
  TypeUInt32 -> undefined
  TypeUInt40 -> undefined
  TypeUInt48 -> undefined
  TypeUInt56 -> undefined
  TypeUInt64 -> undefined
  TypeUInt72 -> undefined
  TypeUInt80 -> undefined
  TypeUInt88 -> undefined
  TypeUInt96 -> undefined
  TypeUInt104 -> undefined
  TypeUInt112 -> undefined
  TypeUInt120 -> undefined
  TypeUInt128 -> undefined
  TypeUInt136 -> undefined
  TypeUInt144 -> undefined
  TypeUInt152 -> undefined
  TypeUInt160 -> undefined
  TypeUInt168 -> undefined
  TypeUInt176 -> undefined
  TypeUInt184 -> undefined
  TypeUInt192 -> undefined
  TypeUInt200 -> undefined
  TypeUInt208 -> undefined
  TypeUInt216 -> undefined
  TypeUInt224 -> undefined
  TypeUInt232 -> undefined
  TypeUInt240 -> undefined
  TypeUInt248 -> undefined
  TypeUInt256 -> undefined
  TypeFixed (Just (n,m)) -> undefined
  TypeFixed Nothing -> undefined
  TypeBytes (Just n) -> undefined
  TypeString -> undefined
  TypeFunction tys -> undefined
  TypeArray ty (Just n) -> undefined
  TypeArray ty Nothing -> undefined
  TypeMapping tyk tyv -> undefined
  where
    decodeStrict :: Binary x => ByteString -> x
    decodeStrict = decode . ByteString.Lazy.fromStrict
    slice :: Int -> ByteString -> ByteString
    slice len = ByteString.take len . ByteString.drop start
