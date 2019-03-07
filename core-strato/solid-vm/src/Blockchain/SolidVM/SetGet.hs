{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
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

fromBasic :: BasicType -> MS.BasicValue -> Value
fromBasic t = \case
  MS.BInteger i -> SInteger i
  MS.BString s -> SString . BC.unpack $ s
  MS.BBool b -> SBool b
  MS.BAddress a -> SAddress a
  MS.BContract n a -> SContract (T.unpack n) (fromIntegral a)
  MS.BEnumVal k v -> SEnumVal (T.unpack k) (T.unpack v)
  MS.BDefault -> case t of
    TInteger -> SInteger 0
    TString -> SString ""
    TBool -> SBool False
    TAddress -> SAddress 0x0
    TContract n -> SContract n 0x0
    TEnumVal n -> SEnumVal n (error "TODO(tim): unable to know default enum value")
    TStruct n fs -> error $ "TODO(tim) recursion needed: " ++ show (n, fs)
    Todo msg -> error $ "TODO(tim): type hint needed: " ++ msg

toBasic :: Value -> MS.BasicValue
toBasic = \case
  SInteger i -> MS.BInteger i
  SString s -> MS.BString (BC.pack s)
  SBool b -> MS.BBool b
  SAddress a -> MS.BAddress a
  SContract n a -> MS.BContract (T.pack n) (fromIntegral a)
  SEnumVal k t -> MS.BEnumVal (T.pack k) (T.pack t)
  x -> error $ "non basic solidity type cannot be stored atomically: " ++ show x

setVar :: MS.StoragePath -> Value -> SM ()
setVar key val = do
  -- If val is a simple value, assign it. If it
  -- is deeper, read the subfields and assign to their adjustment
  currentAddress' <- getCurrentAddress
  case val of
      SReference ref -> do
        val' <- getSolidStorageKeyVal' currentAddress' ref
        putSolidStorageKeyVal' currentAddress' key val'
      SStruct name fs -> forM_ (M.toList fs) $ \(f, var) -> do
        let suffix = [MS.Field (BC.pack f)]
            srcKey = (MS.Field (BC.pack name)):suffix
            dstKey = key ++ suffix
        val' <- case var of
          Constant x -> return $ toBasic x
          _ -> getSolidStorageKeyVal' currentAddress' srcKey
        putSolidStorageKeyVal' currentAddress' dstKey val'
      _ -> putSolidStorageKeyVal' currentAddress' key (toBasic val)

deleteVar :: MS.StoragePath -> SM ()
deleteVar key = do
  currentAddress' <- getCurrentAddress
  putSolidStorageKeyVal' currentAddress' key MS.BDefault


getInt :: Variable -> SM Integer
getInt p = do
  v <- getVar TInteger p
  case v of
    SInteger s -> return s
    _ -> error $ "not an integer: " ++ show v

getBool :: Variable -> SM Bool
getBool p = do
  v <- getVar TBool p
  case v of
    SBool b -> return b
    _ -> error $ "not a bool: " ++ show v

getVar :: BasicType -> Variable -> SM Value
getVar t (Variable ioRef) = do
  val <- liftIO $ readIORef ioRef
  case val of
    SReference ref -> getVar t (StorageItem ref)
    _ -> return val
getVar t (Constant c) = do
  case c of
    SReference ref -> getVar t (StorageItem ref)
    _ -> return c
getVar t (StorageItem key) = do
  currentAddress' <- getCurrentAddress
  case t of
    TStruct name fieldHints -> SStruct name . M.fromList <$> do
      forM fieldHints $ \(l, t') ->
        ((BC.unpack l, ) . Constant . fromBasic t') <$> getSolidStorageKeyVal' currentAddress' (key ++ [MS.Field l])
    _ -> fromBasic t <$> getSolidStorageKeyVal' currentAddress' key


showSM :: Value -> SM String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return $ show v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName) = return $ enumName ++ "." ++ valName
showSM (SAddress a) = return $ format a
showSM (STuple v) = do
  vals <- forM (V.toList v) (getVar (Todo "showSM"))
  strings <- forM vals showSM
  return $ "(" ++ intercalate ", " strings ++ ")"
showSM (SArray _ v) = do
  vals <- forM (V.toList v) (getVar (Todo "showSM"))
  strings <- forM vals showSM
  return $ "[" ++ intercalate ", " strings ++ "]"
showSM (SStruct name m) = do
  valStrings <-
    forM (M.toList m) $ \(n, var) -> do
      val <- getVar (Todo "showSM") var
      valString <- showSM val
      return (n, valString)
  return $ name ++ "{"
                ++ intercalate ", " (map (\(n, v) -> n ++ ": " ++ v) valStrings)
                ++ "}"
showSM (SMap _ m) = do
  valStrings <-
    forM (M.toList m) $ \(key, var) -> do
      val <- getVar (Todo "showSM") var
      valString <- showSM val
      keyString <- showSM key
      return (keyString, valString)
  return $ "{"
           ++ intercalate ", " (map (\(k, v) -> k ++ ": " ++ v) valStrings)
           ++ "}"
showSM (SContract name address) = do
  return $ "Contract: " ++ name ++ "/" ++ format (Address $ fromInteger address)
showSM (SReference p) = return $ "<reference to " ++ BC.unpack (MS.unparsePath p) ++ ">"
showSM x = error $ "showSM called for unsupported value: " ++ show x
