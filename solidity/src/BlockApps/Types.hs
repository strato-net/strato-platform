
module BlockApps.Types where

import qualified BlockApps.Storage as Storage

import Data.Bits
import Data.ByteString (ByteString)
import Data.LargeWord
import Data.Text (Text)
import Data.Word


data Type
  = TypeBool
  | TypeUInt (Maybe Int)
  -- ^ uint<M>: unsigned integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. uint32, uint8, uint256.
  -- uint: synonyms for uint256
  | TypeInt (Maybe Int)
  -- ^ int<M>: integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. int32, int8, int256.
  -- int: synonyms for int256
  | TypeAddress
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
  | TypeFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  -- ^ function: equivalent to bytes24: an address,
  -- followed by a function selector
  | TypeArray Type (Maybe Int)
  -- ^ <type>[M]: a fixed-length array of the given fixed-length type.
  -- <type>[]: a variable-length array of the given fixed-length type.
  | TypeMapping Type Type
  | TypeContract
  deriving (Eq, Show)


--Given the next available position, return the actual chosen position and the number of primary bytes used
getPositionAndSize::Storage.Position->Type->(Storage.Position, Int)
getPositionAndSize p TypeBool = (p,1)
getPositionAndSize p (TypeInt (Just v)) =
  let
    nextP =
      if 32 - Storage.byte p >= v `shiftR` 3
      then p
      else p{Storage.offset=Storage.offset p+1, Storage.byte=0}
  in
   (nextP, v `shiftR` 3)
getPositionAndSize p (TypeUInt (Just v)) =
  let
    nextP =
      if 32 - Storage.byte p >= v `shiftR` 3
      then p
      else p{Storage.offset=Storage.offset p+1, Storage.byte=0}
  in
   (nextP, v `shiftR` 3)
getPositionAndSize p _ = (p,32)

data UInt
  = UInt8 Word8
  | UInt16 Word16
  | UInt24 Word24
  | UInt32 Word32
  | UInt40 Word40
  | UInt48 Word48
  | UInt56 Word56
  | UInt64 Word64
  | UInt72 Word72
  | UInt80 Word80
  | UInt88 Word88
  | UInt96 Word96
  | UInt104 Word104
  | UInt112 Word112
  | UInt120 Word120
  | UInt128 Word128
  | UInt136 Word136
  | UInt144 Word144
  | UInt152 Word152
  | UInt160 Word160
  | UInt168 Word168
  | UInt176 Word176
  | UInt184 Word184
  | UInt192 Word192
  | UInt200 Word200
  | UInt208 Word208
  | UInt216 Word216
  | UInt224 Word224
  | UInt232 Word232
  | UInt240 Word240
  | UInt248 Word248
  | UInt256 Word256
  deriving (Eq,Show)

--TODO: make this use some pattern?
type Word24 = LargeKey Word8 Word16
type Word40 = LargeKey Word8 Word32
type Word48 = LargeKey Word16 Word32
type Word56 = LargeKey Word24 Word32
type Word72 = LargeKey Word8 Word64
type Word80 = LargeKey Word16 Word64
type Word88 = LargeKey Word24 Word64
type Word104 = LargeKey Word8 Word96
type Word112 = LargeKey Word16 Word96
type Word120 = LargeKey Word24 Word96
type Word136 = LargeKey Word8 Word128
type Word144 = LargeKey Word16 Word128
type Word152 = LargeKey Word8 Word144
type Word168 = LargeKey Word8 Word160
type Word176 = LargeKey Word8 Word168
type Word184 = LargeKey Word8 Word176
type Word200 = LargeKey Word8 Word192
type Word208 = LargeKey Word8 Word200
type Word216 = LargeKey Word8 Word208
type Word232 = LargeKey Word8 Word224
type Word240 = LargeKey Word8 Word232
type Word248 = LargeKey Word8 Word240
