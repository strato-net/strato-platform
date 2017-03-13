module BlockApps.Types where

import qualified BlockApps.Storage as Storage

import Data.Bits
import Data.ByteString (ByteString)
import Data.Int
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

data SInt
  = SInt8 Int8
  | SInt16 Int16
  | SInt24 Int24
  | SInt32 Int32
  | SInt40 Int40
  | SInt48 Int48
  | SInt56 Int56
  | SInt64 Int64
  | SInt72 Int72
  | SInt80 Int80
  | SInt88 Int88
  | SInt96 Int96
  | SInt104 Int104
  | SInt112 Int112
  | SInt120 Int120
  | SInt128 Int128
  | SInt136 Int136
  | SInt144 Int144
  | SInt152 Int152
  | SInt160 Int160
  | SInt168 Int168
  | SInt176 Int176
  | SInt184 Int184
  | SInt192 Int192
  | SInt200 Int200
  | SInt208 Int208
  | SInt216 Int216
  | SInt224 Int224
  | SInt232 Int232
  | SInt240 Int240
  | SInt248 Int248
  | SInt256 Int256
  deriving (Eq,Show)
