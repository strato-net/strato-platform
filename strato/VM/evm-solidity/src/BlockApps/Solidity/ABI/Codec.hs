{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ABI.Codec
  ( -- * Type descriptors
    TypeDescriptor (..),
    parseTypeDescriptor,
    isDynamicType,
    typeArgToString,

    -- * Byte-level primitives
    padLeft32,
    padRight32,
    encodeUint256,
    encodeInt256,
    integerToBytesBE,
    bytesToIntegerBE,

    -- * Value-level encode / decode
    encodeStaticValue,
    isDynamicValue,
    decodeValue,
    abiDecode,
  )
where

import Blockchain.SolidVM.Builtins.ABI hiding (abiDecode)
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import Blockchain.Strato.Model.Address (addressToByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import SolidVM.Model.SolidString (labelToString)
import SolidVM.Model.Value

--------------------------------------------------------------------------------
-- Value-level encoding helpers (pure, used by solid-vm's monadic abiEncode)
--------------------------------------------------------------------------------

isDynamicValue :: Value -> Bool
isDynamicValue (SBytes _) = True
isDynamicValue (SString _) = True
isDynamicValue (SArray _) = True
isDynamicValue _ = False

encodeStaticValue :: Value -> B.ByteString
encodeStaticValue (SInteger n) = encodeInt256 n
encodeStaticValue (SBool True) = encodeUint256 1
encodeStaticValue (SBool False) = encodeUint256 0
encodeStaticValue (SAddress addr _) = padLeft32 $ addressToByteString addr
encodeStaticValue (SEnumVal _ _ w) = encodeUint256 (fromIntegral w)
encodeStaticValue SNULL = encodeUint256 0
encodeStaticValue _ = encodeUint256 0

--------------------------------------------------------------------------------
-- Type descriptors
--------------------------------------------------------------------------------

typeArgToString :: Value -> Maybe String
typeArgToString (SString s) = Just s
typeArgToString (SEnum s) = Just (labelToString s)
typeArgToString _ = Nothing

--------------------------------------------------------------------------------
-- ABI decoding
--------------------------------------------------------------------------------

decodeValue :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeValue (TUint _bits) bs offset = SInteger (decodeUint bs offset)
decodeValue (TInt bits) bs offset = SInteger (decodeInt bits bs offset)
decodeValue TBool bs offset = SBool (decodeUint bs offset /= 0)
decodeValue TAddress bs offset = SAddress (fromInteger $ decodeAddress bs offset) False
decodeValue (TBytesN n) bs offset = SBytes (decodeFixedBytes n bs offset)
decodeValue TBytes bs offset = SBytes (decodeBytes bs offset)
decodeValue TString bs offset = SString (BC.unpack $ decodeBytes bs offset)
decodeValue (TArrayOf elemType) bs offset =
  SArray (V.fromList $ map Constant $ decodeArray (decodeValue elemType) bs offset)

abiDecode :: B.ByteString -> [Value] -> Value
abiDecode bs typeArgs =
  let decoded = ABI.abiDecode decodeValue SNULL bs (map typeArgToString typeArgs)
   in case decoded of
        [v] -> v
        vs -> STuple (V.fromList $ map Constant vs)
