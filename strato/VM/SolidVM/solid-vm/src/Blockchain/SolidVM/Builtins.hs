{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins
  ( -- * Monadic ABI functions (need MonadSM)
    encodeDynamicValue,
    abiEncode,
    abiEncodePacked,

    push,
    module Blockchain.SolidVM.Builtins.Crypto,
  )
where

import BlockApps.Solidity.ABI.Codec
import Blockchain.SolidVM.Builtins.Crypto
import qualified Blockchain.SolidVM.Builtins.Functions as Builtin
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import Blockchain.SolidVM.SM
import Control.Monad ((<=<))
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address (addressToByteString)
import Blockchain.VM.SolidException
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
      lenPath = apt `MS.snoc` MS.Field "length"
  newLen <- Builtin.push
    (fromIntegral <$> getInt (Constant $ SReference lenPath))
    (\n -> setVar (Constant (SReference lenPath)) (SInteger $ fromIntegral n))
    (\len -> setVar (Constant (SReference $ apt `MS.snoc` MS.Index (BC.pack $ show len))) av)
  return $ Constant (SInteger $ fromIntegral newLen)
push (SArray vec) (Just (Variable ref)) vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
  newLen <- Builtin.push (pure $ V.length vec) (const $ pure ()) $ \_ -> do
    newVar <- createVar av
    let newArr = V.snoc vec newVar
    setVar (Variable ref) (SArray newArr)
  return $ Constant (SInteger $ fromIntegral newLen)
push v mv argVals = do
  invalidArguments "push" (v, mv, argVals)

--------------------------------------------------------------------------------
-- Monadic ABI functions (need MonadSM for variable dereferencing)
--------------------------------------------------------------------------------

encodeDynamicValue :: MonadSM m => Value -> m B.ByteString
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
abiEncode :: MonadSM m => [Value] -> m B.ByteString
abiEncode vals = ABI.abiEncode <$> traverse encodeValue vals
  where
    encodeValue v
      | isDynamicValue v = (,) True <$> encodeDynamicValue v
      | otherwise = pure (False, encodeStaticValue v)

-- | Packed ABI encoding — no padding, no offsets.
abiEncodePacked :: MonadSM m => [Value] -> m B.ByteString
abiEncodePacked = fmap ABI.abiEncodePacked . traverse encodeValuePacked
  where
    encodeValuePacked :: MonadSM m => Value -> m B.ByteString
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
