{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.SolidVM.SetGet (
  setVar,

  weakGetVar,
  getVar,

  getInt,
  getBool,
  getAddress,
  getString,
{-
  getSolid,
-}
  deleteVar,

  
  showSM
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import           Data.IORef
import           Data.List
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Vector as V
import           Text.Printf

import           Blockchain.DB.SolidStorageDB
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.SM
import           Blockchain.SolidVM.Value
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import           Text.Format

--import Debug.Trace


{-
{-# INLINE putSolid #-}
putSolid :: Either LocalVar Address -> MS.StoragePath -> MS.BasicValue -> SM ()
putSolid loc key val = case loc of
                          Left LocalVar -> setLocal key val
                          Right addr -> do
                            markDiffForAction addr key val
                            putSolidStorageKeyVal' addr key val

{-# INLINE getSolid #-}
getSolid :: Either LocalVar Address -> MS.StoragePath -> SM MS.BasicValue
getSolid loc key = case loc of
                      Left LocalVar -> getLocal key
                      Right addr -> getSolidStorageKeyVal' addr key

-}

fromBasic :: MS.BasicValue -> Value
fromBasic = \case
  MS.BInteger i -> SInteger i
  MS.BString s -> SString . BC.unpack $ s
  MS.BBool b -> SBool b
  MS.BAddress a -> SAddress a
  MS.BContract n a -> SContract (T.unpack n) (fromIntegral a)
  MS.BEnumVal k v num -> SEnumVal (T.unpack k) (T.unpack v) num
  MS.BMappingSentinel -> SMappingSentinel
  MS.BDefault -> internalError "fromBasic: should never decode" MS.BDefault

findDefault :: BasicType -> Value
findDefault = \case
  TInteger -> SInteger 0
  TString -> SString ""
  TBool -> SBool False
  TAddress -> SAddress 0x0
  TContract n -> SContract n 0x0
  TEnumVal n -> SEnumVal n (todo "findDefault/enumval" n) 0x0
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
  SEnumVal k t num -> MS.BEnumVal (T.pack k) (T.pack t) num
  SMappingSentinel -> MS.BMappingSentinel
  x -> error $ "non basic solidity type cannot be stored atomically: " ++ show x

setVar :: Variable -> Value -> SM ()
setVar (Constant dst) src = setVal dst src
setVar (Variable var) val = liftIO $ writeIORef var val

setVal :: Value -> Value -> SM ()
-- If val is a simple value, assign it. If it
-- is deeper, read the subfields and assign to their adjustment

setVal (SReference dst) (SReference src) = do
  t <- getXabiValueType src
  case t of
    Xabi.Array{} -> do
      len <- getInt (Constant $ SReference $ src `apSnoc` MS.Field "length")
      setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger len
      forM_ [0..len-1] $ \i -> do
        let i' = fromIntegral i
        setVal (SReference $ dst `apSnoc` MS.ArrayIndex i') =<<
          getVar (Constant $ SReference $ src `apSnoc` MS.ArrayIndex i')
    _ -> internalError "unimplemented wide copy to storage" (dst, src, t)


setVal (SReference dst) (SStruct _ fs) = do
  forM_ (M.toList fs) $ \(f, var) -> do
    setVal (SReference $ dst `apSnoc` MS.Field (BC.pack f)) =<< weakGetVar var

setVal (SReference dst) (SArray _ fs) = do
  let len = length fs
  setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger $ fromIntegral len
  forM_ [0..len-1] $ \i -> do
    let i' = fromIntegral i
    elementVal <- getVar $ fs V.! i
    setVal (SReference $ dst `apSnoc` MS.ArrayIndex i') elementVal






setVal (SReference (AddressedPath (Right addr) path)) src = do
  markDiffForAction addr path $ toBasic src
  putSolidStorageKeyVal' addr path $ toBasic src
setVal dst src = error $ "unknown case called in setVal:\nsrc = " ++ show src ++ "\ndst = " ++ show dst


{-


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
-}

getAddress :: Variable -> SM Value
getAddress = getVar


getString :: Variable -> SM Value
getString = getVar

{-
getContract :: String -> Variable -> SM Value
getContract contractName = getVar' (Just $ TContract contractName)
-}

weakGetVar :: Variable -> SM Value
weakGetVar (Constant c) = return c
weakGetVar (Variable v) = liftIO $ readIORef v

getVar :: Variable -> SM Value
--getVar x | trace ("getVar called: " ++ show x) $  False = undefined
getVar (Constant (SReference addressedPath@(AddressedPath (Right addr) key))) = do
  theValue <- getSolidStorageKeyVal' addr key
  case theValue of
    MS.BDefault -> do
      typeHint <- getValueType addressedPath
      case typeHint of
        TStruct name fieldHints -> SStruct name . M.fromList <$> do
          forM fieldHints $ \(l, _) -> do
            fieldValue <- getVar . Constant . SReference $ addressedPath `apSnoc` MS.Field l
            return (BC.unpack l, Constant fieldValue) 
        TComplex -> return $ SReference addressedPath
        _ -> return $ findDefault typeHint
    _ -> return $ fromBasic theValue
getVar (Constant v) = return v
getVar (Variable v) = liftIO $ readIORef v


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

deleteVar :: Variable -> SM ()
deleteVar _ = error "deleteVar not yet supported"


{-
getVar' :: Maybe BasicType -> Variable -> SM Value
getVar' mTypeHint var = do
  val <- weakGetVar var
  case val of
    SReference apt -> getStorageItem mTypeHint apt
    STuple vs -> STuple <$> V.mapM (fmap Constant . getVar' Nothing) vs
    _ -> return val

getStorageItem :: Maybe BasicType -> AddressedPath -> SM Value
getStorageItem mTypeHint apt@(AddressedPath loc key) = do
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
            fieldValue <- getVar' (Just t') . Constant . SReference $ apt `apSnoc` MS.Field l
            return (BC.unpack l, Constant fieldValue)
        TComplex -> return $ SReference apt
        _ -> return $ findDefault typeHint
-}


showSM :: Value -> SM String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return $ show v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName num) = return
    $ printf "%s.%s (= %x)" enumName valName num
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
  return $ "Contract: " ++ name ++ "/" ++ format address
showSM (SReference apt) = return $ "<reference to " ++ show apt ++ ">"
showSM (SBuiltinVariable x) = return $ "<built-in " ++ show x ++ ">"
showSM x = todo "showSM called for unsupported value: " x
