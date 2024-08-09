{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.SolidVM.SetGet
  ( setVar,
    weakGetVar,
    getVar,
    getInt,
    getRealNum,
    getBool,
    deleteVar,
    toBasic,
    fromBasic,
    showSM,
    jsonSM
  )
where

import Blockchain.DB.SolidStorageDB
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Account
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.UTF8 as UTF8
import Data.Bool (bool)
import Data.Decimal
import Data.Foldable (for_)
import Data.List
import qualified Data.Map as M
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import Text.Format
import Text.Printf
import UnliftIO

fromBasic :: MS.BasicValue -> Value
fromBasic = \case
  MS.BInteger i -> SInteger i
  MS.BString s -> SString . BC.unpack $ s
  MS.BDecimal v -> SDecimal $ read $ BC.unpack v
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
  TDecimal -> SDecimal 0
  TBool -> SBool False
  TAccount -> (SAccount $ unspecifiedChain 0x0) False
  TContract n -> SContract n $ unspecifiedChain 0x0
  TEnumVal n -> SEnumVal n (todo "findDefault/enumval" n) 0x0
  TStruct n fs -> todo "findDefault/struct" (n, fs)
  TComplex -> todo "finddefault/complex" TComplex
  Todo msg -> todo "findDefault/todo" msg

toBasic :: Value -> Maybe MS.BasicValue
toBasic = \case
  SInteger i -> Just $ MS.BInteger i
  SString s -> Just $ MS.BString (BC.pack s)
  SDecimal v -> Just $ MS.BDecimal $ BC.pack $ show v
  SBool b -> Just $ MS.BBool b
  SAccount a _ -> Just $ MS.BAccount a
  SContract n a -> Just $ MS.BContract n a
  SEnumVal k t num -> Just $ MS.BEnumVal k t num
  SMappingSentinel -> Just $ MS.BMappingSentinel
  SUserDefined _ _ x -> toBasic x
  _ -> Nothing

setVar :: MonadSM m => Variable -> Value -> m ()
setVar (Constant dst) src = setVal dst src
setVar (Variable var) val = liftIO $ writeIORef var val

setVal :: MonadSM m => Value -> Value -> m ()
-- If val is a simple value, assign it. If it
-- is deeper, read the subfields and assign to their adjustment

setVal (SUserDefined a _ _) (SUserDefined _ _ _) =
  when (True) (internalError "Unimplemented feature user defined types" (a))
setVal (SReference dst) (SReference src) = do
  t <- getXabiValueType src
  case t of
    SVMType.Array {} -> do
      len <- getInt (Constant $ SReference $ src `apSnoc` MS.Field "length")
      setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger len
      forM_ [0 .. len - 1] $ \i -> do
        let i' = fromIntegral i
        setVal (SReference $ dst `apSnoc` MS.ArrayIndex i')
          =<< getVar (Constant $ SReference $ src `apSnoc` MS.ArrayIndex i')
    _ -> internalError "unimplemented wide copy to storage" (dst, src, t)
setVal (SReference dst) (SStruct _ fs) = do
  forM_ (M.toList fs) $ \(f, var) -> do
    setVal (SReference $ dst `apSnoc` MS.Field (BC.pack $ labelToString f)) =<< weakGetVar var
setVal (SReference dst) (SArray _ fs) = do
  let len = length fs
  setVal (SReference $ dst `apSnoc` MS.Field "length") $ SInteger $ fromIntegral len
  forM_ [0 .. len - 1] $ \i -> do
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
  !t <- getXabiValueType addressedPath -- IMPORTANT: t is not evaulated until it is used, so we use bang pattern to force it to WHNF
  let basicSrc = case src of
        SString s ->
          case t of -- t is evaluated here because Haskell is lazy
          -- We ONLY want to evaluate it if we know src is a SString because
          -- in some non-SString cases getXabiValueType will throw an exception
            SVMType.String {} -> Just . MS.BString . UTF8.fromString $ s
            _ -> toBasic src
        _ -> toBasic src
  case basicSrc of
    Nothing -> typeError "non basic solidity type cannot be stored atomically" src
    Just b -> do
      markDiffForAction addr path b
      putSolidStorageKeyVal' addr path b
setVal (SInteger dst) (SInteger _) = immutableError "Cannot assign immutable or constants after assigned ->" dst -- typeError "Cannot assign immutables after assigned" ("src = " ++ show src ++ ", dst = " ++ show dst)
setVal (SNULL) _ = return ()
setVal dst src = typeError "unknown case called in setVal (Probably tried to change the value of a constant):" ("src = " ++ show src ++ ", dst = " ++ show dst)

weakGetVar :: MonadIO m => Variable -> m Value
weakGetVar (Constant c) = return c
weakGetVar (Variable v) = liftIO $ readIORef v
--fromm variable to value
getVar :: MonadSM m => Variable -> m Value
getVar (Constant (SReference addressedPath@(AccountPath addr key))) = do
  theValue <- getSolidStorageKeyVal' addr key
  case theValue of
    MS.BDefault -> do
      typeHint <- getValueType addressedPath
      case typeHint of
        TStruct _ _ -> return $ SReference addressedPath
        TComplex -> return $ SReference addressedPath
        _ -> return $ findDefault typeHint
    MS.BString bs -> do
      t <- getXabiValueType addressedPath
      case t of
        SVMType.String {} -> return . SString $ UTF8.toString bs
        _ -> return $ fromBasic theValue
    _ -> return $ fromBasic theValue
getVar (Constant (SStruct s ma)) = do
  resolved <-
    mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      ma
  return $ SStruct s resolved
getVar (Constant (SArray typ vc)) = do
  resolved <-
    V.mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      vc
  return $ SArray typ resolved
getVar (Constant (STuple vct)) = do
  resolved <-
    V.mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      vct
  return $ STuple resolved
getVar (Constant (SMap ty mp)) = do
  resolved <-
    mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      mp
  return $ SMap ty resolved
getVar (Constant (SPush v (Just var))) = do
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

getRealNum :: MonadSM m => Variable -> m (Either Integer Decimal)
getRealNum p = do
  v <- getVar p
  case v of
    SInteger s -> return $ Left s
    SDecimal s -> return $ Right s
    _ -> typeError "getRealNum" (p, v)

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
    SVMType.Array {} -> do
      let lengthVar = Constant . SReference $ a `apSnoc` MS.Field "length"
      len <- fromInteger <$> getInt lengthVar
      deleteVar lengthVar
      unless (len <= 0) . for_ [0 .. (len - 1)] $ \i -> do
        let elemPath = a `apSnoc` MS.ArrayIndex i
        deleteVar . Constant $ SReference elemPath
    _ -> do
      -- TODO: handle other types
      ro <- readOnly <$> getCurrentCallInfo
      when ro $ invalidWrite "Invalid delete during read-only access" $ "addr: " ++ show addr ++ ", path: " ++ show path
      markDiffForAction addr path $ MS.BDefault
      putSolidStorageKeyVal' addr path $ MS.BDefault
deleteVar v = todo "deleteVar not yet supported for local variables" $ show v

showSM :: MonadSM m => Value -> m String
showSM SNULL = return "NULL"
showSM (SInteger v) = return $ show v
showSM (SString v) = return v
showSM (SDecimal v) = return $ show v
showSM (SBool v) = return $ show v
showSM (SEnumVal enumName valName num) =
  return $
    printf "%s.%s (= %x)" enumName valName num
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
  return $
    labelToString name ++ "{"
      ++ intercalate ", " (map (\(n, v) -> labelToString n ++ ": " ++ v) valStrings)
      ++ "}"
showSM (SMap _ m) = do
  valStrings <-
    forM (M.toList m) $ \(key, var) -> do
      val <- getVar var
      valString <- showSM val
      keyString <- showSM key
      return (keyString, valString)
  return $
    "{"
      ++ intercalate ", " (map (\(k, v) -> k ++ ": " ++ v) valStrings)
      ++ "}"
showSM (SContract name address) = do
  return $ "Contract: " ++ labelToString name ++ "/" ++ format address
showSM (SReference apt) = return $ "<reference to " ++ show apt ++ ">"
showSM (SBuiltinVariable x) = return $ "<built-in " ++ show x ++ ">"
showSM (SContractFunction maybeContractName address functionName) = do
  contractName <- case maybeContractName of
    Just name -> return name
    Nothing -> do
      contract <- getCurrentContract
      return $ CC._contractName contract
  return $ "Contract function: " ++ labelToString contractName ++ "/" ++ format address ++ "." ++ labelToString functionName
showSM (SVariadic xs) = ('[' :) . (++ "]") . intercalate ", " <$> traverse showSM xs
showSM x = todo "showSM called for unsupported value: " x

jsonSM :: MonadSM m => Value -> m String
jsonSM = go False
  where
    go _ SNULL = return "null"
    go _ (SInteger v) = return $ show v
    go b (SString v) = return $ bool id show b v
    go _ (SBool v) = return $ bool "false" "true" v
    go _ (SEnumVal _ _ num) = return $ show num
    go b (SAccount a _) = return . bool id show b $ show a
    go _ (STuple v) = do
      vals <- mapM getVar (V.toList v)
      strings <- forM vals (go True)
      return $ "[" ++ intercalate ", " strings ++ "]"
    go _ (SArray _ v) = do
      vals <- mapM getVar (V.toList v)
      strings <- forM vals (go True)
      return $ "[" ++ intercalate ", " strings ++ "]"
    go _ (SStruct name m) = do
      valStrings <-
        forM (M.toList m) $ \(n, var) -> do
          val <- getVar var
          valString <- go True val
          return (n, valString)
      return $
        labelToString name ++ "{"
          ++ intercalate ", " (map (\(n, v) -> show (labelToString n) ++ ": " ++ v) valStrings)
          ++ "}"
    go _ (SMap _ m) = do
      valStrings <-
        forM (M.toList m) $ \(key, var) -> do
          val <- getVar var
          valString <- go True val
          keyString <- go True key
          return (keyString, valString)
      return $
        "{"
          ++ intercalate ", " (map (\(k, v) -> k ++ ": " ++ v) valStrings)
          ++ "}"
    go b (SContract _ address) = return . bool id show b $ show address
    go _ (SVariadic xs) = ('[' :) . (++ "]") . intercalate ", " <$> traverse (go True) xs
    go _ (SDecimal v) = return $ show v
    go _ _ = return "undefined"