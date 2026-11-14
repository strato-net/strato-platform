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
    assignmentValue,
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
    forceValue,
    enforceUnsignedType,
    typedVariable,
    typedElement,
    typedStructField
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
import Control.Applicative ((<|>))
import Control.Lens ((^.))
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
import qualified SolidVM.Model.Type as SVMType
import qualified SolidVM.Model.CodeCollection as CC
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
  SIntegral i -> Just $ MS.BInteger i
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
setVar (TypedVariable t var) val = enforceUnsignedType t val >>= setVar var

assignmentValue :: MonadSM m => Variable -> Value -> m Variable
assignmentValue destination original = case original of
  SIntegral _ -> Constant <$> case destination of
    TypedVariable typ _ -> enforceUnsignedType typ original
    Constant (SReference key) -> storageValueType key >>= maybe (pure original) (`enforceUnsignedType` original)
    _ -> pure original
  _ -> pure (Constant original)

enforceUnsignedType :: MonadSM m => SVMType.Type -> Value -> m Value
enforceUnsignedType t value = do
  contract <- getCurrentContract
  (_, cc) <- getCurrentCodeCollection
  coerceUnsignedValue contract cc t value

typedVariable :: MonadSM m => SVMType.Type -> Variable -> m Variable
typedVariable t var = pure $ case var of
  TypedVariable existing _ | existing == t -> var
  _ -> TypedVariable t var

typedElement :: MonadSM m => Variable -> Variable -> m Variable
typedElement (TypedVariable (SVMType.Array element _) _) = typedVariable element
typedElement (TypedVariable (SVMType.Mapping _ _ element _ _) _) = typedVariable element
typedElement _ = pure

typedStructField :: MonadSM m => Variable -> SolidString -> SolidString -> Variable -> m Variable
typedStructField parent name field var = do
  contract <- getCurrentContract
  (_, cc) <- getCurrentCodeCollection
  let declared = case parent of
        TypedVariable (SVMType.UnknownLabel n) _ -> n
        TypedVariable (SVMType.Struct _ n) _ -> n
        _ -> name
      (owner, structName) = case T.splitOn "." declared of
        prefix : rest | not (null rest), Just ct <- M.lookup prefix (cc ^. CC.contracts) -> (ct, T.intercalate "." rest)
        _ -> (contract, declared)
      defs = M.lookup structName (owner ^. CC.structs) <|> M.lookup structName (cc ^. CC.flStructs)
      qualify t = case t of
        SVMType.UnknownLabel n | owner ^. CC.contractName /= contract ^. CC.contractName, M.member n (owner ^. CC.structs) -> SVMType.UnknownLabel (owner ^. CC.contractName <> "." <> n)
        SVMType.Array element size -> SVMType.Array (qualify element) size
        _ -> t
      typ = defs >>= lookup field . map (\(n, f, _) -> (n, qualify $ CC.fieldTypeType f))
  maybe (pure var) (`typedVariable` var) typ

storageValueType :: MonadSM m => MS.StoragePath -> m (Maybe SVMType.Type)
storageValueType (MS.StoragePath pieces) = do
  contract <- getCurrentContract
  (_, cc) <- getCurrentCodeCollection
  let descend _ t [] = Just t
      descend owner (SVMType.UserDefined _ actual) rest = descend owner actual rest
      descend owner (SVMType.Mapping _ key element _ _) (MS.Index index : rest) = do
        case (key, readMaybe $ BC.unpack index :: Maybe Integer) of
          (SVMType.Int (Just False) _, Just n) | n < 0 -> arithmeticException "unsigned mapping key underflow" n
          _ -> pure ()
        descend owner element rest
      descend owner (SVMType.Array element _) (MS.Index _ : rest) = descend owner element rest
      descend _ (SVMType.Array _ _) [MS.Field "length"] = Just (SVMType.Int Nothing Nothing)
      descend owner (SVMType.Struct _ name) rest = descend owner (SVMType.UnknownLabel name) rest
      descend _ (SVMType.UnknownLabel name) rest | prefix : names <- T.splitOn "." name, not (null names), Just ct <- M.lookup prefix (cc ^. CC.contracts) =
        descend ct (SVMType.UnknownLabel $ T.intercalate "." names) rest
      descend owner (SVMType.UnknownLabel name) (MS.Field field : rest) = do
        defs <- M.lookup name (owner ^. CC.structs) <|> M.lookup name (cc ^. CC.flStructs)
        typ <- lookup (stringToLabel $ BC.unpack field) [(n, CC.fieldTypeType f) | (n, f, _) <- defs]
        descend owner typ rest
      descend _ _ _ = Nothing
  pure $ case pieces of
    MS.Field name : rest -> do
      def <- M.lookup (stringToLabel $ BC.unpack name) (contract ^. CC.storageDefs)
      descend contract (def ^. CC.varType) rest
    _ -> Nothing

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
  checked <- storageValueType path >>= maybe (pure src) (`enforceUnsignedType` src)
  cci <- getCurrentCallInfo
  let ro = readOnly cci
      addr = currentAddress cci
  when ro $ invalidWrite "Invalid write during read-only access" $ "src: " ++ show src ++ ", dst: " ++ show dst
  basicSrc <- case checked of
    SString s -> pure . Just . MS.BString . UTF8.fromString $ s
    _ -> do
      currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
      pure $ toBasic currentBlockNum checked
  case basicSrc of
    Nothing -> typeError "non basic solidity type cannot be stored atomically" $ show src
    Just b -> do
      markDiffForAction addr path b
      putSolidStorageKeyVal' addr path b
setVal (SIntegral dst) (SIntegral _) = immutableError "Cannot assign immutable or constants after assigned ->" dst -- typeError "Cannot assign immutables after assigned" ("src = " ++ show src ++ ", dst = " ++ show dst)
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
  value <- getStorageValue ca key
  typ <- storageValueType key
  maybe (pure value) (`enforceUnsignedType` value) typ
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
getVar (TypedVariable t v) = do
  value <- getVar v
  case value of
    SArray _ -> pure value
    SMap _ -> pure value
    SStruct _ _ -> pure value
    _ -> enforceUnsignedType t value

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
  SIntegral s -> Right s
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
    SIntegral s -> return $ Left s
    SDecimal s -> return $ Right s
    SNULL -> return $ Left 0
    _ -> typeError "getRealNum" $ show (p, v)

getBool :: MonadSM m => Variable -> m Bool
getBool = getBoolVal <=< getVar

getBoolVal :: MonadSM m => Value -> m Bool
getBoolVal v' = case toNull v' of
  SBool b -> return b
  SIntegral _ -> return True -- integer is guaranteed to not be 0
  SNULL -> return False
  v -> typeError "getBool" $ show v

getAddress :: MonadSM m => Variable -> m Address
getAddress = getAddressVal <=< getVar

getAddressVal :: MonadSM m => Value -> m Address
getAddressVal v' = case toNull v' of
  SIntegral i -> pure $ fromIntegral i
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
  SIntegral i -> pure $ integer2Bytes i
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
