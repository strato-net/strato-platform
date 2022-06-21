{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.SolidVM.SetGet (
  setVar,

  weakGetVar,
  getVar,

  getInt,
  getBool,
  getAccount,
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
import qualified Data.ByteString.UTF8  as UTF8
import           Data.Foldable (for_)
import           Data.List
import qualified Data.Map as M
import qualified Data.Vector as V
import           Text.Printf

import           Blockchain.DB.SolidStorageDB
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.SM
import           Blockchain.Strato.Model.Account
import qualified SolidVM.Model.CodeCollection as CC
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import qualified SolidVM.Model.Storable as MS
import           SolidVM.Model.Value
import           Text.Format
import           UnliftIO

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
  MS.BAccount a -> SAccount a False
  MS.BContract n a -> SContract n a
  MS.BEnumVal k v num -> SEnumVal k v num
  MS.BMappingSentinel -> SMappingSentinel
  MS.BDefault -> internalError "fromBasic: should never decode" MS.BDefault

findDefault :: BasicType -> Value
findDefault = \case
  TInteger -> SInteger 0
  TString -> SString ""
  TBool -> SBool False
  TAccount -> (SAccount $ unspecifiedChain 0x0) False
  TContract n -> SContract n $ unspecifiedChain 0x0
  TEnumVal n -> SEnumVal n (todo "findDefault/enumval" n) 0x0
  TStruct n fs -> todo "findDefault/struct" (n, fs)
  TComplex -> todo "finddefault/complex" TComplex
  Todo msg -> todo "findDefault/todo" msg

toBasic :: Value -> MS.BasicValue
toBasic = \case
  SInteger i -> MS.BInteger i
  SString s -> MS.BString (BC.pack s)
  SBool b -> MS.BBool b
  SAccount a _ -> MS.BAccount a
  SContract n a -> MS.BContract n a
  SEnumVal k t num -> MS.BEnumVal k t num
  SMappingSentinel -> MS.BMappingSentinel
  x -> typeError "non basic solidity type cannot be stored atomically: " (show x)

setVar :: MonadSM m => Variable -> Value -> m ()
setVar (Constant dst) src = setVal dst src
setVar (Variable var) val = liftIO $ writeIORef var val

setVal :: MonadSM m => Value -> Value -> m ()
-- If val is a simple value, assign it. If it
-- is deeper, read the subfields and assign to their adjustment

setVal (SReference dst) (SReference src) = do
  t <- getXabiValueType src
  case t of
    SVMType.Array{} -> do
      len <- getInt (Constant $ SReference $ src `apSnoc` MS.Field "length")
      setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger len
      forM_ [0..len-1] $ \i -> do
        let i' = fromIntegral i
        setVal (SReference $ dst `apSnoc` MS.ArrayIndex i') =<<
          getVar (Constant $ SReference $ src `apSnoc` MS.ArrayIndex i')
    _ -> internalError "unimplemented wide copy to storage" (dst, src, t)


setVal (SReference dst) (SStruct _ fs) = do
  forM_ (M.toList fs) $ \(f, var) -> do
    setVal (SReference $ dst `apSnoc` MS.Field (BC.pack $ labelToString f)) =<< weakGetVar var

setVal (SReference dst) (SArray _ fs) = do
  let len = length fs
  setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger $ fromIntegral len
  forM_ [0..len-1] $ \i -> do
    let i' = fromIntegral i
    elementVal <- getVar $ fs V.! i
    setVal (SReference $ dst `apSnoc` MS.ArrayIndex i') elementVal


setVal (STuple dstVector) (STuple srcVector) = 
  if V.length dstVector /= V.length srcVector
  then typeError "you are trying to set the value of a tuple to another tuple of the wrong length:\n" (show dstVector ++ "\n" ++ show srcVector)
  else do
    let zipped = V.zip dstVector srcVector
    --We get the values first so in the case of (x,y) = (y,x) we can still set the variables to the correct values
    zipped' <- forM zipped $ \(dstItem, srcItemVar) -> do
      srcItemVal <- getVar srcItemVar
      return (dstItem, srcItemVal)
    forM_ zipped' $ \(dstItem, srcItemVal) -> do
      setVar dstItem srcItemVal
   
setVal dst@(SReference addressedPath@(AccountPath addr path)) src = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid write during read-only access" $ "src: " ++ show src ++ ", dst: " ++ show dst
  t <- getXabiValueType addressedPath   -- IMPORTANT: t is not evaulated until it is used
  let basicSrc = case src of
                        SString s ->
                            case t of   -- t is evaluated here because Haskell is lazy
                                        -- We ONLY want to evaluate it if we know src is a SString because
                                        -- in some non-SString cases getXabiValueType will throw an exception
                                SVMType.String{} -> MS.BString . UTF8.fromString $ s 
                                _             -> toBasic src
                        _         -> toBasic src
  markDiffForAction addr path basicSrc
  contract <- getCurrentContract
  let svm3_0 = CC._vmVersion contract == "svm3.0" || CC._vmVersion contract == "svm3.2"
  putSolidStorageKeyVal' svm3_0 addr path basicSrc


setVal (SNULL) _ = return ()


setVal dst src = typeError "unknown case called in setVal:" ("src = " ++ show src ++ ", dst = " ++ show dst)

  
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

getAccount :: MonadSM m => Variable -> m Value
getAccount = getVar


getString :: MonadSM m => Variable -> m Value
getString = getVar

{-
getContract :: String -> Variable -> SM Value
getContract contractName = getVar' (Just $ TContract contractName)
-}

weakGetVar :: MonadIO m => Variable -> m Value
weakGetVar (Constant c) = return c
weakGetVar (Variable v) = liftIO $ readIORef v

getVar :: MonadSM m => Variable -> m Value
--getVar x | trace ("getVar called: " ++ show x) $  False = undefined
getVar (Constant (SReference addressedPath@(AccountPath addr key))) = do
  theValue <- getSolidStorageKeyVal' addr key
  case theValue of
    MS.BDefault -> do
      typeHint <- getValueType addressedPath
      case typeHint of
        {-
        TStruct name fieldHints -> SStruct name . M.fromList <$> do
          forM fieldHints $ \(l, _) -> do
            fieldValue <- getVar . Constant . SReference $ addressedPath `apSnoc` MS.Field l
            return (BC.unpack l, Constant fieldValue)
        -}
        TStruct _ _ -> return $ SReference addressedPath
        TComplex -> return $ SReference addressedPath
        _ -> return $ findDefault typeHint
    MS.BString bs -> do
        t <- getXabiValueType addressedPath
        case t of
                SVMType.String{} -> return . SString $ UTF8.toString bs
                _             -> return $ fromBasic theValue
    _ -> return $ fromBasic theValue

getVar (Constant (SStruct s ma)) = do
  cntrct <- getCurrentContract
  if ( not (CC._vmVersion cntrct == "svm3.2") ) then return (SStruct s ma) else do
    resolved <- mapM (\var -> do
        v <- getVar var
        return $ Constant v
      ) ma
    return $ SStruct s resolved

getVar (Constant (SArray typ vc)) = do
  cntrct <- getCurrentContract
  if ( not (CC._vmVersion cntrct == "svm3.2")) then return (SArray typ vc) else do
    resolved <- V.mapM (\var -> do
        v <- getVar var
        return $ Constant v
      ) vc
    return $ SArray typ resolved

getVar (Constant (STuple vct)) = do
  cntrct <- getCurrentContract
  if (not (CC._vmVersion cntrct == "svm3.2")) then return (STuple vct) else do
    resolved <- V.mapM (\var -> do
        v <- getVar var
        return $ Constant v
      ) vct
    return $ STuple resolved
  
getVar (Constant (SMap ty mp)) = do
  cntrct <- getCurrentContract
  if ( not (CC._vmVersion cntrct == "svm3.2")) then return (SMap ty mp) else do
    resolved <- mapM (\var -> do
        v <- getVar var
        return $ Constant v
      ) mp
    return $ SMap ty resolved

getVar (Constant (SPush v (Just var))) = do
  cntrct <- getCurrentContract
  if ( not (CC._vmVersion cntrct == "svm3.2")) then return (SPush v (Just var)) else do
    resolved <- getVar var
    return $ SPush v (Just $ Constant resolved)

getVar (Constant v) = return v

getVar (Variable v) = liftIO $ readIORef v


getInt :: MonadSM m => Variable -> m Integer
getInt p = do
  v <- getVar p
  case v of
    SInteger s -> return s
    _ -> typeError "getInt" (p, v)

getBool :: MonadSM m => Variable -> m Bool
getBool p = do
  v <- getVar p
  case v of
    SBool b -> return b
    _ -> typeError "getBool" (p, v)

deleteVar :: MonadSM m => Variable -> m ()
deleteVar (Constant (SReference a@(AccountPath addr path))) = do
  xType <- getXabiValueType a
  case xType of
    SVMType.Array{} -> do
      let lengthVar = Constant . SReference $ a `apSnoc` MS.Field "length"
      len <- fromInteger <$> getInt lengthVar
      deleteVar lengthVar
      unless (len <= 0) . for_ [0..(len - 1)] $ \i -> do
        let elemPath = a `apSnoc` MS.ArrayIndex i
        deleteVar . Constant $ SReference elemPath
    _ -> do -- TODO: handle other types
      ro <- readOnly <$> getCurrentCallInfo
      when ro $ invalidWrite "Invalid delete during read-only access" $ "addr: " ++ show addr ++ ", path: " ++ show path
      markDiffForAction addr path $ MS.BDefault
      contract <- getCurrentContract
      let svm3_0 = CC._vmVersion contract == "svm3.0" || CC._vmVersion contract == "svm3.2"
      putSolidStorageKeyVal' svm3_0 addr path $ MS.BDefault

deleteVar v = todo "deleteVar not yet supported for local variables" $ show v


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


showSM :: MonadSM m => Value -> m String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName num) = return
    $ printf "%s.%s (= %x)" (labelToText enumName) (labelToText valName) num
showSM (SAccount a _) = return $ show a
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
  return $ labelToString name ++ "{"
                ++ intercalate ", " (map (\(n, v) -> labelToString n ++ ": " ++ v) valStrings)
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
  return $ "Contract: " ++ labelToString name ++ "/" ++ format address
showSM (SReference apt) = return $ "<reference to " ++ show apt ++ ">"
showSM (SBuiltinVariable x) = return $ "<built-in " ++ show x ++ ">"
showSM (SContractFunction maybeContractName address functionName ) = do
  contractName <- case maybeContractName of
    Just name -> return name
    Nothing -> do
      contract <- getCurrentContract
      return $ CC._contractName contract
  return $ "Contract function: " ++ labelToString contractName ++ "/" ++ format address ++ "." ++ labelToString functionName
showSM x = todo "showSM called for unsupported value: " x
