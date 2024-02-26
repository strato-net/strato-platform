{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.SolidVM.Builtins where

import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.VM.SolidException
import Data.Vector as V
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ (OrderedVals [av]) = do
  let lenPath = apt `apSnoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `apSnoc` MS.ArrayIndex len
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
push (SArray varType vec) (Just (Variable ref)) (OrderedVals [av]) = do
  let newVar = Constant av
      newArr = V.snoc vec newVar
  setVar (Variable ref) (SArray varType newArr)
  return $ Constant (SInteger $ fromIntegral $ V.length newArr)
push _ _ argVals = do
  invalidArguments "push" argVals
