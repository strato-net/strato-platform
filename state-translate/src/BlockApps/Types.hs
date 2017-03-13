
module BlockApps.Types where

import qualified BlockApps.Storage as Storage

import Data.Bits
import Data.ByteString (ByteString)
import Data.Text (Text)


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
