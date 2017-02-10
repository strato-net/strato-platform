{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Solidity where

import Data.Bits
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
  | TypeUInt (Maybe Int)
  -- ^ uint<M>: unsigned integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. uint32, uint8, uint256.
  -- uint: synonyms for uint256
  | TypeInt (Maybe Int)
  -- ^ int<M>: integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. int32, int8, int256.
  -- int: synonyms for int256
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

data Value
  = ValueBool Bool
  | ValueUInt Natural
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
decodeValue storage offset = \case
  TypeBool -> ValueBool (ByteString.index bytes 31 /= 0)
    where
      bytes = slice 32 storage
  TypeUInt (Just n) ->
    ValueUInt . sum $ zipWith shiftL bytes [8*(n-1),8*(n-2)..0]
    where
      bytes = map fromIntegral . ByteString.unpack $ slice n storage
  TypeUInt Nothing -> decodeValue storage offset (TypeUInt (Just 256))
  TypeInt (Just n) ->
    let
      Just (byte,bytes) = ByteString.uncons $ slice n storage
      (sign, significant) =
        if byte == 0xff
          then (negate, ByteString.dropWhile (==0xff) bytes)
          else (id, ByteString.dropWhile (==0x00) bytes)
      m = ByteString.length significant
      significant' = map fromIntegral $ ByteString.unpack significant
    in
      ValueInt . sign . sum $
        zipWith shiftL significant' [8*(m-1),8*(m-2)..0]
  TypeInt Nothing -> decodeValue storage offset (TypeInt (Just 256))
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
    slice len = ByteString.take len . ByteString.drop offset
