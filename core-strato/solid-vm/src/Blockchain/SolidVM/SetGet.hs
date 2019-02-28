{-# LANGUAGE OverloadedStrings #-}
module Blockchain.SolidVM.SetGet where

import           Debug.Trace
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

setVar :: Variable -> Value -> SM ()
setVar (Property "length" o) newVal = do
  val <- getVar o
  case (val, newVal) of
    (SArray valType oldV, SInteger i) -> do
      newV <-
        case toInteger (V.length oldV) `compare` i of
          EQ -> return oldV
          LT -> do
            extra <-
              liftIO $ V.replicateM (fromInteger i-V.length oldV) (fmap Variable $ newIORef $ defaultValue valType)
            return $ oldV V.++ extra
          GT -> return $ V.take (fromInteger i) oldV
      setVar o $ SArray valType newV

    _ -> error "setVar length called for unknown params"


setVar (Variable ioRef) val = do
  liftIO $ writeIORef ioRef val

setVar (UnsetMapItem mapVariable key _) val = do
  (SMap valType theMap) <- getVar mapVariable
  newVar <- liftIO $ fmap Variable $ newIORef val
  setVar mapVariable $ SMap valType $ M.insert key newVar theMap

setVar (StorageItem key) val = do
  traceShowM ("setVarStorage" :: String, key, val)
  -- If val is a simple value, assign it. If it
  -- is deeper, read the subfields and assign to their adjustment
  currentAddress' <- getCurrentAddress
  case val of
      SStruct name fs -> forM_ (M.toList fs) $ \(f, var) -> do
        let suffix = [MS.Field (BC.pack f)]
            srcKey = (MS.Field (BC.pack name)):suffix
            dstKey = key ++ suffix
        traceShowM ("Looping over storage. What if its not stored?"::String)
        val' <- case var of
          Constant x -> return $ toBasic x
          _ -> getSolidStorageKeyVal' currentAddress' srcKey
        traceShowM (suffix, srcKey, dstKey, val')
        putSolidStorageKeyVal' currentAddress' dstKey val'
      _ -> putSolidStorageKeyVal' currentAddress' key (toBasic val)

setVar (Constant _) _ = error "setVar was called for a constant, this is forbidden"

setVar x _ = error $ "setVar called for undefined value: " ++ show x

getVar :: Variable -> SM Value
getVar (Variable ioRef) = liftIO $ readIORef ioRef
getVar (Constant x) = return x
getVar (Property "length" var) = do
  case var of
    StorageItem p -> getVar . StorageItem $ p ++ [MS.Field "length"]
    _ -> do
      val <- getVar var
      case val of
        SArray _ vec -> return $ SInteger $ toInteger $ V.length vec
        SString s -> return $ SInteger $ toInteger $ length s
        x -> error $ "getVar is not defined for property 'length' with value: " ++ show x
getVar (UnsetMapItem _ _ valType) = return $ defaultValue valType
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
