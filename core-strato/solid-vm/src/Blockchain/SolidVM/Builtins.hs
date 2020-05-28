{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.SolidVM.Builtins where

import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.SM
import           Blockchain.SolidVM.Value
import           Blockchain.VM.SolidException
import qualified SolidVM.Model.Storable as MS

push :: MonadSM m => Value -> ValList -> m Variable
push (SReference apt) (OrderedVals [av]) = do
  let lenPath = apt `apSnoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `apSnoc` MS.ArrayIndex len
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
--  liftIO $ putStrLn $ "address = " ++ show address
--  liftIO $ putStrLn $ "apt = " ++ show apt
--  liftIO $ putStrLn $ "vallist = " ++ show newVal
--  error "undefined push"
push _ argVals = do
  invalidArguments "push" argVals

{-
    Constant (SPush apt) -> do
-}
