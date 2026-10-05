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

module SolidVM.Storage
  ( setVar,
    getStorageValue,
    getVar,
    getIntEither,
    getIntValEither,
    getInt,
    getIntVal,
    int,
    getRealNum,
    getBool,
    getBoolVal,
    getAddress,
    getAddressVal,
    getString,
    getStringVal,
    getBytes,
    getBytesVal,
    deleteVar,
    toBasic,
    fromBasic,
    showSM,
    forceValue
  )
where

import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.Util
import Blockchain.DB.SolidStorageDB
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Strato.Model.Address
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.UTF8 as UTF8
import Data.Decimal
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8', encodeUtf8)
import qualified Data.Vector as V
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value
import Text.Read (readMaybe)
import UnliftIO

fromBasic :: MS.BasicValue -> Value
fromBasic = \case
  MS.BInteger i -> SInteger i
  MS.BString s -> case decodeUtf8' s of
    Right t -> SString $ T.unpack t
    Left _ -> SString $ BC.unpack s
  MS.BBytes bs -> SBytes bs
  MS.BDecimal v -> SDecimal $ read $ BC.unpack v
  MS.BBool b -> SBool b
  MS.BAddress a -> SAddress a False
  MS.BContract n a -> SContract n a
  MS.BEnumVal k v num -> SEnumVal k v num
  MS.BDefault -> SNULL

toBasic :: Integer -> Value -> Maybe MS.BasicValue
toBasic currentBlockNum = \case
  SInteger i -> Just $ MS.BInteger i
  SString s -> Just . MS.BString . encodeUtf8 $ T.pack s
  SDecimal v -> Just $ MS.BDecimal $ BC.pack $ show v
  SBool b -> Just $ MS.BBool b
  SAddress a _ -> Just $ MS.BAddress a
  SContract n a -> Just $ MS.BContract n a
  SEnumVal k t num -> Just $ MS.BEnumVal k t num
  SUserDefined _ _ x -> toBasic currentBlockNum x
  SBytes bs -> Just $ MS.BBytes bs
  SNULL ->
    let heliumToBasicForkBlock = 33918 :: Integer
        snullToBasicEnabled = not (Conf.networkID (networkConfig ethConf) == 114784819836269 && currentBlockNum < heliumToBasicForkBlock)
     in if snullToBasicEnabled then Just MS.BDefault else Nothing
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
  len <- getInt (Constant $ SReference $ src `MS.snoc` MS.Field "length")
  setVal (SReference $ dst `MS.snoc` MS.Field "length") $ SInteger len
  forM_ [0 .. len - 1] $ \i -> do
    let i' = BC.pack $ show i
    setVal (SReference $ dst `MS.snoc` MS.Index i')
      =<< getVar (Constant $ SReference $ src `MS.snoc` MS.Index i')
setVal (SReference dst) (SStruct _ fs) = do
  forM_ (M.toList fs) $ \(f, var) -> do
    setVal (SReference $ dst `MS.snoc` MS.Field (BC.pack $ labelToString f)) =<< weakGetVar var
setVal (SReference dst) (SArray fs) = do
  let len = length fs
  setVal (SReference $ dst `MS.snoc` MS.Field "length") $ SInteger $ fromIntegral len
  forM_ [0 .. len - 1] $ \i -> do
    let i' = BC.pack $ show i
    elementVal <- getVar $ fs V.! i
    setVal (SReference $ dst `MS.snoc` MS.Index i') elementVal
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
setVal dst@(SReference path) src = do
  cci <- getCurrentCallInfo
  let ro = readOnly cci
      addr = currentAddress cci
  when ro $ invalidWrite "Invalid write during read-only access" $ "src: " ++ show src ++ ", dst: " ++ show dst
  basicSrc <- case src of
    SString s -> pure . Just . MS.BString . UTF8.fromString $ s
    _ -> do
      currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
      pure $ toBasic currentBlockNum src
  case basicSrc of
    Nothing -> typeError "non basic solidity type cannot be stored atomically" $ show src
    Just b -> do
      markDiffForAction addr path b
      putSolidStorageKeyVal' addr path b
setVal (SInteger dst) (SInteger _) = immutableError "Cannot assign immutable or constants after assigned ->" dst -- typeError "Cannot assign immutables after assigned" ("src = " ++ show src ++ ", dst = " ++ show dst)
setVal (SNULL) _ = return ()
setVal dst src = typeError "unknown case called in setVal (Probably tried to change the value of a constant):" ("src = " ++ show src ++ ", dst = " ++ show dst)

getStorageValue :: HasSolidStorageDB m => Address -> MS.StoragePath -> m Value
getStorageValue addr key = do
  theValue <- getSolidStorageKeyVal' addr key
  case theValue of
    MS.BDefault -> pure $ SReference key
    _ -> pure $ fromBasic theValue

--fromm variable to value
getVar :: MonadSM m => Variable -> m Value
getVar (Constant (SReference key)) = do
  ca <- currentAddress <$> getCurrentCallInfo
  getStorageValue ca key
getVar (Constant (SStruct s ma)) = do
  resolved <-
    mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      ma
  return $ SStruct s resolved
getVar (Constant (SArray vc)) = do
  resolved <-
    V.mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      vc
  return $ SArray resolved
getVar (Constant (STuple vct)) = do
  resolved <-
    V.mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      vct
  return $ STuple resolved
getVar (Constant (SMap mp)) = do
  resolved <-
    mapM
      ( \var -> do
          v <- getVar var
          return $ Constant v
      )
      mp
  return $ SMap resolved
getVar (Constant (SPush v (Just var))) = do
  resolved <- getVar var
  return $ SPush v (Just $ Constant resolved)
getVar (Constant v) = return v
getVar (Variable v) = liftIO $ readIORef v

-- | Fully evaluate a value: every nested cell and storage reference is
-- resolved, so the result holds only 'Constant's and can leave the VM.
forceValue :: MonadSM m => Value -> m Value
forceValue = \case
  v@(SReference _) -> do
    v' <- getVar (Constant v)
    case v' of
      SReference _ -> pure v' -- unset storage slot resolves to itself
      _ -> forceValue v'
  SStruct n m -> SStruct n <$> traverse forceVar m
  STuple vs -> STuple <$> traverse forceVar vs
  SArray vs -> SArray <$> traverse forceVar vs
  SMap m -> SMap <$> traverse forceVar m
  v -> pure v
  where
    forceVar var = Constant <$> (getVar var >>= forceValue)

getIntEither :: MonadSM m => Variable -> m (Either Value Integer)
getIntEither p = getIntValEither <$> getVar p

getIntValEither :: Value -> Either Value Integer
getIntValEither v' = case toNull v' of
  SInteger s -> Right s
  SNULL -> Right 0
  v -> Left v

getInt :: MonadSM m => Variable -> m Integer
getInt = either (typeError "getInt" . show) pure <=< getIntEither

getIntVal :: MonadSM m => Value -> m Integer
getIntVal = either (typeError "getIntVal" . show) pure . getIntValEither

int :: MonadSM m => Value -> m Integer
int = getIntVal

getRealNum :: MonadSM m => Variable -> m (Either Integer Decimal)
getRealNum p = do
  v <- getVar p
  case toNull v of
    SInteger s -> return $ Left s
    SDecimal s -> return $ Right s
    SNULL -> return $ Left 0
    _ -> typeError "getRealNum" $ show (p, v)

getBool :: MonadSM m => Variable -> m Bool
getBool = getBoolVal <=< getVar

getBoolVal :: MonadSM m => Value -> m Bool
getBoolVal v' = case toNull v' of
  SBool b -> return b
  SInteger _ -> return True -- integer is guaranteed to not be 0
  SNULL -> return False
  v -> typeError "getBool" $ show v

getAddress :: MonadSM m => Variable -> m Address
getAddress = getAddressVal <=< getVar

getAddressVal :: MonadSM m => Value -> m Address
getAddressVal v' = case toNull v' of
  SInteger i -> pure $ fromIntegral i
  SAddress a _ -> pure a
  SContract _ a -> pure a
  SString s -> case readMaybe s of
    Nothing -> typeError "getAddress" $ show s
    Just a -> pure a
  SBytes b -> pure $ addressFromByteString b
  SNULL -> pure 0
  v -> typeError "getAddress" $ show v

getString :: MonadSM m => Variable -> m String
getString = getStringVal <=< getVar

getStringVal :: MonadSM m => Value -> m String
getStringVal v' = case toNull v' of
  SString s -> pure s
  SBytes b -> case decodeUtf8' b of
    Left _ -> pure $ BC.unpack b
    Right r -> pure $ T.unpack r
  SNULL -> pure ""
  v -> typeError "getString" $ show v

getBytes :: MonadSM m => Variable -> m BC.ByteString
getBytes = getBytesVal <=< getVar

getBytesVal :: MonadSM m => Value -> m BC.ByteString
getBytesVal v' = case toNull v' of
  SInteger i -> pure $ integer2Bytes i
  SAddress a _ -> pure $ addressToByteString a
  SContract _ a -> pure $ addressToByteString a
  SString s -> case B16.decode $ BC.pack s of
    Right r -> pure r
    _ -> pure . encodeUtf8 $ T.pack s
  SBytes b -> pure b
  SNULL -> pure BC.empty
  v -> typeError "getAddress" $ show v

deleteVar :: MonadSM m => Variable -> m ()
deleteVar (Constant (SReference path)) = do
  cci <- getCurrentCallInfo
  let ro = readOnly cci
      addr = currentAddress cci
  when ro $ invalidWrite "Invalid delete during read-only access" $ "addr: " ++ show addr ++ ", path: " ++ show path
  markDiffForAction addr path $ MS.BDefault
  putSolidStorageKeyVal' addr path $ MS.BDefault
deleteVar v = todo "deleteVar not yet supported for local variables" $ show v

-- | Trace/debug text for a value: force it, then use the one renderer.
showSM :: MonadSM m => Value -> m String
showSM = fmap (T.unpack . renderValue) . forceValue
