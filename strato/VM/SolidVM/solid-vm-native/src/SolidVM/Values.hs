{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module SolidVM.Values where

import Blockchain.SolidVM.Exception (SolidException (TypeError, InvalidArguments))
import Blockchain.DB.SolidStorageDB
import qualified Blockchain.Data.BlockHeader as BlockHeader
import qualified Blockchain.SolidVM.Environment as Env
import SolidVM.Storage
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Address
import Control.Applicative
import Control.Lens hiding (unsnoc)
import Control.Monad
import Data.Bool (bool)
import qualified Data.ByteString.Char8 as BC
import Data.Foldable (toList)
import Data.List (unsnoc)
import qualified Data.Map.Strict as M
import qualified Data.Sequence as Q
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import qualified Data.Text.Encoding as TE
import Data.Traversable (for)
import qualified Data.Vector as V
import qualified SolidVM.Compile as N
import qualified SolidVM.Core as N
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Storable (StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import SolidVM.Solidity.StaticAnalysis.Typechecker (showType)
import UnliftIO (throwIO)

resolveArgRef ::
  MonadSM m =>
  Address ->
  CC.Contract ->
  CC.CodeCollection ->
  SVMType.Type ->
  Value ->
  m Value
resolveArgRef src contract cc argType arg = case arg of
  SReference r -> do
    stored <- getStorageValue src r
    case stored of
      SReference _ -> case argType of
        SVMType.Array t' _ -> do
          lenVal <- resolveArgRef src contract cc (SVMType.Int Nothing Nothing) (SReference $ r `MS.snoc` MS.Field "length")
          case lenVal of
            SInteger l' -> do
              elems <- for [0 .. l' - 1] $ \i ->
                resolveArgRef src contract cc t' (SReference $ r `MS.snoc` MS.Index (BC.pack $ show i))
              vars <- traverse createVar elems
              pure . SArray $ V.fromList vars
            _ -> pure $ SArray V.empty
        SVMType.Struct _ s -> do
          case (M.lookup s $ contract ^. CC.structs) <|> (M.lookup s $ cc ^. CC.flStructs) of
            Just defs -> do
              fieldPairs <- for defs $ \(field, t', _) -> do
                fv <- resolveArgRef src contract cc (CC.fieldTypeType t') (SReference $ r `MS.snoc` MS.Field (BC.pack $ labelToString field))
                var <- createVar fv
                pure (field, var)
              pure . SStruct s $ M.fromList fieldPairs
            Nothing -> pure arg
        SVMType.UnknownLabel s -> do
          case (M.lookup s $ contract ^. CC.structs) <|> (M.lookup s $ cc ^. CC.flStructs) of
            Just defs -> do
              fieldPairs <- for defs $ \(field, t', _) -> do
                fv <- resolveArgRef src contract cc (CC.fieldTypeType t') (SReference $ r `MS.snoc` MS.Field (BC.pack $ labelToString field))
                var <- createVar fv
                pure (field, var)
              pure . SStruct s $ M.fromList fieldPairs
            Nothing -> pure arg
        _ -> createDefaultValue cc contract argType
      v' -> pure v'
  SArray vs ->
    let t' = case argType of
               SVMType.Array t'' _ -> t''
               _ -> argType
     in SArray <$> traverse (fmap Constant . resolveArgRef src contract cc t' <=< weakGetVar) vs
  SMap m ->
    let t' = case argType of
               SVMType.Mapping _ _ t'' _ _ -> t''
               _ -> argType
     in SMap <$> traverse (fmap Constant . resolveArgRef src contract cc t' <=< weakGetVar) m
  SStruct n vs -> SStruct n <$> traverse (fmap Constant . resolveArgRef src contract cc argType <=< weakGetVar) vs
  _ -> pure arg

resolveArgRefs ::
  MonadSM m =>
  Address ->
  CC.Contract ->
  CC.CodeCollection ->
  [(Maybe SolidString, CC.IndexedType)] ->
  ValList ->
  m ValList
resolveArgRefs src contract cc argDefs args =
  let go ts'@[(_, CC.IndexedType _ t@SVMType.Variadic _)] (v : vs') = (:) <$> resolveArgRef src contract cc t v <*> go ts' vs'
      go ((_, CC.IndexedType _ t _) : ts') (v : vs') = (:) <$> resolveArgRef src contract cc t v <*> go ts' vs'
      go _ vs' = pure vs'
   in go argDefs args

validateFunctionArguments:: MonadSM m => CC.CodeCollection -> CC.Contract -> CC.Func -> ValList -> m (Maybe (CC.Func, ValList))
validateFunctionArguments cc contract' func argVals = checkFunc $ func : CC._funcOverload func
  where
    checkFunc [] = pure Nothing
    checkFunc (x:xs) = testMatch x >>= \case
      Just argVals' -> pure $ Just (x, argVals')
      Nothing -> checkFunc xs
    argValsLength = length argVals
    testMatch :: MonadSM m => CC.Func -> m (Maybe ValList)
    testMatch tf = mapArgValues tf >>= \case
      Nothing -> pure Nothing
      Just typedValues -> sequence <$> traverse marshalValue typedValues >>= \case
        Just vals' -> pure $ Just vals'
        Nothing -> pure . bool Nothing (Just argVals) $ testValidVariadic tf
    testValidVariadic :: CC.Func -> Bool
    testValidVariadic tf =
      case unsnoc (CC._funcArgs tf) of
        Just ([], (_, x)) | CC.indexedTypeType x == SVMType.Variadic -> True
        Just (xs, (_, x)) | CC.indexedTypeType x == SVMType.Variadic -> argValsLength >= length xs
        _ -> False
    marshalValue :: MonadSM m => (SVMType.Type, Value) -> m (Maybe Value)
    marshalValue (t, v) =
      -- These cases might not be all inclusive of all valid combinations.
      case (v, t) of
        (SInteger i, SVMType.Int _ _) -> pure . Just $ SInteger i
        -- (SInteger i, SVMType.String _) -> pure . Just . SString $ show i
        (SInteger i, SVMType.Address b) -> pure . Just $ SAddress (fromInteger i) b
        (SInteger i, SVMType.UnknownLabel _) -> pure . Just $ SAddress (fromInteger i) False
        (SInteger i, SVMType.Decimal) -> pure . Just . SDecimal $ fromInteger i
        (SDecimal d, SVMType.Decimal) -> pure . Just $ SDecimal d
        (SString s, SVMType.String _) -> pure . Just $ SString s
        (SString s, SVMType.Bytes _ _) -> pure . Just $ SBytes $ DT.encodeUtf8 $ T.pack s
        (SBytes bs, SVMType.Bytes _ _) -> pure . Just $ SBytes bs
        -- (SString s, SVMType.Address b) -> pure $ flip SAddress b <$> stringAddress s
        (SBool b, SVMType.Bool) -> pure . Just $ SBool b
        (SAddress a _, SVMType.Address b) -> pure . Just $ SAddress a b
        -- (SAddress a _, SVMType.String _) -> pure . Just . SString $ show a
        (SAddress a _, SVMType.Int _ _) -> pure . Just . SInteger . fromIntegral $ unAddress a
        (SEnumVal r x y, SVMType.UnknownLabel u) -> pure . bool Nothing (Just $ SEnumVal r x y) $ r == u
        (SStruct r x, SVMType.UnknownLabel u) ->
          -- Allow anonymous structs (empty name) to match any struct type
          if r == stringToLabel "" || r == u
            then pure . Just $ SStruct u x
            else pure Nothing
        (SContract r x, SVMType.UnknownLabel u) -> pure . bool Nothing (Just $ SContract r x) $ r == u
        (SArray vs, SVMType.Array y ml) ->
          if (Just $ V.length vs) `SVMType.maybeEq` (fromIntegral <$> ml)
            then fmap SArray . sequence <$> traverse (fmap (fmap Constant) . marshalValue . (y,) <=< getVar) vs
            else pure Nothing
        (SArray vs, SVMType.Variadic) -> Just . SVariadic . V.toList <$> traverse getVar vs
        (SVariadic x, SVMType.Variadic) -> pure . Just $ SVariadic x
        (SVariadic vs, SVMType.Array y ml) ->
          if (Just $ length vs) `SVMType.maybeEq` (fromIntegral <$> ml)
            then fmap (SArray . V.fromList . map Constant) . sequence <$> traverse (marshalValue . (y,)) vs
            else pure Nothing
        (r@(SReference _), _) -> pure $ Just r
        (SNULL, t') -> Just <$> createDefaultValue cc contract' t'
        _ -> pure Nothing
    mapArgValues :: MonadSM m => CC.FuncF a -> m (Maybe [(SVMType.Type, Value)])
    mapArgValues theFunc =
        let go [(_, CC.IndexedType _ SVMType.Variadic _)] [SVariadic args] = pure $ Just [(SVMType.Variadic, SVariadic args)]
            go [(_, CC.IndexedType _ SVMType.Variadic _)] args = pure $ Just [(SVMType.Variadic, SVariadic args)]
            go nts [SVariadic args] = go nts args
            go nts@(_:_:_) [SArray args] = go nts . V.toList =<< traverse getVar args
            go ((_, CC.IndexedType _ t _):nts) (v:args) = (((t, v):) <$>) <$> go nts args
            go [] [] = pure $ Just []
            go _ _ = pure Nothing
         in go (CC._funcArgs theFunc) argVals

formatArgMismatch :: [(Value, SVMType.Type)] -> String
formatArgMismatch pairs =
  unlines $ zipWith formatOne [1..] pairs
  where
    formatOne :: Int -> (Value, SVMType.Type) -> String
    formatOne n (val, expectedType) =
      "  Argument " ++ show n ++ ": got " ++ valueTypeName val ++ ", expected " ++ T.unpack (showType expectedType)

convertArgs :: M.Map T.Text N.SType -> N.Sig args r -> ValList -> SM [N.Dyn]
convertArgs _ (N.SigNil _) [] = pure []
convertArgs ctx (N.SigCons N.TVariadic (N.SigNil _)) values = do
  addr <- getCurrentAddress
  let remaining = case values of [SVariadic vs] -> vs; _ -> values
  args <- traverse (valueDynAt addr ctx) remaining
  pure [N.Dyn N.TVariadic args]
convertArgs ctx (N.SigCons t rest) (v : vs) =
  (:) <$> (N.Dyn t <$> valueAs ctx t v) <*> convertArgs ctx rest vs
convertArgs _ _ _ = throwIO $ InvalidArguments "function argument count mismatch" "arguments do not match the compiled signature"

valueAs :: M.Map T.Text N.SType -> N.Ty t -> Value -> SM t
valueAs ctx t v = do
  addr <- getCurrentAddress
  valueAsAt addr ctx t v

valueAsAt :: Address -> M.Map T.Text N.SType -> N.Ty t -> Value -> SM t
valueAsAt addr ctx t v = case (t, v) of
  (N.TRaw, STuple vs) -> traverse (valueDynAt addr ctx <=< weakGetVar) (V.toList vs)
  (N.TRaw, _) -> (: []) <$> valueDynAt addr ctx v
  (N.TStr, SString s) -> pure $ T.pack s
  (N.TUnit, SNULL) -> pure ()
  (N.TRef _, SReference p) -> pure p
  (_, SReference p) -> N.readValWith (getSolidStorageKeyVal' addr) t p
  (N.TVariadic, SVariadic vs) -> traverse (valueDynAt addr ctx) vs
  (N.TVariadic, STuple vs) -> traverse (valueDynAt addr ctx <=< weakGetVar) (V.toList vs)
  (N.TVariadic, _) -> (: []) <$> valueDynAt addr ctx v
  (N.TArr et, SArray vs) -> Q.fromList <$> traverse (valueAsAt addr ctx et <=< weakGetVar) (V.toList vs)
  (N.TTuple fields, STuple vs) -> valuesAs addr ctx fields =<< traverse weakGetVar (V.toList vs)
  (N.TTuple fields, SVariadic vs) -> valuesAs addr ctx fields vs
  (N.TStruct _ fields, SStruct _ vs) -> structAs addr ctx fields vs
  (_, SVariadic [single]) -> valueAsAt addr ctx t single
  _ -> do
    block <- BlockHeader.number . Env.blockHeader <$> getEnv
    case toBasic block v >>= either (const Nothing) Just . N.fromBasic t of
      Just result -> pure result
      Nothing -> throwIO $ TypeError "external value does not match the declared type" (show v <> " -> " <> T.unpack (N.showTy t))

isVariadic :: N.Ty t -> Bool
isVariadic N.TVariadic = True
isVariadic N.TRaw = True
isVariadic _ = False

valuesAs :: Address -> M.Map T.Text N.SType -> N.Fields ts -> [Value] -> SM (N.HL ts)
valuesAs _ _ N.FNil [] = pure N.HNil
valuesAs addr ctx (N.FCons _ t rest) (v : vs) = (N.:*) <$> valueAsAt addr ctx t v <*> valuesAs addr ctx rest vs
valuesAs _ _ _ _ = throwIO $ TypeError "external tuple arity mismatch" "returned values do not match the declared type"

structAs :: Address -> M.Map T.Text N.SType -> N.Fields ts -> M.Map T.Text Variable -> SM (N.HL ts)
structAs _ _ N.FNil _ = pure N.HNil
structAs addr ctx (N.FCons name t rest) vs = case M.lookup name vs of
  Just var -> (N.:*) <$> (valueAsAt addr ctx t =<< weakGetVar var) <*> structAs addr ctx rest vs
  Nothing -> throwIO $ TypeError "struct argument is missing a field" (T.unpack name)

valueDynAt :: Address -> M.Map T.Text N.SType -> Value -> SM N.Dyn
valueDynAt addr ctx = \case
  SDecimal v -> pure $ N.Dyn N.TDecimal v
  SInteger v -> pure $ N.Dyn N.TInt v
  SBool v -> pure $ N.Dyn N.TBool v
  SAddress v _ -> pure $ N.Dyn N.TAddr v
  SContract name v -> pure $ N.Dyn (N.TContract name) v
  SString v -> pure $ N.Dyn N.TStr $ T.pack v
  SBytes v -> pure $ N.Dyn N.TBytes v
  SEnumVal name label v -> pure $ N.Dyn (N.TWireEnum name label) (fromIntegral v)
  SStruct name fields -> structDyn name <$> traverse (traverse (valueDynAt addr ctx <=< weakGetVar)) (M.toList fields)
  SArray vs -> N.Dyn N.TWireArray <$> traverse (valueDynAt addr ctx <=< weakGetVar) (V.toList vs)
  STuple vs -> N.Dyn N.TVariadic <$> traverse (valueDynAt addr ctx <=< weakGetVar) (V.toList vs)
  SVariadic vs -> N.Dyn N.TVariadic <$> traverse (valueDynAt addr ctx) vs
  v@(SReference p) -> case referenceType ctx p of
    Right (N.SomeTy t) -> N.Dyn t <$> valueAsAt addr ctx t v
    Left message -> throwIO $ N.Divergence message
  SNULL -> pure $ N.Dyn N.TUnit ()
  v -> throwIO $ N.Divergence $ "unsupported native boundary value: " <> T.pack (show v)

structDyn :: T.Text -> [(T.Text, N.Dyn)] -> N.Dyn
structDyn structName = go (\fields values -> N.Dyn (N.TStruct structName fields) values)
  where
    go :: (forall ts. N.Fields ts -> N.HL ts -> N.Dyn) -> [(T.Text, N.Dyn)] -> N.Dyn
    go build [] = build N.FNil N.HNil
    go build ((name, N.Dyn t v) : rest) =
      go (\fields values -> build (N.FCons name t fields) (v N.:* values)) rest

referenceType :: M.Map T.Text N.SType -> StoragePath -> Either T.Text N.SomeTy
referenceType ctx (StoragePath (Field name : rest)) = do
  st <- maybe (Left "native storage declaration missing") Right $ M.lookup (TE.decodeUtf8 name) ctx
  leaf <- descend st rest
  either (Left . N.showErr) Right $ N.stypeTy leaf
  where
    descend st [] = Right st
    descend (N.SMap _ v) (Index _ : ps) = descend v ps
    descend (N.SArray v) (Index _ : ps) = descend v ps
    descend (N.SArray _) [Field "length"] = Right $ N.SScalar $ N.SomeTy N.TInt
    descend (N.SStruct _ fs) (Field n : ps) =
      maybe (Left "native storage field missing") (\v -> descend v ps) $ lookup (TE.decodeUtf8 n) fs
    descend _ _ = Left "native storage path does not match its declaration"
referenceType _ _ = Left "native storage reference has no declaration"

toValue :: N.Dyn -> SM Value
toValue (N.Dyn t v) = case t of
  N.TDecimal -> pure $ SDecimal v
  N.TInt -> pure $ SInteger v
  N.TBool -> pure $ SBool v
  N.TAddr -> pure $ SAddress v False
  N.TContract name -> pure $ SContract name v
  N.TStr -> pure $ SString $ T.unpack v
  N.TBytes -> pure $ SBytes v
  N.TEnum name names ->
    let i = N.enumNumber v
     in pure $ if N.enumIsNumber v then SInteger i
        else SEnumVal name (if i >= 0 && i < fromIntegral (length names) then names !! fromIntegral i else "") (fromIntegral i)
  N.TWireEnum name label -> pure $ SEnumVal name label (fromIntegral v)
  N.TUnit -> pure SNULL
  N.TRef _ -> pure $ SReference v
  N.TArr et -> SArray . V.fromList . map Constant <$> traverse (toValue . N.Dyn et) (toList v)
  N.TTuple fields -> STuple . V.fromList . map (Constant . snd) <$> fieldsToValues fields v
  N.TStruct name fields -> SStruct name . M.fromList . map (fmap Constant) <$> fieldsToValues fields v
  N.TVariadic -> SVariadic <$> traverse toValue v
  N.TRaw -> case v of
    [] -> pure SNULL
    [value] -> toValue value
    vs -> STuple . V.fromList . map Constant <$> traverse toValue vs
  N.TWireArray -> SArray . V.fromList . map Constant <$> traverse toValue v
  N.TAlias _ _ -> throwIO $ N.Divergence "native alias escaped"
  N.TMaybe _ -> throwIO $ N.Divergence "native internal value escaped"

fieldsToValues :: N.Fields ts -> N.HL ts -> SM [(T.Text, Value)]
fieldsToValues N.FNil N.HNil = pure []
fieldsToValues (N.FCons name t rest) (v N.:* vs) = (:) <$> ((,) name <$> toValue (N.Dyn t v)) <*> fieldsToValues rest vs
