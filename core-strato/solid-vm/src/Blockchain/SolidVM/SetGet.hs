{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
module Blockchain.SolidVM.SetGet where

import Debug.Trace
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import qualified Data.HashMap.Strict as HM
import           Data.IORef
import           Data.List
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.Text as T
import qualified Data.Vector as V

import           Blockchain.Data.Address
import           Blockchain.DB.SolidStorageDB
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.SM
import           Blockchain.SolidVM.Value
import           Blockchain.Strato.Model.Format
import qualified SolidVM.Model.Storable as MS

{-# INLINE putSolid #-}
putSolid :: Either LocalVar Address -> MS.StoragePath -> MS.BasicValue -> SM ()
putSolid loc key val = case loc of
                          Left LocalVar -> do
                            traceShowM ("putSolid/local"::String, key, val)
                            setLocal key val
                          Right addr -> do
                            traceShowM ("putSolid/storage"::String, addr, key, val)
                            putSolidStorageKeyVal' addr key val

{-# INLINE getSolid #-}
getSolid :: Either LocalVar Address -> MS.StoragePath -> SM MS.BasicValue
getSolid loc key = case loc of
                      Left LocalVar -> getLocal key
                      Right addr -> getSolidStorageKeyVal' addr key

fromBasic :: MS.BasicValue -> Value
fromBasic = \case
  MS.BInteger i -> SInteger i
  MS.BString s -> SString . BC.unpack $ s
  MS.BBool b -> SBool b
  MS.BAddress a -> SAddress a
  MS.BContract n a -> SContract (T.unpack n) (fromIntegral a)
  MS.BEnumVal k v -> SEnumVal (T.unpack k) (T.unpack v)
  MS.BDefault -> internalError "fromBasic: should never decode" MS.BDefault

findDefault :: BasicType -> Value
findDefault = \case
  TInteger -> SInteger 0
  TString -> SString ""
  TBool -> SBool False
  TAddress -> SAddress 0x0
  TContract n -> SContract n 0x0
  TEnumVal n -> SEnumVal n (todo "findDefault/enumval" n)
  TStruct n fs -> todo "findDefault/struct" (n, fs)
  TComplex -> todo "finddefault/complex" TComplex
  Todo msg -> todo "findDefault/todo" msg

toBasic :: Value -> MS.BasicValue
toBasic = \case
  SInteger i -> MS.BInteger i
  SString s -> MS.BString (BC.pack s)
  SBool b -> MS.BBool b
  SAddress a -> MS.BAddress a
  SContract n a -> MS.BContract (T.pack n) (fromIntegral a)
  SEnumVal k t -> MS.BEnumVal (T.pack k) (T.pack t)
  x -> error $ "non basic solidity type cannot be stored atomically: " ++ show x

setVar :: AddressedPath-> Value -> SM ()
setVar apt@(AddressedPath loc key) val = do
  -- If val is a simple value, assign it. If it
  -- is deeper, read the subfields and assign to their adjustment
  case val of
      SReference apt' -> do
<<<<<<< HEAD
        traceShowM ("setVar"::String, apt, apt')
=======
        traceShowM ("setVar ref"::String, apt, val)
>>>>>>> 0acf540a3... Do not put local variables in storage
        val' <- getVar $ StorageItem apt'
        traceShowM ("setVar"::String, apt, val')
        case val' of
          SReference apt'' -> when (apt' == apt'') $
            internalError "setVar infinite loop; (key, val) =" (apt, val)
          _ -> return ()
        setVar apt val'
      SStruct name fs -> forM_ (M.toList fs) $ \(f, var) -> do
        let suffix = [MS.Field (BC.pack f)]
            srcKey = (MS.Field (BC.pack name)):suffix
            dstKey = key ++ suffix
        !val' <- case var of
          Constant x -> do
            return $ toBasic x
          _ -> getSolid loc srcKey
        putSolid loc dstKey val'
      _ -> do
        traceShowM ("setVar simple"::String, apt, val)
        putSolid loc key $! toBasic val

deleteVar :: AddressedPath -> SM ()
deleteVar (AddressedPath loc key) = putSolid loc key MS.BDefault


getInt :: Variable -> SM Integer
getInt p = do
  v <- getVar' (Just TInteger) p
  case v of
    SInteger s -> return s
    _ -> typeError "getInt" (p, v)

getBool :: Variable -> SM Bool
getBool p = do
  v <- getVar' (Just TBool) p
  case v of
    SBool b -> return b
    _ -> typeError "getBool" (p, v)

getAddress :: Variable -> SM Value
getAddress = getVar' (Just TAddress)

getString :: Variable -> SM Value
getString = getVar' (Just TString)

getContract :: String -> Variable -> SM Value
getContract contractName = getVar' (Just $ TContract contractName)


getVar :: Variable -> SM Value
getVar v = do
  val <- getVar' Nothing v
  return val

getVar' :: Maybe BasicType -> Variable -> SM Value
getVar' mTypeHint (Variable ioRef) = do
  val <- liftIO $ readIORef ioRef
  case val of
    SReference apt -> getVar' mTypeHint $ StorageItem apt
    _ -> return val
getVar' mTypeHint (Constant c) = do
  case c of
    SReference apt -> getVar' mTypeHint $ StorageItem apt
    _ -> return c
getVar' mTypeHint (StorageItem apt@(AddressedPath loc key)) = do
  raw <- getSolid loc key
  if raw /= MS.BDefault
    then return $ fromBasic raw
    else do
      typeHint <- case mTypeHint of
                    Just th -> return th
                    Nothing -> getValueType apt
      case typeHint of
        TStruct name fieldHints -> SStruct name . M.fromList <$> do
          forM fieldHints $ \(l, t') -> do
            fieldValue <- getVar' (Just t') . StorageItem $ apt `apSnoc` MS.Field l
            return (BC.unpack l, Constant fieldValue)
        TComplex -> SReference . flip AddressedPath key . Right <$> getCurrentAddress
        _ -> return $ findDefault typeHint


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
showSM (SReference apt) = return $ "<reference to " ++ show apt ++ ">"
showSM x = todo "showSM called for unsupported value: " x
