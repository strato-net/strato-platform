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

import Blockchain.SolidVM.Builtins.Crypto
import qualified Blockchain.SolidVM.Builtins.Functions as Builtin
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.Builtins.ABI.Values
import Blockchain.SolidVM.SetGet
import Blockchain.VM.SolidException
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
