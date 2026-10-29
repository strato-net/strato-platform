{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Builtins.Collections (identity, variadic, push, stringConcat) where

import Blockchain.SolidVM.Execution
import Blockchain.VM.SolidException (invalidArguments)
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

identity :: a -> a
identity = id

variadic :: [a] -> [a]
variadic = id

push :: forall engine m. MonadValueOperations engine m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
      lenPath = apt `MS.snoc` MS.Field "length"
  len <- fromIntegral <$> readBuiltinInteger @engine (Constant $ SReference lenPath)
  writeBuiltinVariable @engine (Constant $ SReference lenPath) (SInteger $ fromIntegral (len + 1 :: Int))
  writeBuiltinVariable @engine (Constant $ SReference $ apt `MS.snoc` MS.Index (BC.pack $ show len)) av
  pure $ Constant (SInteger $ fromIntegral (len + 1))
push (SArray vec) (Just (Variable ref)) vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  writeBuiltinVariable @engine (Variable ref) (SArray newArr)
  pure $ Constant (SInteger $ fromIntegral $ V.length newArr)
push v mv argVals = invalidArguments "push" (v, mv, argVals)

stringConcat :: [String] -> String
stringConcat = concat
