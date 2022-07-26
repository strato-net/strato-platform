{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.SolidVM.Builtins where
import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.SM
import           Blockchain.VM.SolidException
import qualified SolidVM.Model.Storable as MS
import           SolidVM.Model.Value
import qualified SolidVM.Model.CodeCollection as CC

import           Data.Vector as V


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
  contract' <- getCurrentContract
  if (CC._vmVersion contract' == "svm3.2" || CC._vmVersion contract' == "svm3.3")
    then do
      let newVar = Constant av
          newArr = V.snoc vec newVar 
      setVar (Variable ref) (SArray varType newArr)
      return $ Constant (SInteger $ fromIntegral $ V.length newArr)
    else do
      invalidArguments "please use pragma solidvm 3.2 or greater" (OrderedVals [av]) 

--  liftIO $ putStrLn $ "address = " ++ show address
--  liftIO $ putStrLn $ "apt = " ++ show apt
--  liftIO $ putStrLn $ "vallist = " ++ show newVal
--  error "undefined push"
push _ _ argVals = do
  invalidArguments "push" argVals 

{-
    Constant (SPush apt) -> do
-}
