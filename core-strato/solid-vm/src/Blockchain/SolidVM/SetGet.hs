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
import           Blockchain.SolidVM.Exception
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
    TEnumVal n -> SEnumVal n (todo "enum default value" n)
    TStruct n fs -> todo "recursive struct basic types" (n, fs)
    Todo msg -> todo "fromBasic" msg

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
        val' <- getVar $ StorageItem ref
        setVar key val'
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


-- TODO(tim): In the following cases, the type lookup can be
-- elided because it is determined by context.
getInt :: Variable -> SM Integer
getInt p = do
  v <- getVar p
  case v of
    SInteger s -> return s
    _ -> typeError "getInt" (p, v)

getBool :: Variable -> SM Bool
getBool p = do
  v <- getVar p
  case v of
    SBool b -> return b
    _ -> typeError "getBool" (p, v)

getAddress :: Variable -> SM Value
getAddress = getVar

getString :: Variable -> SM Value
getString = getVar

getContract :: String -> Variable -> SM Value
getContract _contractName = getVar


getVar :: Variable -> SM Value
getVar (Variable ioRef) = do
  val <- liftIO $ readIORef ioRef
  case val of
    SReference ref -> getVar (StorageItem ref)
    _ -> return val
getVar (Constant c) = do
  case c of
    SReference ref -> getVar (StorageItem ref)
    _ -> return c
getVar (StorageItem key) = do
  currentAddress' <- getCurrentAddress
  typeHint <- getValueType key
  case typeHint of
    TStruct name fieldHints -> SStruct name . M.fromList <$> do
      forM fieldHints $ \(l, t') -> do
        fieldValue <- fromBasic t' <$> getSolidStorageKeyVal' currentAddress' (key ++ [MS.Field l])
        return (BC.unpack l, Constant fieldValue)
    _ -> fromBasic typeHint <$> getSolidStorageKeyVal' currentAddress' key


showSM :: Value -> SM String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return $ show v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName) = return $ enumName ++ "." ++ valName
showSM (SAddress a) = return $ format a
showSM (STuple v) = do
  vals <- mapM getVar (V.toList v)
  strings <- forM vals showSM
  return $ "(" ++ intercalate ", " strings ++ ")"
showSM (SArray _ v) = do
  vals <- mapM getVar (V.toList v)
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
showSM (SReference p) = return $ "<reference to " ++ BC.unpack (MS.unparsePath p) ++ ">"
showSM x = todo "showSM called for unsupported value: " x
