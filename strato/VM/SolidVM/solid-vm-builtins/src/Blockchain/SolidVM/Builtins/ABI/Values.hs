{-# LANGUAGE FlexibleContexts #-}

module Blockchain.SolidVM.Builtins.ABI.Values
  ( encodeDynamicValue,
    abiEncode,
    abiEncodePacked,
    encodeStaticValue,
    isDynamicValue,
    decodeValue,
    typeArgToString,
    abiDecode,
  )
where

import Blockchain.SolidVM.Builtins.ABI hiding (abiDecode, abiEncode, abiEncodePacked)
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import Control.Monad.IO.Class (MonadIO)
import SolidVM.Model.SolidString (labelToString)
import Blockchain.Strato.Model.Address (addressToByteString)
import Control.Monad ((<=<))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import SolidVM.Model.Value

--------------------------------------------------------------------------------
-- Monadic ABI functions (need MonadSM for variable dereferencing)
--------------------------------------------------------------------------------


encodeDynamicValue :: MonadIO m => Value -> m B.ByteString
encodeDynamicValue (SBytes bs) = pure $ ABI.encodeDynamicBytes bs
encodeDynamicValue (SString s) = pure $
  let bs = BC.pack s
  in ABI.encodeDynamicBytes bs
encodeDynamicValue (SArray vec) = do
  elems <- traverse weakGetVar (V.toList vec)
  encoded <- abiEncode elems
  pure $ ABI.encodeDynamicArray (length elems) encoded
encodeDynamicValue v = pure $ encodeStaticValue v

-- | Standard ABI encoding of a list of values.
-- Uses head/tail encoding: static values go directly in the head,
-- dynamic values get an offset pointer in the head and data in the tail.
abiEncode :: MonadIO m => [Value] -> m B.ByteString
abiEncode vals = ABI.abiEncode <$> traverse encodeValue vals
  where
    encodeValue v
      | isDynamicValue v = (,) True <$> encodeDynamicValue v
      | otherwise = pure (False, encodeStaticValue v)

-- | Packed ABI encoding — no padding, no offsets.
abiEncodePacked :: MonadIO m => [Value] -> m B.ByteString
abiEncodePacked = fmap ABI.abiEncodePacked . traverse encodeValuePacked
  where
    encodeValuePacked :: MonadIO m => Value -> m B.ByteString
    encodeValuePacked (SBool True)       = pure $ B.singleton 1
    encodeValuePacked (SBool False)      = pure $ B.singleton 0
    encodeValuePacked (SAddress addr _)  = pure $ addressToByteString addr
    encodeValuePacked (SInteger n)       = pure $ encodeInt256 n
    encodeValuePacked (SString s)        = pure $ BC.pack s
    encodeValuePacked (SBytes bs)        = pure bs
    encodeValuePacked (SEnumVal _ _ w)   = pure $ encodeUint256 (fromIntegral w)
    encodeValuePacked (SArray vec)       = ABI.abiEncodePacked <$> traverse (encodeValuePacked <=< weakGetVar) (V.toList vec)
    encodeValuePacked SNULL              = pure B.empty
    encodeValuePacked _                  = pure B.empty

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
