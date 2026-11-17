{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Builtins.Collections (identity, variadic, push, stringConcat) where

import Blockchain.SolidVM.Execution
import Blockchain.VM.SolidException (SolidException (InvalidArguments))
import Control.Exception (throw)
import Text.Format (format)
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
push (SArray vec) (Just variable) vals | mutable variable = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  writeBuiltinVariable @engine variable (SArray newArr)
  pure $ Constant (SInteger $ fromIntegral $ V.length newArr)
  where
    mutable (Variable _) = True
    mutable (TypedVariable _ inner) = mutable inner
    mutable _ = False
push v mv argVals = throw (InvalidArguments "push" (format (renderValueShallow v, mv, map renderValueShallow argVals)))

stringConcat :: [String] -> String
stringConcat = concat
