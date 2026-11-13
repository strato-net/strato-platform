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
import Blockchain.Strato.Model.Address (addressToByteString)
import Control.Monad.IO.Class (MonadIO)
import Control.Monad ((<=<))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import SolidVM.Model.Value
import SolidVM.Model.ABI.Values

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
