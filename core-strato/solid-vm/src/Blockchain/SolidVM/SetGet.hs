{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
module Blockchain.SolidVM.SetGet where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import           Data.IORef
import           Data.List
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Vector as V

import           Blockchain.Data.Address
import           Blockchain.DB.SolidStorageDB
import           Blockchain.SolidVM.SM
import           Blockchain.SolidVM.Value
import           Blockchain.Strato.Model.Format
import qualified SolidVM.Model.Storable as MS

fromBasic :: MS.BasicValue -> Value
fromBasic = \case
  MS.BDefault -> SDefault
  MS.BInteger i -> SInteger i
  MS.BString s -> SString . T.unpack $ s
  MS.BBool b -> SBool b
  MS.BAddress a -> SAddress a
  MS.BEnumVal k t -> SEnumVal (T.unpack k) (T.unpack t)

toBasic :: Value -> MS.BasicValue
toBasic = \case
  SInteger i -> MS.BInteger i
  SString s -> MS.BString (T.pack s)
  SBool b -> MS.BBool b
  SAddress a -> MS.BAddress a
  SEnumVal k t -> MS.BEnumVal (T.pack k) (T.pack t)
  SDefault -> MS.BDefault
  x -> error $ "non basic solidity type cannot be stored atomically: " ++ show x

setVar :: MS.StoragePath -> Value -> SM ()
setVar key val = do
  -- If val is a simple value, assign it. If it
  -- is deeper, read the subfields and assign to their adjustment
  currentAddress' <- getCurrentAddress
  case val of
      SStruct name fs -> forM_ (M.toList fs) $ \(f, var) -> do
        let suffix = [MS.Field (BC.pack f)]
            srcKey = (MS.Field (BC.pack name)):suffix
            dstKey = key ++ suffix
        val' <- case var of
          Constant x -> return $ toBasic x
          _ -> getSolidStorageKeyVal' currentAddress' srcKey
        putSolidStorageKeyVal' currentAddress' dstKey val'
      _ -> putSolidStorageKeyVal' currentAddress' key (toBasic val)

getVar :: Variable -> SM Value
getVar (Variable ioRef) = liftIO $ readIORef ioRef
getVar (Constant c) = return c
getVar (Property "length" var) = do
  case var of
    StorageItem p -> getVar . StorageItem $ p ++ [MS.Field "length"]
    _ -> do
      val <- getVar var
      case val of
        SArray _ vec -> return $ SInteger $ toInteger $ V.length vec
        SString s -> return $ SInteger $ toInteger $ length s
        x -> error $ "getVar is not defined for property 'length' with value: " ++ show x
getVar (StorageItem key) = do
  currentAddress' <- getCurrentAddress
  fromBasic <$> getSolidStorageKeyVal' currentAddress' key
getVar x = error $ "getVar called for undefined value: " ++ show x


showSM :: Value -> SM String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return $ show v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName) = return $ enumName ++ "." ++ valName
showSM (SAddress a) = return $ format a
showSM (STuple v) = do
  vals <- forM (V.toList v) getVar
  strings <- forM vals showSM
  return $ "(" ++ intercalate ", " strings ++ ")"
showSM (SArray _ v) = do
  vals <- forM (V.toList v) getVar
  strings <- forM vals showSM
  return $ "[" ++ intercalate ", " strings ++ "]"
showSM (SStruct name m) = do
  valStrings <-
    forM (M.toList m) $ \(n, var) -> do
      val <- getVar var
      valString <- showSM val
      return (n, valString)
  return $ name ++ "{"
                ++ intercalate ", " (map (\(n, v) -> n ++ ": " ++ v) valStrings)
                ++ "}"
showSM (SMap _ m) = do
  valStrings <-
    forM (M.toList m) $ \(key, var) -> do
      val <- getVar var
      valString <- showSM val
      keyString <- showSM key
      return (keyString, valString)
  return $ "{"
           ++ intercalate ", " (map (\(k, v) -> k ++ ": " ++ v) valStrings)
           ++ "}"
showSM (SContract name address) = do
  return $ "Contract: " ++ name ++ "/" ++ format (Address $ fromInteger address)
showSM SDefault = return "<default>"
showSM x = error $ "showSM called for unsupported value: " ++ show x
