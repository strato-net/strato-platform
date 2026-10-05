{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, RankNTypes, ScopedTypeVariables,
             LambdaCase, OverloadedStrings, ExistentialQuantification, TupleSections, NamedFieldPuns #-}
-- SolidVM source -> typed Haskell actions.  Typecheck and compile in one pass over the
-- existing parser's CodeCollection.  Strict: no implicit coercions; anything the typed
-- model cannot express is reported as an Err, never approximated.
-- Contract-to-address is a selected compatibility exception (see README.md).
module SolidVM.Compile where

import Control.Exception (throwIO)
import Control.Lens ((^.), (&), (.~))
import Control.Monad
import Control.Monad.Reader
import Data.Bifunctor (first)
import Data.Decimal
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.IORef
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Sequence as Seq
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Type.Equality ((:~:) (Refl))
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import qualified Data.Source.Annotation as SA
import qualified Data.Source.Position as SP
import SolidVM.Model.CodeCollection hiding (DelegateCall, RawCall, Internal)
import qualified SolidVM.Model.CodeCollection.Statement as S
import SolidVM.Model.Storable (BasicValue (BDefault), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as Ty
import SolidVM.Core
import qualified SolidVM.Builtins as Builtins

-- ---------------------------------------------------------------- errors

data ErrKind = TypeError | Unsupported | Unknown | Internal deriving (Eq, Ord, Show)

data Err = Err { eKind :: ErrKind, eMsg :: T.Text, eFun :: T.Text, eLine :: Maybe Int } deriving Show

type C = Either Err

err :: ErrKind -> T.Text -> C a
err k m = Left (Err k m "" Nothing)

typeErr, unsupported, unknown :: T.Text -> C a
typeErr = err TypeError
unsupported = err Unsupported
unknown = err Unknown

atLine :: SA.SourceAnnotation () -> C a -> C a
atLine a = first (\e -> e { eLine = Just (fromMaybe (a ^. SA.sourceAnnotationStart . SP.sourcePositionLine) (eLine e)) })

inFun :: T.Text -> C a -> C a
inFun n = first (\e -> e { eFun = n })

showErr :: Err -> T.Text
showErr Err{eKind, eMsg, eFun, eLine} = T.pack (show eKind) <> " " <> eFun <> maybe "" ((":" <>) . T.pack . show) eLine <> ": " <> eMsg

-- ---------------------------------------------------------------- storage layout

-- The value type of a storage item when read/written whole (fails on mappings).
stypeTy :: SType -> C SomeTy
stypeTy = \case
  SScalar t -> pure t
  SMap{} -> typeErr "a mapping has no value type"
  SArray e -> do SomeTy t <- stypeTy e; pure (SomeTy (TArr t))
  SStruct n fs -> do SomeFields flds <- fieldsOf fs; pure (SomeTy (TStruct n flds))
  where
    fieldsOf :: [(T.Text, SType)] -> C SomeFields
    fieldsOf [] = pure (SomeFields FNil)
    fieldsOf ((n, st) : rest) = do SomeTy t <- stypeTy st; SomeFields fs <- fieldsOf rest; pure (SomeFields (FCons n t fs))

data SomeFields = forall ts. SomeFields (Fields ts)

-- ---------------------------------------------------------------- compile-time context

data SomeSig = forall args r. SomeSig (Sig args r)

data FunEntry = FunEntry (C SomeSig) (C Fun)

data CCtx = CCtx
  { cName :: T.Text
  , cCC :: CodeCollection
  , cContract :: Contract
  , cStorage :: M.Map T.Text SType
  , cFuns :: M.Map T.Text FunEntry      -- knot, keyed "name/arity"; values are lazy (bodied functions + getters)
  , cSigs :: M.Map T.Text (C SomeSig)   -- every declared signature, incl. interface/abstract ones
  }

data Var ls
  = forall t. Var T.Text (Ty t) (Ix ls t)
  | RefVar T.Text SType (Ix ls StoragePath)   -- `T storage x = ...` pointer

data Scope ls r = Scope
  { sVars :: [Var ls]
  , sRet :: Ty r
  , sNamedRet :: [T.Text]              -- named return values (locals)
  , sInner :: Maybe (Env ls -> M (Flow r))   -- body of the function when compiling a modifier
  , sC :: CCtx
  }

pushVar :: T.Text -> Ty t -> Scope ls r -> Scope (t ': ls) r
pushVar n t (Scope vs r nr inner c) =
  Scope (Var n t IZ : map weaken vs) r nr (fmap (\f e -> case e of (_ :& env) -> f env) inner) c

pushRef :: T.Text -> SType -> Scope ls r -> Scope (StoragePath ': ls) r
pushRef n st (Scope vs r nr inner c) =
  Scope (RefVar n st IZ : map weaken vs) r nr (fmap (\f e -> case e of (_ :& env) -> f env) inner) c

weaken :: Var ls -> Var (u ': ls)
weaken (Var n t i) = Var n t (IS i)
weaken (RefVar n st i) = RefVar n st (IS i)

varName :: Var ls -> T.Text
varName (Var n _ _) = n
varName (RefVar n _ _) = n

lookupVar :: Scope ls r -> T.Text -> Maybe (Var ls)
lookupVar sc n = listToMaybe [v | v <- sVars sc, varName v == n]

-- ---------------------------------------------------------------- type resolution

resolveTy :: CCtx -> Ty.Type -> C SomeTy
resolveTy c = \case
  Ty.Int{} -> pure (SomeTy TInt)
  Ty.Bool -> pure (SomeTy TBool)
  Ty.Address{} -> pure (SomeTy TAddr)
  Ty.String{} -> pure (SomeTy TStr)
  Ty.Bytes{} -> pure (SomeTy TBytes)
  Ty.Variadic -> pure (SomeTy TRaw)
  Ty.Enum{Ty.typedef = n} -> enumTy c n
  Ty.Contract{Ty.typedef = n} -> pure (SomeTy (TContract n))
  Ty.UserDefined _ actual -> resolveTy c actual
  Ty.UnknownLabel n -> resolveName c n
  Ty.Struct{Ty.typedef = n} -> stypeTy =<< storageTy c (Ty.UnknownLabel n)
  Ty.Array{Ty.entry = e} -> do SomeTy t <- resolveTy c e; pure (SomeTy (TArr t))
  Ty.Mapping{} -> typeErr "mapping used as a value type"
  Ty.Decimal -> pure (SomeTy TDecimal)
  Ty.Error{} -> unsupported "error type as value"

resolveName :: CCtx -> T.Text -> C SomeTy
resolveName c n
  | Just _ <- lookupEnum c n = enumTy c n
  | M.member n (cCC c ^. contracts) = pure (SomeTy (TContract n))
  | Just _ <- lookupStruct c n = stypeTy =<< storageTy c (Ty.UnknownLabel n)
  | Just alias <- M.lookup n (cContract c ^. userDefined) = resolveName c alias
  | otherwise = unknown ("type " <> n)

lookupEnum :: CCtx -> T.Text -> Maybe [T.Text]
lookupEnum c n = (fst <$> M.lookup n (cContract c ^. enums)) `mplus` (fst <$> M.lookup n (cCC c ^. flEnums))

lookupStruct :: CCtx -> T.Text -> Maybe [(T.Text, FieldType, SA.SourceAnnotation ())]
lookupStruct c n = M.lookup n (cContract c ^. structs) `mplus` M.lookup n (cCC c ^. flStructs)

enumTy :: CCtx -> T.Text -> C SomeTy
enumTy c n = maybe (unknown ("enum " <> n)) (pure . SomeTy . TEnum n) (lookupEnum c n)

storageTy :: CCtx -> Ty.Type -> C SType
storageTy c = \case
  Ty.Mapping{Ty.key = k, Ty.value = v} -> SMap <$> resolveTy c k <*> storageTy c v
  Ty.Array{Ty.entry = e} -> SArray <$> storageTy c e
  Ty.Struct{Ty.typedef = n} -> structTy n
  Ty.UnknownLabel n | Just _ <- lookupStruct c n -> structTy n
  t -> SScalar <$> resolveTy c t
  where
    structTy n = case lookupStruct c n of
      Nothing -> unknown ("struct " <> n)
      Just fs -> SStruct n <$> mapM (\(f, ft, _) -> (f,) <$> storageTy c (fieldTypeType ft)) fs

-- ---------------------------------------------------------------- expressions

data CE ls = forall t. CE (Ty t) (Env ls -> M t)
data LV ls = forall t. LV (Ty t) (Env ls -> M t) (Env ls -> t -> M ())

sameTy :: Ty a -> Ty b -> C (a :~: b)
sameTy a b = maybe (typeErr ("expected " <> showTy a <> ", got " <> showTy b)) pure (tyEq a b)

compileAs :: Scope ls r -> Ty t -> Expression -> C (Env ls -> M t)
compileAs sc t e = atLine (S.extractExpression e) $ case (t, e) of
  -- a tuple/struct literal is typed by its context
  (TTuple fs, S.TupleExpression _ xs) | all isJust xs -> fmap (chargeAfter 1 .) $ compileFields sc fs (catMaybes xs)
  (TStruct _ fs, S.TupleExpression _ xs) | all isJust xs -> fmap (chargeAfter 1 .) $ compileFields sc fs (catMaybes xs)
  (TArr et, S.ArrayExpression _ xs) -> do
    fs <- mapM (compileAs sc et) xs
    pure (\env -> chargeAfter 1 $ Seq.fromList <$> mapM ($ env) fs)
  -- storage pointer: the expression must be a storage location of the same layout
  (TRef st, _) -> do
    (st', pathOf) <- compileStorage sc e
    when (showST st /= showST st') $ typeErr ("storage pointer layout mismatch: " <> showST st <> " vs " <> showST st')
    pure pathOf
  _ -> do
    CE t' f <- compileE sc e
    case (t, t') of
      (TAddr, TContract _) -> pure f
      (TContract _, TAddr) -> pure f
      (TDecimal, TInt) -> pure (fmap fromInteger . f)
      (_, TRaw) -> pure (\env -> f env >>= fromDyn t . Dyn TRaw)
      (TRaw, _) -> pure (fmap (retDyn t') . f)
      (TVariadic, TVariadic) -> pure f
      (TVariadic, _) -> pure (fmap (\v -> [Dyn t' v]) . f)
      (_, TVariadic) -> pure (\env -> f env >>= \ds -> fromDyn t (Dyn TVariadic ds))
      _ -> do Refl <- sameTy t t'; pure f

compileFields :: Scope ls r -> Fields ts -> [Expression] -> C (Env ls -> M (HL ts))
compileFields _ FNil [] = pure (\_ -> pure HNil)
compileFields sc (FCons _ t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileFields sc rest xs
  pure (\env -> (:*) <$> f env <*> k env)
compileFields _ _ _ = typeErr "tuple arity mismatch"

compileE :: Scope ls r -> Expression -> C (CE ls)
compileE sc e = atLine (S.extractExpression e) $ do
  CE t action <- compileE' sc e
  pure $ CE t (chargeAfter 1 . action)

compileE' :: forall ls r. Scope ls r -> Expression -> C (CE ls)
compileE' sc = compileExpression sc True

compileExpression :: forall ls r. Scope ls r -> Bool -> Expression -> C (CE ls)
compileExpression sc chargeDestination e = case e of
  S.NumberLiteral _ n unit -> lit TInt (n * unitMul unit)
  S.BoolLiteral _ b -> lit TBool b
  S.StringLiteral _ s -> lit TStr (T.pack s)
  S.AddressLiteral _ a -> lit TAddr a
  S.HexaLiteral _ h -> case B16.decode (TE.encodeUtf8 h) of
    Right bs -> lit TBytes bs
    Left _ -> typeErr ("bad hex literal " <> h)
  S.DecimalLiteral _ d -> lit TDecimal (S.unwrapDecimal d)
  S.TupleExpression _ [Just x] -> compileE sc x
  S.TupleExpression _ xs | all isJust xs -> do
    ces <- mapM (compileE sc) (catMaybes xs)
    SomeTuple fs k <- tupleOf ces
    pure (CE (TTuple fs) k)
  S.TupleExpression{} -> typeErr "tuple with holes used as a value"
  S.ArrayExpression _ [] -> typeErr "empty array literal needs a typed context"
  S.ArrayExpression _ (x : xs) -> do
    CE et f <- compileE sc x
    fs <- mapM (compileAs sc et) xs
    pure $ CE (TArr et) (\env -> Seq.fromList <$> mapM ($ env) (f : fs))
  S.ObjectLiteral{} -> typeErr "object literal needs a typed context"
  S.FunctionCall _ (S.NewExpression _ Ty.Bytes{} Nothing) [n] -> do
    lf <- compileAs sc TInt n
    pure $ CE TBytes (\env -> (\k -> B.replicate (fromIntegral k) 0) <$> lf env)
  S.FunctionCall _ (S.NewExpression _ ty Nothing) [n] | isArrayTy ty -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- compileAs sc TInt n
        pure $ CE t (\env -> (\k -> Seq.replicate (fromIntegral k) (defaultOf et)) <$> lf env)
      _ -> err Internal "array new"
  S.NewExpression _ ty mLen -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- maybe (pure (\_ -> pure 0)) (compileAs sc TInt) mLen
        pure $ CE t (\env -> (\n -> Seq.replicate (fromIntegral n) (defaultOf et)) <$> lf env)
      TContract _ -> unsupported "contract creation (new)"
      _ -> typeErr ("new " <> showTy t)
  S.InlineBoundsCheck _ lo hi x -> do
    f <- compileAs sc TInt x
    pure $ CE TInt $ \env -> do
      v <- f env
      when (maybe False (v <) lo) $ revert ("underflow: " <> T.pack (show v))
      when (maybe False (v >) hi) $ revert ("overflow: " <> T.pack (show v))
      pure v
  S.Variable _ "this" -> pure $ CE (TContract (cName c)) (\_ -> fThis <$> frame)
  S.Variable _ "now" -> pure $ CE TInt (\_ -> rtTimestamp <$> rt)
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ (TRef _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ t i) -> pure $ CE t (\env -> liftIO (readIORef (ref i env)))
    Just (RefVar{}) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Nothing
      | Just _ <- M.lookup n (cStorage c) -> do LV t g _ <- compileLV sc e; pure (CE t g)
      | Just cd <- M.lookup n (cContract c ^. constants) -> do
          SomeTy t <- resolveTy c (cd ^. constType)
          f <- compileConstant t (cd ^. constInitialVal)
          pure (CE t f)
      | Just cd <- M.lookup n (cCC c ^. flConstants) -> do
          SomeTy t <- resolveTy c (cd ^. constType)
          f <- compileConstant t (cd ^. constInitialVal)
          pure (CE t f)
      | otherwise -> unknown ("variable " <> n)
  S.MemberAccess _ (S.Variable _ "msg") m -> parentMember $ case m of
    "sender" -> pure $ CE TAddr (\_ -> do (runtime, caller) <- ask; liftIO $ rtSender runtime caller)
    "sig" -> pure $ CE TStr (\_ -> fSig <$> frame)
    "value" -> pure $ CE TInt (\_ -> fValue <$> frame)
    "data" -> pure $ CE TVariadic (\_ -> fArgs <$> frame)
    _ -> unsupported ("msg." <> m)
  S.MemberAccess _ (S.Variable _ "tx") "origin" -> parentMember $ pure $ CE TAddr (\_ -> fOrigin <$> frame)
  S.MemberAccess _ (S.Variable _ "block") m -> parentMember $ case m of
    "number" -> pure $ CE TInt (\_ -> rtBlockNumber <$> rt)
    "timestamp" -> pure $ CE TInt (\_ -> rtTimestamp <$> rt)
    _ | m `elem` ["prevProposer", "prevIntendedProposer", "coinbase", "proposer"] -> pure $ CE TAddr $ \_ -> do
          runtime <- rt
          liftIO $ case m of
            "prevProposer" -> (\(a, _, _) -> a) <$> rtPreviousBlock runtime
            "prevIntendedProposer" -> (\(_, a, _) -> a) <$> rtPreviousBlock runtime
            _ -> rtProposer runtime
      | m == "prevRound" -> pure $ CE TInt $ \_ -> do
          runtime <- rt
          liftIO $ (\(_, _, n) -> n) <$> rtPreviousBlock runtime
      | otherwise -> unsupported ("block." <> m)
  S.MemberAccess _ (S.Variable _ en) member
    | Nothing <- lookupVar sc en, Nothing <- M.lookup en (cStorage c), Just names <- lookupEnum c en ->
        case lookup member (zip names [0 ..]) of
          Just i -> parentMember $ lit (TEnum en names) (enumValue i)
          Nothing -> unknown ("enum member " <> en <> "." <> member)
  S.MemberAccess _ (S.Variable _ lib) cn
    | Nothing <- lookupVar sc lib, Nothing <- M.lookup lib (cStorage c), Just libC <- M.lookup lib (cCC c ^. contracts)
    , Just cd <- M.lookup cn (libC ^. constants) -> parentMember $ do
        SomeTy t <- resolveTy c (cd ^. constType)
        f <- compileAs sc { sC = mkCtx (cCC c) libC } t (cd ^. constInitialVal)
        pure (CE t f)
  S.MemberAccess _ x "length" | Right (CE t f) <- compileE sc x, isSeqLike t -> case t of
    TArr _ -> pure $ CE TInt (fmap (fromIntegral . Seq.length) . f)
    TStr -> pure $ CE TInt (fmap (fromIntegral . T.length) . f)
    TBytes -> pure $ CE TInt (fmap (fromIntegral . B.length) . f)
    _ -> err Internal "length"
  S.MemberAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.IndexAccess _ (S.FunctionCall _ (S.Variable _ "getUserCert") args) (Just ix)
    | Nothing <- findFun (cFuns c) "getUserCert" (length args) -> do
        argsF <- compileDynArgs sc args
        _ <- compileAs sc TStr ix
        pure $ CE TStr $ \env -> do
          _ <- argsF env
          Builtins.missingUserCert
  S.IndexAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.FunctionCall _ callee args -> compileCall sc callee args
  S.Unitary _ op x -> case op of
    "!" -> do f <- compileAs sc TBool x; pure $ CE TBool (fmap not . f)
    "-" -> do
      CE t f <- compileE sc x
      case t of
        TDecimal -> pure $ CE TDecimal (fmap negate . f)
        _ -> do Refl <- sameTy TInt t; pure $ CE TInt (fmap negate . f)
    "++" -> incr True x 1
    "--" -> incr True x (-1)
    "~" -> do f <- compileAs sc TInt x; pure $ CE TInt (fmap complement . f)
    "delete" -> do
      (_, pathF) <- compileStorage sc x
      pure $ CE TUnit $ \env -> do
        path <- pathF env
        (runtime, caller) <- ask
        liftIO $ rtPut runtime (fThis caller) path BDefault
    _ -> unsupported ("unary " <> T.pack op)
  S.PlusPlus _ x -> incr False x 1
  S.MinusMinus _ x -> incr False x (-1)
  S.Ternary _ cnd a b -> do
    cf <- compileAs sc TBool cnd
    CE t af <- compileE sc a
    bf <- compileAs sc t b
    pure $ CE t (\env -> cf env >>= \k -> if k then af env else bf env)
  S.Binary _ "=" (S.TupleExpression _ lhss) r -> do
    -- (a, b) = rhs : assign through each l-value (holes skip)
    compileTupleAssignment sc False lhss r
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TAlias t _) i) <- lookupVar sc n -> do
        valueF <- compileAs sc t r
        pure $ CE t $ \env -> do
          value <- valueF env
          when chargeDestination $ chargeGas 1
          liftIO $ writeIORef (ref i env) (Right value)
          pure value
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TRef st) i) <- lookupVar sc n -> do
        (other, pathF) <- compileStorage sc r
        when (showST st /= showST other) $ typeErr "storage alias type mismatch"
        pure $ CE TUnit $ \env -> do
          path <- pathF env
          when chargeDestination $ chargeGas 1
          liftIO $ writeIORef (ref i env) path
  S.Binary _ "=" l r -> compileAssignment sc False chargeDestination l r
  S.Binary _ op l r | Just bop <- T.stripSuffix "=" (T.pack op), bop `elem` ["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>"] -> do
    LV t get set <- compileLV sc l
    case (t, bop) of
      (TDecimal, _) -> do
        rf <- compileAs sc TDecimal r
        f <- decimalOp True (case compileE sc r of Right (CE TDecimal _) -> True; _ -> False) bop
        pure $ CE TDecimal (\env -> do b <- rf env; a <- chargeAfter 1 (get env); void $ chargeAfter 1 (get env); v <- f a b; set env v; pure v)
      (TStr, "+") -> do
        rf <- compileAs sc TStr r
        pure $ CE TStr (\env -> do b <- rf env; a <- chargeAfter 1 (get env); void $ chargeAfter 1 (get env); chargeOp (fromIntegral (T.length a + T.length b)); set env (a <> b); pure (a <> b))
      _ -> do
        Refl <- sameTy TInt t
        rf <- compileAs sc TInt r
        f <- intOp bop
        pure $ CE TInt (\env -> do b <- rf env; a <- chargeAfter 1 (get env); void $ chargeAfter 1 (get env); v <- f a b; set env v; pure v)
  S.Binary _ op l r -> binop (T.pack op) l r
  where
    c = sC sc

    compileConstant :: Ty t -> Expression -> C (Env ls -> M t)
    compileConstant t initial = case initial of
      S.NumberLiteral{} -> literalConstant t initial
      S.AddressLiteral{} -> literalConstant t initial
      _ -> compileAs sc t initial

    literalConstant :: Ty t -> Expression -> C (Env ls -> M t)
    literalConstant t initial = do
      CE source f <- compileE' sc initial
      case (t, source) of
        (TDecimal, TInt) -> pure (fmap fromInteger . f)
        (TContract _, TAddr) -> pure f
        _ -> do Refl <- sameTy t source; pure f

    parentMember compiled = do
      CE t action <- compiled
      pure $ CE t (charged 1 . action)

    lit :: Ty t -> t -> C (CE ls)
    lit t v = pure (CE t (\_ -> pure v))

    isArrayTy :: Ty.Type -> Bool
    isArrayTy = \case Ty.Array{} -> True; _ -> False

    isSeqLike :: Ty t -> Bool
    isSeqLike = \case TArr _ -> True; TStr -> True; TBytes -> True; _ -> False

    incr :: Bool -> Expression -> Integer -> C (CE ls)
    incr prefix x d = do
      Destination t prepare <- compileDestination sc True x
      Refl <- sameTy TInt t
      pure $ CE TInt $ \env -> do
        (_, get, set) <- prepare env
        v <- get
        let next = v + d
        set next
        pure (if prefix then next else v)

    binop :: T.Text -> Expression -> Expression -> C (CE ls)
    binop op l r
      | op `elem` ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"] = do
          CE lt lf <- compileE sc l
          case (lt, op) of
            (TDecimal, _) -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp True (isDecimal r) op
              pure $ CE TDecimal $ \env -> do
                when (op `elem` ["/", "%"]) $ rf env >>= \b -> when (b == 0) (revert "division by zero")
                a <- lf env; b <- rf env; f a b
            (TInt, _) | Right (CE TDecimal _) <- compileE sc r -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp False True op
              pure $ CE TDecimal $ \env -> do
                when (op `elem` ["/", "%"]) $ rf env >>= \b -> when (b == 0) (revert "division by zero")
                a <- lf env; b <- rf env; f (fromInteger a) b
            (TStr, "+") -> do rf <- compileAs sc TStr r; pure $ CE TStr (\env -> do a <- lf env; b <- rf env; chargeOp (fromIntegral (T.length a + T.length b)); pure (a <> b))
            (TBytes, "+") -> do rf <- compileAs sc TBytes r; pure $ CE TBytes (\env -> do a <- lf env; b <- rf env; chargeOp (fromIntegral (B.length a + B.length b)); pure (a <> b))
            _ -> do
              Refl <- sameTy TInt lt
              rf <- compileAs sc TInt r
              f <- intOp op
              pure $ CE TInt $ \env -> do
                when (op `elem` ["/", "%"]) $ rf env >>= \b -> when (b == 0) (revert "division by zero")
                a <- lf env; b <- rf env; f a b
      | op `elem` ["==", "!="] = do
          CE lt lf <- compileE sc l
          rf <- compileAs sc lt r
          eq <- eqOn lt
          let k = if op == "==" then id else not
          pure $ CE TBool (\env -> do a <- lf env; b <- rf env; pure (k (eq a b)))
      | op `elem` ["<", ">", "<=", ">="] = do
          let cmp :: Ord a => a -> a -> Bool
              cmp a b = case op of "<" -> a < b; ">" -> a > b; "<=" -> a <= b; _ -> a >= b
          if isDecimal l || isDecimal r then do
            lf <- compileAs sc TDecimal l
            rf <- compileAs sc TDecimal r
            pure $ CE TBool (\env -> cmp <$> lf env <*> rf env)
          else do
            lf <- compileAs sc TInt l
            rf <- compileAs sc TInt r
            pure $ CE TBool (\env -> cmp <$> lf env <*> rf env)
      | op == "&&" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (\env -> lf env >>= \a -> if a then rf env else pure False)
      | op == "||" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (\env -> lf env >>= \a -> if a then pure True else rf env)
      | otherwise = unsupported ("operator " <> op)

    isDecimal x = case compileE sc x of Right (CE TDecimal _) -> True; _ -> False

    eqOn :: Ty t -> C (t -> t -> Bool)
    eqOn = \case
      TDecimal -> pure (==); TInt -> pure (==); TBool -> pure (==); TAddr -> pure (==); TStr -> pure (==); TBytes -> pure (==)
      TEnum _ _ -> pure (==); TContract _ -> pure (==)
      t -> typeErr ("no equality on " <> showTy t)

decimalOp :: Bool -> Bool -> T.Text -> C (Decimal -> Decimal -> M Decimal)
decimalOp leftDecimal rightDecimal op = do
  operation <- decimalOp' op
  pure $ \a b -> do
    let places = fromIntegral (max (decimalPlaces a) (decimalPlaces b))
        bytes = if op == "/"
          then if leftDecimal && rightDecimal then max (byteWidth (decimalMantissa a)) (byteWidth (decimalMantissa b)) else byteWidth (decimalMantissa a)
          else integerOpBytes op (decimalMantissa a) (decimalMantissa b)
    chargeOp (places + bytes)
    operation a b

decimalOp' :: T.Text -> C (Decimal -> Decimal -> M Decimal)
decimalOp' op = case op of
  "+" -> pure (rounded (+))
  "-" -> pure (rounded (-))
  "*" -> pure (rounded (*))
  "/" -> pure $ \a b -> if b == 0 then revert "division by zero" else rounded (/) a b
  _ -> unsupported ("decimal operator " <> op)
  where
    rounded f a b = pure $ roundTo (max (decimalPlaces a) (decimalPlaces b)) (f a b)

data SomeTuple ls = forall ts. SomeTuple (Fields ts) (Env ls -> M (HL ts))

tupleOf :: [CE ls] -> C (SomeTuple ls)
tupleOf [] = pure (SomeTuple FNil (\_ -> pure HNil))
tupleOf (CE t f : rest) = do
  SomeTuple fs k <- tupleOf rest
  pure (SomeTuple (FCons "" t fs) (\env -> (:*) <$> f env <*> k env))

compileTupleAssignment :: forall ls r. Scope ls r -> Bool -> [Maybe Expression] -> Expression -> C (CE ls)
compileTupleAssignment sc destinationFirst lhss rhs = do
  CE t valueF <- compileE sc rhs
  case t of
    TStruct _ fs -> assignment fs valueF
    TTuple fs -> assignment fs valueF
    _ -> typeErr ("destructuring a non-tuple " <> showTy t)
  where
    assignment :: Fields ts -> (Env ls -> M (HL ts)) -> C (CE ls)
    assignment fs valueF = do
      prepare <- tupleSetters sc fs lhss
      pure $ CE TUnit $ \env -> do
        let destination = chargeAfter 1 (prepare env)
        (set, values) <- if destinationFirst
          then (,) <$> destination <*> valueF env
          else do values <- valueF env; set <- destination; pure (set, values)
        set values

tupleSetters :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Env ls -> M (HL ts -> M ()))
tupleSetters _ FNil [] = pure (\_ -> pure (\_ -> pure ()))
tupleSetters sc (FCons _ t rest) (mx : xs) = do
  prepare <- case mx of
    Nothing -> pure (\_ -> pure (\_ -> pure ()))
    Just x -> do
      Destination lt location <- compileDestination sc True x
      Refl <- sameTy lt t
      pure (\env -> do (_, _, set) <- location env; pure set)
  remaining <- tupleSetters sc rest xs
  pure $ \env -> do
    set <- prepare env
    next <- remaining env
    pure (\hl -> case hl of (v :* vs) -> set v >> next vs)
tupleSetters _ _ _ = typeErr "destructuring arity mismatch"

integerOpBytes :: T.Text -> Integer -> Integer -> Integer
integerOpBytes op a b = case op of
  "+" -> 1 + max (byteWidth a) (byteWidth b)
  "-" -> 1 + max (byteWidth a) (byteWidth b)
  "*" -> byteWidth a + byteWidth b
  "/" -> byteWidth a
  "%" -> byteWidth b
  "**" -> byteWidth a * b
  "<<" -> byteWidth a + b
  ">>" -> byteWidth a
  _ -> max (byteWidth a) (byteWidth b)

intOp :: T.Text -> C (Integer -> Integer -> M Integer)
intOp op = do
  operation <- intOp' op
  pure $ \a b -> chargeOp (integerOpBytes op a b) >> operation a b

intOp' :: T.Text -> C (Integer -> Integer -> M Integer)
intOp' = \case
  "+" -> pure (\a b -> pure (a + b))
  "-" -> pure (\a b -> pure (a - b))
  "*" -> pure (\a b -> pure (a * b))
  "/" -> pure (\a b -> if b == 0 then revert "division by zero" else pure (a `div` b))
  "%" -> pure (\a b -> if b == 0 then revert "modulo by zero" else pure (a `rem` b))
  "**" -> pure (\a b -> if b < 0 then revert "negative exponent" else pure (a ^ b))
  "|" -> pure (\a b -> pure (a .|. b))
  "&" -> pure (\a b -> pure (a .&. b))
  "^" -> pure (\a b -> pure (xor a b))
  "<<" -> pure (\a b -> pure (shiftL a (fromIntegral b)))
  ">>" -> pure (\a b -> pure (shiftR a (fromIntegral b)))
  op -> unsupported ("operator " <> op)

unitMul :: Maybe S.NumberUnit -> Integer
unitMul = \case
  Nothing -> 1; Just S.Wei -> 1; Just S.Szabo -> 10 ^ (12 :: Int); Just S.Finney -> 10 ^ (15 :: Int); Just S.Ether -> 10 ^ (18 :: Int)

-- ---------------------------------------------------------------- l-values

data ALV ls = forall t. ALV (Ty t) (Env ls -> M (Maybe StoragePath)) (Env ls -> M t) (Env ls -> t -> M ())

compileAliasLV :: Scope ls r -> Expression -> C (ALV ls)
compileAliasLV sc expression = case expression of
  S.Variable _ name | Just (Var _ (TAlias t _) i) <- lookupVar sc name ->
    pure $ ALV t
      (\env -> either Just (const Nothing) <$> liftIO (readIORef (ref i env)))
      (\env -> liftIO (readIORef (ref i env)) >>= either (readVal t) pure)
      (\env value -> liftIO $ writeIORef (ref i env) (Right value))
  S.MemberAccess _ parent field -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    case t of
      TStruct _ fields -> do
        SomeIx ft i <- fieldIx fields field
        pure $ ALV ft
          (\env -> fmap (`snocP` Field (TE.encodeUtf8 field)) <$> pathOf env)
          (\env -> hget i <$> get env)
          (\env value -> get env >>= set env . hset i value)
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    indexF <- compileAs sc TInt index
    case t of
      TArr et -> pure $ ALV et
        (\env -> pathOf env >>= \case
          Nothing -> pure Nothing
          Just path -> do
            i <- indexF env
            pure $ Just $ snocP path (Index (BC.pack (show i))))
        (\env -> do
          values <- get env
          i <- indexF env
          maybe (revert "alias array index out of bounds") pure (Seq.lookup (fromIntegral i) values))
        (\env value -> do
          values <- get env
          i <- indexF env
          when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "alias array index out of bounds"
          set env (Seq.update (fromIntegral i) value values))
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileLV :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLV sc e | Right (ALV originalTy pathOf _ set) <- compileAliasLV sc e = do
  Destination t prepare <- compileAliasDestination sc False e
  Refl <- sameTy originalTy t
  pure $ LV t
    (\env -> do (_, get, _) <- prepare env; get)
    (\env value -> pathOf env >>= maybe (set env value) (\path -> writeVal t path value))
compileLV sc e = atLine (S.extractExpression e) $ case e of
  S.InlineBoundsCheck _ lo hi x -> do
    LV t get set <- compileLV sc x
    Refl <- sameTy TInt t
    pure $ LV TInt (chargeAfter 1 . get) $ \env v -> do
      when (maybe False (v <) lo) $ revert ("underflow: " <> T.pack (show v))
      when (maybe False (v >) hi) $ revert ("overflow: " <> T.pack (show v))
      set env v
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notRef t ->
    pure $ LV t (\env -> liftIO (readIORef (ref i env))) (\env v -> liftIO (writeIORef (ref i env) v))
  -- field of a struct *value* (memory): read-modify-write the whole parent
  S.MemberAccess _ p f | Right (LV pt get set) <- valueLV p, TStruct _ fs <- pt -> do
    SomeIx t ix <- fieldIx fs f
    pure $ LV t (\env -> hget ix <$> get env) (\env v -> get env >>= set env . hset ix v)
  -- element of an array / bytes *value*
  S.IndexAccess _ p (Just ix) | Right (LV pt get set) <- valueLV p, isIndexable pt -> do
    kf <- compileAs sc TInt ix
    case pt of
      TArr et -> do
        let bounds n i = when (i < 0 || i >= fromIntegral (Seq.length n)) $ revert ("index out of bounds: " <> T.pack (show i))
        pure $ LV et (\env -> do xs <- get env; i <- kf env; bounds xs i; pure (Seq.index xs (fromIntegral i)))
                    (\env v -> do xs <- get env; i <- kf env; bounds xs i; set env (Seq.update (fromIntegral i) v xs))
      TBytes -> do
        let bounds bs i = when (i < 0 || i >= fromIntegral (B.length bs)) $ revert ("index out of bounds: " <> T.pack (show i))
        pure $ LV TInt (\env -> do bs <- get env; i <- kf env; bounds bs i; pure (fromIntegral (B.index bs (fromIntegral i))))
                      (\env v -> do bs <- get env; i <- kf env; bounds bs i
                                    let (a, b) = B.splitAt (fromIntegral i) bs
                                    set env (a <> B.singleton (fromIntegral v) <> B.drop 1 b))
      _ -> err Internal "indexable"
  _ -> do
    (st, pathOf) <- compileStorage' sc e
    case st of
      SScalar (SomeTy t) -> pure $ LV t (\env -> pathOf env >>= readSlot t) (\env v -> pathOf env >>= \p -> writeSlot t p v)
      SMap{} -> typeErr "mapping used as a value"
      _ -> do
        SomeTy t <- stypeTy st
        pure $ LV t (\env -> pathOf env >>= readVal t) (\env v -> pathOf env >>= \p -> writeVal t p v)
  where
    notRef :: Ty t -> Bool
    notRef = \case TRef _ -> False; _ -> True
    isIndexable :: Ty t -> Bool
    isIndexable = \case TArr _ -> True; TBytes -> True; _ -> False
    -- the parent as a *value*: a local, or any r-value (call result...) which is then read-only
    valueLV :: Expression -> C (LV ls)
    valueLV x
      | isStorageRooted x = typeErr "storage location where a value was expected"
      | otherwise = case x of
          S.Variable _ n | Just (Var{}) <- lookupVar sc n -> chargedParent x
          S.MemberAccess{} -> chargedParent x
          S.IndexAccess{} -> chargedParent x
          _ -> do CE t g <- compileE sc x; pure (LV t g (\_ _ -> diverge "assignment to a temporary"))
    chargedParent x = do
      LV t get set <- compileLV sc x
      pure $ LV t (chargeAfter 1 . get) set
    isStorageRooted :: Expression -> Bool
    isStorageRooted = \case
      S.Variable _ n -> case lookupVar sc n of
        Just (Var _ (TRef _) _) -> True
        Just (Var{}) -> False
        Just (RefVar{}) -> True
        Nothing -> M.member n (cStorage (sC sc))
      fc@S.FunctionCall{} -> case compileE sc fc of Right (CE (TRef _) _) -> True; _ -> False
      S.MemberAccess _ p _ -> isStorageRooted p
      S.IndexAccess _ p _ -> isStorageRooted p
      S.InlineBoundsCheck _ _ _ p -> isStorageRooted p
      _ -> False

data SomeIx ts = forall t. SomeIx (Ty t) (Ix ts t)

fieldIx :: Fields ts -> T.Text -> C (SomeIx ts)
fieldIx FNil f = unknown ("struct field " <> f)
fieldIx (FCons n t rest) f
  | n == f = pure (SomeIx t IZ)
  | otherwise = do SomeIx t' i <- fieldIx rest f; pure (SomeIx t' (IS i))

compileStorage :: Scope ls r -> Expression -> C (SType, Env ls -> M StoragePath)
compileStorage sc expression = do
  (st, action) <- compileStorage' sc expression
  pure (st, case expression of
    S.FunctionCall{} -> action
    _ -> chargeAfter 1 . action)

compileStorage' :: Scope ls r -> Expression -> C (SType, Env ls -> M StoragePath)
compileStorage' sc = \case
  S.InlineBoundsCheck _ _ _ expression -> compileStorage sc expression
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ st) i) -> pure (st, \env -> liftIO (readIORef (ref i env)) >>= either pure (const (diverge "memory value used as storage pointer")))
    Just (RefVar _ st i) -> pure (st, \env -> liftIO (readIORef (ref i env)))
    Just (Var _ (TRef st) i) -> pure (st, \env -> liftIO (readIORef (ref i env)))
    Just (Var{}) -> typeErr ("local value " <> n <> " used where a storage location is required")
    Nothing -> case M.lookup n (cStorage (sC sc)) of
      Just st -> pure (st, \_ -> pure (StoragePath [Field (TE.encodeUtf8 n)]))
      Nothing -> unknown ("storage variable " <> n)
  -- a call returning a storage pointer
  e@(S.FunctionCall{}) -> do
    CE t f <- compileE sc e
    case t of
      TRef st -> pure (st, f)
      _ -> typeErr ("call result of type " <> showTy t <> " used where a storage location is required")
  S.IndexAccess _ p (Just ix) -> do
    (st, pp) <- compileStorage sc p
    case st of
      SMap (SomeTy k) v -> do
        kf <- compileAs sc k ix
        pure (v, \env -> do _ <- pp env; ps <- pp env; key <- kf env; pure (snocP ps (encodeKey k key)))
      SArray el -> do
        kf <- compileAs sc TInt ix
        pure (el, \env -> do
          _ <- pp env; ps <- pp env; i <- kf env
          pure (snocP ps (Index (BC.pack (show i)))))
      _ -> typeErr "index into a non-mapping"
  S.IndexAccess _ _ Nothing -> typeErr "empty index"
  S.MemberAccess _ p f -> do
    (st, pp) <- compileStorage sc p
    case st of
      SStruct _ fs | Just ft <- lookup f fs -> pure (ft, \env -> (`snocP` Field (TE.encodeUtf8 f)) <$> pp env)
                   | otherwise -> unknown ("struct field " <> f)
      SArray _ | f == "length" -> pure (SScalar (SomeTy TInt), \env -> (`snocP` Field "length") <$> pp env)
      _ -> typeErr ("member " <> f <> " of a non-struct storage value")
  e -> unsupported ("storage reference " <> T.take 60 (T.pack (show (() <$ e))))

-- Resolve the destination before writing, so gas is charged at lookup rather
-- than during a setter that may otherwise re-evaluate an index or parent.
data Destination ls = forall t. Destination (Ty t) (Env ls -> M (Maybe StoragePath, M t, t -> M ()))

compileDestination :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestination sc metered expression = case expression of
  S.InlineBoundsCheck _ lo hi inner -> do
    Destination t prepare <- compileDestination sc True inner
    Refl <- sameTy TInt t
    pure $ Destination TInt $ \env -> do
      location@(_, get, _) <- prepare env
      value <- get
      when (maybe False (value <) lo) $ revert ("underflow: " <> T.pack (show value))
      when (maybe False (value >) hi) $ revert ("overflow: " <> T.pack (show value))
      when metered $ chargeGas 1
      pure location
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notReference t ->
    pure $ Destination t $ \env -> do
      when metered $ chargeGas 1
      pure (Nothing, liftIO (readIORef (ref i env)), liftIO . writeIORef (ref i env))
  _ | Right _ <- compileAliasLV sc expression -> compileAliasDestination sc metered expression
  _ | Right (st, pathOf) <- compileStorage' sc expression -> do
    SomeTy t <- stypeTy st
    pure $ Destination t $ \env -> do
      path <- pathOf env
      when metered $ chargeGas 1
      pure (Just path, readVal t path, writeVal t path)
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileDestination sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ \env -> do
          (_, get, set) <- prepare env
          when metered $ chargeGas 1
          pure (Nothing, hget i <$> get, \value -> get >>= set . hset i value)
      _ -> typeErr "destination member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileDestination sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ \env -> do
        (_, get, set) <- prepare env
        i <- indexF env
        values <- get
        when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "index out of bounds"
        when metered $ chargeGas 1
        pure (Nothing, maybe (revert "index out of bounds") pure . Seq.lookup (fromIntegral i) =<< get,
          \value -> get >>= set . Seq.update (fromIntegral i) value)
      TBytes -> pure $ Destination TInt $ \env -> do
        (_, get, set) <- prepare env
        i <- indexF env
        bytes <- get
        when (i < 0 || i >= fromIntegral (B.length bytes)) $ revert "index out of bounds"
        when metered $ chargeGas 1
        pure (Nothing, fromIntegral . (`B.index` fromIntegral i) <$> get,
          \value -> do
            bytes' <- get
            let (before, after) = B.splitAt (fromIntegral i) bytes'
            set (before <> B.singleton (fromIntegral value) <> B.drop 1 after))
      _ -> typeErr "destination index into a non-array"
  _ -> do
    LV t get set <- compileLV sc expression
    pure $ Destination t $ \env -> do
      when metered $ chargeGas 1
      pure (Nothing, get env, set env)
  where
    notReference :: Ty t -> Bool
    notReference = \case TRef _ -> False; TAlias{} -> False; _ -> True

compileAliasDestination :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileAliasDestination sc metered expression = case expression of
  S.Variable _ name | Just (Var _ (TAlias t _) i) <- lookupVar sc name ->
    pure $ Destination t $ \env -> do
      value <- liftIO $ readIORef (ref i env)
      when metered $ chargeGas 1
      pure $ case value of
        Left path -> (Just path, readVal t path, writeVal t path)
        Right current -> (Nothing, pure current, liftIO . writeIORef (ref i env) . Right)
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ \env -> do
          (parentPath, get, set) <- prepare env
          when metered $ chargeGas 1
          pure $ case parentPath of
            Just path -> let child = snocP path (Field (TE.encodeUtf8 field))
              in (Just child, readVal t child, writeVal t child)
            Nothing -> (Nothing, hget i <$> get, \value -> get >>= set . hset i value)
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ \env -> do
        initial@(parentPath, _, _) <- prepare env
        (path, get, set) <- maybe (pure initial) (const (prepare env)) parentPath
        i <- indexF env
        location <- case path of
          Just storage -> let child = snocP storage (Index (BC.pack (show i)))
            in pure (Just child, readVal t child, writeVal t child)
          Nothing -> do
            values <- get
            when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "alias array index out of bounds"
            pure (Nothing, maybe (revert "alias array index out of bounds") pure . Seq.lookup (fromIntegral i) =<< get,
              \value -> get >>= set . Seq.update (fromIntegral i) value)
        when metered $ chargeGas 1
        pure location
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileAssignment :: Scope ls r -> Bool -> Bool -> Expression -> Expression -> C (CE ls)
compileAssignment sc destinationFirst metered l r = do
  let indexedMemory = case l of
        S.IndexAccess _ _ _ -> case compileStorage sc l of Left _ -> True; _ -> False
        _ -> False
  Destination t prepare <- compileDestination sc (metered && not indexedMemory) l
  extraParent <- case l of
    S.IndexAccess _ parent _ | not indexedMemory -> do
      (_, parentF) <- compileStorage sc parent
      pure (void . parentF)
    _ -> pure (\_ -> pure ())
  case compileStorage sc r of
    Right (SScalar (SomeTy sourceTy), sourceF) -> do
      _ <- compileAs sc t r
      pure $ CE t $ \env -> do
        let source = do
              path <- sourceF env
              (runtime, caller) <- ask
              basic <- liftIO $ rtGet runtime (fThis caller) path
              value <- either diverge pure (fromBasic sourceTy basic) >>= fromDyn t . Dyn sourceTy
              pure (path, basic, value)
        (location, (path, basic, value)) <- if destinationFirst
          then (,) <$> prepare env <*> source
          else do src <- source; extraParent env; dst <- prepare env; pure (dst, src)
        case location of
          (Just destination, _, _) -> do
            (runtime, caller) <- ask
            liftIO $ case basic of
              BDefault -> rtCopyStorage runtime destination path
              _ -> rtPut runtime (fThis caller) destination basic
          (_, _, set) -> set value
        pure value
    _ -> do
      valueF <- compileAs sc t r
      let addressValue :: Bool
          addressValue = case (t, compileE sc r) of
            (TContract _, Right (CE TAddr _)) -> True
            _ -> False
      pure $ CE t $ \env -> do
        (location, value) <- if destinationFirst
          then (,) <$> prepare env <*> valueF env
          else do value <- valueF env; extraParent env; location <- prepare env; pure (location, value)
        case (location, addressValue) of
          ((Just path, _, _), True) -> case t of
            TContract _ -> writeSlot TAddr path value
            _ -> diverge "contract assignment witness"
          ((_, _, set), _) -> set value
        pure value

-- ---------------------------------------------------------------- calls

compileCall :: forall ls r. Scope ls r -> Expression -> [Expression] -> C (CE ls)
compileCall sc callee args = case callee of
  S.Variable _ "require" -> requireLike "require"
  S.Variable _ "assert" -> requireLike "assert"
  S.Variable _ "revert" -> case args of
    [] -> pure $ CE TUnit (\_ -> revert "")
    [m] -> do mf <- compileAs sc TStr m; pure $ CE TUnit (\env -> mf env >>= revert)
    _ -> typeErr "revert takes at most one argument"
  S.Variable _ "keccak256" -> case args of
    [x] | Right (CE TBytes f) <- compileE sc x -> pure $ CE TBytes (fmap (keccak256ToByteString . hash) . f)
    _ -> builtinCall TStr "keccak256"
  S.Variable _ n | n `elem` ["create", "create2", "ecrecover"] -> builtinCall TAddr n
  S.Variable _ n | n `elem` ["addmod", "mulmod"] -> builtinCall TInt n
  S.Variable _ "selfdestruct" -> builtinCall TBool "selfdestruct"
  S.MemberAccess _ (S.Variable _ "abi") "encodePacked" -> builtinCall TBytes "abiEncodePacked"
  S.MemberAccess _ (S.Variable _ "abi") "encode" -> builtinCall TBytes "abiEncode"
  S.MemberAccess _ target "derive" -> deriveCall target
  S.Variable _ "derive" -> deriveCall (S.Variable (S.extractExpression callee) "this")
  S.Variable _ n | Just k <- castTarget n -> cast k
  S.Variable _ n | Just names <- lookupEnum c n -> case args of
    [x] -> do f <- compileAs sc TInt x
              pure $ CE (TEnum n names) $ \env -> do v <- f env
                                                     when (v < 0 || v >= fromIntegral (length names)) $ revert ("enum out of range: " <> T.pack (show v))
                                                     pure (enumValue v)
    _ -> typeErr "enum conversion takes one argument"
  S.Variable _ n | Just _ <- lookupStruct c n -> do
    SomeTy t <- resolveName c n
    case t of
      TStruct _ fs -> do f <- compileFields sc fs args; pure (CE t f)
      _ -> err Internal "struct type"
  S.Variable _ n | M.member n (cCC c ^. contracts) -> case args of
    [x] -> do CE t f <- compileE sc x
              case t of
                TAddr -> pure (CE (TContract n) (chargeAfter 500 . f))
                TContract _ -> pure (CE (TContract n) (chargeAfter 500 . f))
                _ -> typeErr ("cannot convert " <> showTy t <> " to contract " <> n)
    _ -> typeErr "contract conversion takes one argument"
  S.Variable _ n | Just fe <- findFun (cFuns c) n (length args) -> linkCall fe
  S.Variable _ n | Just f <- M.lookup n (cCC c ^. flFuncs), length (f ^. funcArgs) == length args ->
    linkCall (FunEntry (funSig c f) (compileFunction c n f))
  S.Variable _ n -> unknown ("function " <> key n)
  S.MemberAccess _ (S.Variable _ "super") n -> linkCall =<< superEntry c n (length args)
  S.MemberAccess _ (S.Variable _ lib) n
    | Nothing <- lookupVar sc lib, Nothing <- M.lookup lib (cStorage c), Just libC <- M.lookup lib (cCC c ^. contracts) ->
        -- library / contract-qualified internal call, compiled in the library's own context
        maybe (unknown ("function " <> lib <> "." <> key n)) linkCall (findFun (cFuns (mkCtx (cCC c) libC)) n (length args))
  S.MemberAccess _ target "call" -> lowLevel RawCall target
  S.MemberAccess _ target "delegatecall" -> lowLevel DelegateCall target
  S.MemberAccess _ target "push" -> case compileStorage sc target of
    Right (SArray el, pp) -> do
        SomeTy et <- stypeTy el
        vf <- case args of
          [] -> pure (\_ -> pure (defaultOf et))
          [x] -> compileAs sc et x
          _ -> typeErr "push takes at most one argument"
        pure $ CE TInt $ \env -> do
          v <- vf env; _ <- pp env; ps <- pp env
          n <- readSlot TInt (snocP ps (Field "length"))
          writeSlot TInt (snocP ps (Field "length")) (n + 1)
          writeVal et (snocP ps (Index (BC.pack (show n)))) v
          pure (n + 1)
    Right _ -> typeErr "push on a non-array"
    Left _ -> do
      -- a local array is a Seq: push is a typed snoc, returns the new length
      LV tt get set <- compileLV sc target
      case tt of
        TArr et -> do
          vf <- case args of
            [] -> pure (\_ -> pure (defaultOf et))
            [x] -> compileAs sc et x
            _ -> typeErr "push takes at most one argument"
          pure $ CE TInt $ \env -> do v <- vf env; chargeGas 1; xs <- chargeAfter 1 (get env); set env (xs Seq.|> v); pure (fromIntegral (Seq.length xs + 1))
        _ -> typeErr ("push on " <> showTy tt)
  S.MemberAccess _ target m -> do
    CE tt tf <- compileE sc target
    case tt of
      TContract cn | Nothing <- usingLib tt m -> externalCall cn tf m
      TAddr | m == "balance" -> unsupported "address.balance"
      TDecimal | m == "truncate", [places] <- args -> do
        placesF <- compileAs sc TInt places
        pure $ CE TDecimal (\env -> do n <- placesF env; value <- tf env; pure $ roundTo' truncate (fromInteger n) value)
      _ -> case usingLib tt m of
        Just (lib, fe) -> do
          -- `using L for T`: x.f(args) == L.f(x, args)
          SomeSig sig <- (\(FunEntry es _) -> es) fe
          case sig of
            SigCons t0 rest -> do
              Refl <- sameTy t0 tt
              let FunEntry _ efun = fe
              CE rt' k <- applyCall sc rest (\env -> do x <- tf env; chargeGas 1; pure (link sig efun x)) args
              pure (CE rt' k)
            SigNil _ -> typeErr ("library function " <> lib <> "." <> m <> " takes no arguments")
        Nothing -> unsupported ("method " <> m <> " on " <> showTy tt)
  S.NewExpression _ ty mSalt -> do
    saltF <- traverse (\salt -> do CE st sf <- compileE sc salt; pure (\env -> Dyn st <$> sf env)) mSalt
    SomeTy t <- resolveTy c ty
    case t of
      TContract n -> do
        target <- maybe (unknown ("contract " <> n)) pure (M.lookup n (cCC c ^. contracts))
        SomeSig sig <- maybe (pure (SomeSig (SigNil TUnit))) (funSig (mkCtx (cCC c) target)) (target ^. constructor)
        argsF <- typedArgs sig args
        pure $ CE t $ \env -> do
          state@(runtime, caller) <- ask
          liftIO $ rtCreate runtime caller n ((\sf -> runReaderT (sf env) state) <$> saltF) (runReaderT (argsF env) state)
      _ -> typeErr ("call of new " <> showTy t)
  _ -> unsupported "call of a computed function"
  where
    c = sC sc
    key n = n <> "/" <> T.pack (show (length args))

    linkCall :: FunEntry -> C (CE ls)
    linkCall (FunEntry esig efun) = do
      SomeSig sig <- esig
      applyCall sc sig (\_ -> do
        let getter = case callee of
              S.Variable _ n -> M.member n (cStorage c) && not (M.member n (cContract c ^. functions))
              _ -> False
            hasParent = case callee of S.MemberAccess{} -> True; _ -> False
        when hasParent $ chargeGas 1 >> chargeGas 1
        pure (linkWithCharge (not getter) sig efun)) args

    -- `using L for T` lookup: first library whose f/(1+n) exists and whose first param matches
    usingLib :: Ty t -> T.Text -> Maybe (T.Text, FunEntry)
    usingLib tt m = listToMaybe
      [ (lib, fe)
      | u <- cContract c ^. usings ++ cCC c ^. flUsings
      , let lib = u ^. usingContract
      , Just libC <- [M.lookup lib (cCC c ^. contracts)]
      , Just fe@(FunEntry (Right (SomeSig (SigCons t0 _))) _) <- [M.lookup (m <> "/" <> T.pack (show (1 + length args))) (cFuns (mkCtx (cCC c) libC))]
      , isJust (tyEq t0 tt) ]

    requireLike :: T.Text -> C (CE ls)
    requireLike nm = case args of
      [x] -> do f <- compileAs sc TBool x; pure $ CE TUnit (\env -> f env >>= \b -> unless b (revert nm))
      [x, m] -> do f <- compileAs sc TBool x; mf <- compileAs sc TStr m
                   pure $ CE TUnit (\env -> do b <- f env; message <- mf env; unless b (revert message))
      _ -> typeErr (nm <> " takes one or two arguments")

    castTarget :: T.Text -> Maybe T.Text
    castTarget n
      | n `elem` ["address", "payable"] = Just "address"
      | n `elem` ["bool", "string", "bytes", "decimal", "variadic"] = Just n
      | "uint" `T.isPrefixOf` n || "int" `T.isPrefixOf` n = Just "int"
      | "bytes" `T.isPrefixOf` n = Just "bytes"
      | otherwise = Nothing

    cast :: T.Text -> C (CE ls)
    cast "variadic" = do
      f <- dynArgs args
      pure $ CE TVariadic f
    cast "string" | [x] <- args = do
      CE t f <- compileE sc x
      case t of
        TStr -> pure $ CE TStr f
        TAddr -> pure $ CE TStr (fmap (T.pack . show) . f)
        TInt -> pure $ CE TStr (fmap (T.pack . show) . f)
        TBool -> pure $ CE TStr (fmap (\v -> if v then "true" else "false") . f)
        _ -> builtinCall TStr "string"
    cast k | k `elem` ["string", "decimal"] = do
      SomeTy t <- castTy k
      builtinCall t k
    cast k = case args of
      [x] -> do
        CE t f <- compileE sc x
        case (k, t) of
          ("address", TAddr) -> pure (CE TAddr f)
          ("address", TContract _) -> pure (CE TAddr f)
          ("address", TStr) -> builtinCall TAddr "address"
          ("address", TBytes) -> builtinCall TAddr "address"
          ("int", TDecimal) -> builtinCall TInt "int"
          ("int", TStr) -> builtinCall TInt "int"
          ("address", TInt) -> pure (CE TAddr (fmap (Address . fromIntegral) . f))
          ("int", TInt) -> pure (CE TInt f)
          ("int", TEnum _ _) -> pure (CE TInt (fmap enumNumber . f))
          ("int", TAddr) -> pure (CE TInt (fmap (\(Address a) -> fromIntegral a) . f))
          ("int", TBytes) -> pure (CE TInt (fmap (B.foldl' (\acc w -> acc * 256 + fromIntegral w) 0) . f))
          ("bytes", TInt) -> pure (CE TBytes (fmap intToBytes32 . f))
          ("bytes", TStr) -> pure (CE TBytes (fmap TE.encodeUtf8 . f))
          ("bytes", TBytes) -> pure (CE TBytes f)
          ("bool", TBool) -> pure (CE TBool f)
          -- explicit conversion out of the dynamic world: checked once at runtime
          (_, TVariadic) -> do
            SomeTy target <- castTy k
            pure $ CE target $ \env -> f env >>= \case
              [d] -> fromDyn target d
              ds -> diverge ("converting " <> T.pack (show (length ds)) <> " dynamic values to " <> showTy target)
          (_, TRaw) -> do
            SomeTy target <- castTy k
            pure $ CE target (\env -> f env >>= fromDyn target . Dyn TRaw)
          _ -> typeErr ("cannot convert " <> showTy t <> " to " <> k)
      _ -> typeErr "conversion takes one argument"

    castTy :: T.Text -> C SomeTy
    castTy = \case
      "address" -> pure (SomeTy TAddr); "int" -> pure (SomeTy TInt); "bool" -> pure (SomeTy TBool)
      "decimal" -> pure (SomeTy TDecimal); "string" -> pure (SomeTy TStr); "bytes" -> pure (SomeTy TBytes); k -> unknown ("type " <> k)

    deriveCall target = do
      addressF <- compileAs sc TAddr target
      argsF <- dynArgs args
      pure $ CE TAddr $ \env -> do
        ds <- argsF env
        address <- addressF env
        Builtins.derive address ds

    builtinCall :: Ty t -> T.Text -> C (CE ls)
    builtinCall t name = do
      action <- maybe (unknown ("builtin " <> name)) pure (Builtins.lookupAction name)
      f <- dynArgs args
      pure $ CE t $ \env -> do
        ds <- f env
        case callee of S.MemberAccess _ (S.Variable _ "abi") _ -> chargeGas 1 >> chargeGas 1; _ -> pure ()
        action ds >>= fromDyn t

    lowLevel :: CallKind -> Expression -> C (CE ls)
    lowLevel kind target = do
      CE tt tf <- compileE sc target
      addrOf <- (case tt of
        TAddr -> pure tf
        TContract _ -> pure tf
        _ -> typeErr (".call on " <> showTy tt)) :: C (Env ls -> M Address)
      (nameE, rest) <- case args of
        (x : xs) -> pure (x, xs)
        [] -> typeErr ".call needs a function name"
      CE nameTy nameF <- compileE sc nameE
      argsF <- dynArgs rest
      case nameTy of
        TStr -> pure $ CE TRaw $ \env -> do
          n <- nameF env; ds <- argsF env; a <- addrOf env
          (r, f) <- ask
          liftIO (rtCall r kind f a n ds (Just (SomeTy TRaw)))
        _ -> pure $ CE TRaw $ \env -> do
          n <- nameF env; ds <- argsF env; _ <- addrOf env
          Builtins.invalidLowLevel (Dyn nameTy n : ds)

    externalCall :: T.Text -> (Env ls -> M Address) -> T.Text -> C (CE ls)
    externalCall cn addrOf m = do
      target <- maybe (unknown ("contract " <> cn)) pure (M.lookup cn (cCC c ^. contracts))
      esig <- maybe (unknown ("function " <> cn <> "." <> key m)) pure (findSig (cSigs (mkCtx (cCC c) target)) m (length args))
      SomeSig sig <- esig
      argsF <- typedArgs sig args
      let r = sigRet sig
      pure $ CE r $ \env -> do
        ds <- argsF env; _ <- addrOf env; a <- addrOf env
        (rt', f) <- ask
        out <- liftIO (rtCall rt' Call f a m ds (Just (SomeTy r)))
        case r of
          TUnit -> pure ()
          TRaw -> pure out
          TVariadic -> pure out
          _ -> case out of
            [d] -> fromDyn r d
            _ -> fromDyn r (Dyn TVariadic out)

    typedArgs :: Sig args r' -> [Expression] -> C (Env ls -> M [Dyn])
    typedArgs = compileTypedArgs sc

    dynArgs = compileDynArgs sc

compileTypedArgs :: Scope ls r -> Sig args r' -> [Expression] -> C (Env ls -> M [Dyn])
compileTypedArgs _ (SigNil _) [] = pure (\_ -> pure [])
compileTypedArgs sc (SigCons TVariadic (SigNil _)) xs | not (singleVariadic xs) = compileDynArgs sc xs
  where
    singleVariadic [x] = case compileE sc x of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
compileTypedArgs sc (SigCons t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileTypedArgs sc rest xs
  pure (\env -> (:) <$> (Dyn t <$> f env) <*> k env)
compileTypedArgs _ _ _ = typeErr "argument count mismatch"

compileDynArgs :: Scope ls r -> [Expression] -> C (Env ls -> M [Dyn])
compileDynArgs sc [x] = do
  CE t f <- compileE sc x
  pure $ case t of
    TVariadic -> f
    TRaw -> \env -> f env >>= \values -> pure $ case values of
      [Dyn TVariadic remaining] -> remaining
      _ -> [Dyn TRaw values]
    _ -> \env -> (: []) . Dyn t <$> f env
compileDynArgs sc xs = do
  fs <- forM xs $ \x -> do CE t f <- compileE sc x; pure (\env -> Dyn t <$> f env)
  pure $ \env -> mapM ($ env) fs >>= \values -> pure $ case reverse values of
    Dyn TVariadic remaining : rest -> reverse rest ++ remaining
    Dyn TRaw [Dyn TVariadic remaining] : rest -> reverse rest ++ remaining
    _ -> values

-- exact "name/arity" first, else a declaration whose last parameter is `variadic`
findSig :: M.Map T.Text (C SomeSig) -> T.Text -> Int -> Maybe (C SomeSig)
findSig m n k = M.lookup (n <> "/" <> T.pack (show k)) m `mplus` listToMaybe
  [es | (key', es@(Right (SomeSig sig))) <- M.toList m, T.takeWhile (/= '/') key' == n, variadicTail sig, sigArity sig - 1 <= k]

findFun :: M.Map T.Text FunEntry -> T.Text -> Int -> Maybe FunEntry
findFun m n k = M.lookup (n <> "/" <> T.pack (show k)) m `mplus` listToMaybe
  [fe | (key', fe@(FunEntry (Right (SomeSig sig)) _)) <- M.toList m, T.takeWhile (/= '/') key' == n, variadicTail sig, sigArity sig - 1 <= k]

variadicTail :: Sig args r -> Bool
variadicTail (SigCons TVariadic (SigNil _)) = True
variadicTail (SigCons _ rest) = variadicTail rest
variadicTail (SigNil _) = False

intToBytes32 :: Integer -> B.ByteString
intToBytes32 n = B.pack [fromIntegral (shiftR n (8 * i) .&. 0xff) | i <- [31, 30 .. 0]]

-- Evaluate arguments left to right into the exactly typed action.
applyCall :: Scope ls r -> Sig args r' -> (Env ls -> M (Fn args r')) -> [Expression] -> C (CE ls)
applyCall sc sig mf expressions = do
  arguments <- callArguments sc sig expressions
  pure $ CE (sigRet sig) $ \env -> do
    values <- arguments env
    f <- mf env
    apply sig f values
  where
    apply :: Sig as result -> Fn as result -> HL as -> M result
    apply (SigNil _) action HNil = action
    apply (SigCons _ rest) f (value :* values) = apply rest (f value) values

callArguments :: Scope ls r -> Sig args r' -> [Expression] -> C (Env ls -> M (HL args))
callArguments _ (SigNil _) [] = pure (\_ -> pure HNil)
callArguments sc (SigCons TVariadic (SigNil _)) expressions
  | not (singleVariadic expressions) = do
      -- a trailing `variadic` parameter absorbs the remaining arguments
      arguments <- compileDynArgs sc expressions
      pure $ \env -> (:* HNil) <$> arguments env
  where
    singleVariadic [expression] = case compileE sc expression of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
callArguments sc (SigCons t rest) (expression : expressions) = do
  value <- compileAs sc t expression
  remaining <- callArguments sc rest expressions
  pure $ \env -> (:*) <$> value env <*> remaining env
callArguments _ _ _ = typeErr "argument count mismatch"

-- Link a call site to the callee once; the signature was already checked against the AST,
-- so the mismatch branch is unreachable.  A callee that failed to compile throws when called.
link :: Sig args r -> C Fun -> Fn args r
link sig = linkWithCharge True sig

linkWithCharge :: Bool -> Sig args r -> C Fun -> Fn args r
linkWithCharge metered sig = \case
  Right (Fun n sig' f) | Just Refl <- sigEq sig sig' -> typedReturns sig (internalFrame n sig (if metered then chargeFunction sig f else f))
  Right (Fun n _ _) -> throwFn sig ("internal: linked signature mismatch for " <> n)
  Left e -> throwFn sig ("callee failed to compile: " <> showErr e)

chargeFunction :: Sig args r -> Fn args r -> Fn args r
chargeFunction (SigNil _) action = charged 5 action
chargeFunction (SigCons _ rest) f = \value -> chargeFunction rest (f value)

throwFn :: Sig args r -> T.Text -> Fn args r
throwFn (SigNil _) msg = diverge msg
throwFn (SigCons _ rest) msg = \_ -> throwFn rest msg

-- super.f: first parent (declaration order) that has f; its body is compiled in the *current*
-- contract's context, i.e. internal calls inside it dispatch virtually (Solidity semantics).
superEntry :: CCtx -> T.Text -> Int -> C FunEntry
superEntry c n arity = do
  let ps = mapMaybe (\p -> M.lookup p (cCC c ^. contracts)) (cContract c ^. parents)
      cands = [(p, f') | p <- ps, Just f <- [M.lookup n (p ^. functions)], f' <- f : (f ^. funcOverload), length (f' ^. funcArgs) == arity, isJust (f' ^. funcContents)]
  case cands of
    ((parent, f) : _) ->
      let parentCtx = mkCtx (cCC c) parent
       in pure (FunEntry (funSig parentCtx f) (compileFunction parentCtx ("super." <> n) f))
    [] -> unknown ("super." <> n)

-- ---------------------------------------------------------------- functions

isStoragePtr :: IndexedType -> Bool
isStoragePtr it = indexedTypeLocation it == Just S.Storage && case indexedTypeType it of
  Ty.Mapping{} -> True; Ty.Array{} -> True; Ty.Struct{} -> True; Ty.UnknownLabel{} -> True; _ -> False

paramTy :: CCtx -> IndexedType -> C SomeTy
paramTy c it
  | isStoragePtr it = SomeTy . TRef <$> storageTy c (indexedTypeType it)
  | otherwise = resolveTy c (indexedTypeType it)

funSig :: CCtx -> Func -> C SomeSig
funSig c f = do
  SomeTy r <- case f ^. funcVals of
    [] -> pure (SomeTy TUnit)
    [(_, it)] -> paramTy c it
    vals -> do SomeFields fs <- fieldsOf vals; pure (SomeTy (TTuple fs))
  go r (f ^. funcArgs)
  where
    go :: Ty r -> [(Maybe T.Text, IndexedType)] -> C SomeSig
    go r [] = pure (SomeSig (SigNil r))
    go r ((_, it) : rest) = do
      SomeTy t <- case indexedTypeType it of
        Ty.Variadic -> pure (SomeTy TVariadic)
        _ -> paramTy c it
      SomeSig s <- go r rest
      pure (SomeSig (SigCons t s))
    fieldsOf :: [(Maybe T.Text, IndexedType)] -> C SomeFields
    fieldsOf [] = pure (SomeFields FNil)
    fieldsOf ((n, it) : rest) = do
      SomeTy t <- resolveTy c (indexedTypeType it)
      SomeFields fs <- fieldsOf rest
      pure (SomeFields (FCons (fromMaybe "" n) t fs))

-- Scope with the parameters as typed locals (first parameter at IZ); storage pointers carry their layout.
paramScope :: CCtx -> Sig args r -> [T.Text] -> Scope args r
paramScope c (SigNil r) _ = Scope [] r [] Nothing c
paramScope c (SigCons t rest) (n : ns) = pushVar n t (paramScope c rest ns)
paramScope c (SigCons t rest) [] = pushVar "" t (paramScope c rest [])

compileFunction :: CCtx -> T.Text -> Func -> C Fun
compileFunction c name f = inFun (cName c <> "." <> name) $ do
  SomeSig sig <- funSig c f
  body <- maybe (unsupported "function without a body") pure (f ^. funcContents)
  let argNames = [fromMaybe "" n | (n, _) <- f ^. funcArgs]
      sc0 = paramScope c sig argNames
      r = sigRet sig
  let names = [n | (Just n, _) <- f ^. funcVals, not (T.null n)]
  inner <- case (r, names) of
    -- a single named return value is a local initialised to its default
    (_, [rn]) | [_] <- f ^. funcVals -> do
      k <- withModifiers (pushVar rn r sc0) { sNamedRet = [rn] } (f ^. funcModifiers) body
      pure $ \env -> do
        rr <- liftIO (newIORef (defaultOf r))
        k (rr :& env) >>= \case
          Next -> Ret <$> liftIO (readIORef rr)
          flow -> pure flow
    -- several named return values: locals, gathered by a bare `return`
    (TTuple fs, _ : _ : _) | length names == fieldsLen fs -> namedReturns sc0 fs names (f ^. funcModifiers) body
    _ -> withModifiers sc0 (f ^. funcModifiers) body
  pure $ Fun name sig $ mkFn sig $ \env -> inner env >>= \case
    Ret v -> pure v
    RetDynamic ds -> liftIO $ throwIO $ ForwardReturn ds
    _ -> pure (defaultOf r)

-- Push each named return value as a local; `return;` reads them back as a tuple.
namedReturns :: forall ls ts. Scope ls (HL ts) -> Fields ts -> [T.Text] -> [(T.Text, [Expression])] -> [Statement] -> C (Env ls -> M (Flow (HL ts)))
namedReturns sc0 fs0 names mods body = go sc0 fs0 names
  where
    go :: forall ls' us. Scope ls' (HL ts) -> Fields us -> [T.Text] -> C (Env ls' -> M (Flow (HL ts)))
    go sc FNil [] = do
      k <- withModifiers sc { sNamedRet = names } mods body
      gather <- gatherNamed sc fs0 names
      pure $ \env -> k env >>= \case
        Next -> Ret <$> gather env
        flow -> pure flow
    go sc (FCons _ t rest) (n : ns) = do
      k <- go (pushVar n t sc) rest ns
      pure $ \env -> do rr <- liftIO (newIORef (defaultOf t)); k (rr :& env)
    go _ _ _ = typeErr "named return arity"

-- Read the named return locals back into the tuple (used by a bare `return`).
gatherNamed :: Scope ls r -> Fields ts -> [T.Text] -> C (Env ls -> M (HL ts))
gatherNamed _ FNil [] = pure (\_ -> pure HNil)
gatherNamed sc (FCons _ t rest) (n : ns) = do
  case lookupVar sc n of
    Just (Var _ vt i) -> do
      Refl <- sameTy t vt
      k <- gatherNamed sc rest ns
      pure (\env -> (:*) <$> liftIO (readIORef (ref i env)) <*> k env)
    _ -> unknown ("named return " <> n)
gatherNamed _ _ _ = typeErr "named return arity"

-- Modifiers apply left to right, the first being outermost.
withModifiers :: Scope ls r -> [(T.Text, [Expression])] -> [Statement] -> C (Env ls -> M (Flow r))
withModifiers sc [] body = compileBlock sc body
withModifiers sc ((mn, margs) : rest) body = do
  inner <- withModifiers sc rest body
  case M.lookup mn (cCC (sC sc) ^. contracts) of
    Just parent -> case parent ^. constructor of
      Nothing | null margs -> pure inner
      Nothing -> typeErr ("base constructor " <> mn <> " argument count mismatch")
      Just ctor -> do
        let parentCtx = mkCtx (cCC (sC sc)) parent
        SomeSig sig <- funSig parentCtx ctor
        fun <- compileFunction parentCtx "constructor" ctor
        CE _ call <- applyCall sc sig (\_ -> pure $ link sig (Right fun)) margs
        pure $ \env -> call env >> inner env
    Nothing -> withModifier sc mn margs inner

withModifier :: Scope ls r -> T.Text -> [Expression] -> (Env ls -> M (Flow r)) -> C (Env ls -> M (Flow r))
withModifier sc mn margs inner = do
  modi <- maybe (unknown ("modifier " <> mn)) pure (M.lookup mn (cContract (sC sc) ^. modifiers))
  mbody <- maybe (unsupported "modifier without a body") pure (modi ^. modifierContents)
  when (length margs /= length (modi ^. modifierArgs)) $ typeErr ("modifier " <> mn <> " argument count mismatch")
  params <- forM (zip (modi ^. modifierArgs) margs) $ \((pn, it), e) -> do
    SomeTy t <- resolveTy (sC sc) (indexedTypeType it)
    pure (pn, SomeTy t, e)
  let r = sRet sc
      -- hidden slot: a `return` inside the body is stashed here by `_` and the modifier continues
      sc1 = (pushVar "$rawRet" (TMaybe TVariadic) (pushVar "$ret" (TMaybe r) sc))
        { sInner = Just (\e -> case e of (_ :& _ :& env) -> inner env) }
  k <- withParams sc1 params $ \sc2 -> do
    bodyK <- compileBlock sc2 mbody
    retSlot <- maybe (err Internal "lost $ret") pure (lookupVar sc2 "$ret")
    case retSlot of
      Var _ (TMaybe rt') ix -> do
        Refl <- sameTy r rt'
        pure $ \env -> bodyK env >>= \case
          Ret v -> pure (Ret v)
          RetDynamic ds -> pure (RetDynamic ds)
          _ -> case lookupVar sc2 "$rawRet" of
            Just (Var _ (TMaybe TVariadic) rawIx) -> liftIO (readIORef (ref rawIx env)) >>= \case
              Just ds -> pure (RetDynamic ds)
              Nothing -> liftIO (readIORef (ref ix env)) >>= \case
                Just v -> pure (Ret v)
                Nothing -> pure Next
            _ -> diverge "lost modifier dynamic return slot"
      _ -> err Internal "$ret has the wrong type"
  pure $ \env -> do
    slot <- liftIO (newIORef Nothing)
    rawSlot <- liftIO (newIORef Nothing)
    k (rawSlot :& slot :& env)

-- Push a list of typed parameters (evaluated in the enclosing scope) and continue.
withParams :: Scope ls r -> [(T.Text, SomeTy, Expression)] -> (forall ls'. Scope ls' r -> C (Env ls' -> M a)) -> C (Env ls -> M a)
withParams sc [] k = k sc
withParams sc ((n, SomeTy t, e) : ps) k = do
  ve <- compileAs sc t e
  rest <- withParams (pushVar n t sc) ps k
  pure $ \env -> do v <- ve env; rr <- liftIO (newIORef v); rest (rr :& env)

-- ---------------------------------------------------------------- statements

compileBlock :: Scope ls r -> [Statement] -> C (Env ls -> M (Flow r))
compileBlock _ [] = pure (\_ -> pure Next)
compileBlock sc statements@(_ : _) = do
  action <- compileBlockStatements sc statements
  pure $ \env -> charged 1 (action env)

compileBlockStatements :: Scope ls r -> [Statement] -> C (Env ls -> M (Flow r))
compileBlockStatements _ [] = pure (\_ -> pure Next)
compileBlockStatements sc (s : rest) = case s of
  S.SimpleStatement (S.VariableDefinition [S.VarDefEntry (Just ty) loc n _] mInit) a -> atLine a $
    if loc == Just S.Storage || implicitStorageAlias sc mInit
      then do
        st <- storageTy (sC sc) ty
        initE <- maybe (typeErr "storage pointer needs an initialiser") pure mInit
        (st', pathOf) <- compileStorage sc initE
        when (showST st /= showST st') $ typeErr ("storage pointer type mismatch: " <> showST st <> " vs " <> showST st')
        case st of
          SStruct{} | loc /= Just S.Storage -> do
            SomeTy t <- stypeTy st
            k <- compileBlock (pushVar n (TAlias t st) sc) rest
            pure $ \env -> do p <- pathOf env; rr <- liftIO (newIORef (Left p)); k (rr :& env)
          _ -> do
            k <- compileBlock (pushVar n (TRef st) sc) rest
            pure $ \env -> do p <- pathOf env; rr <- liftIO (newIORef p); k (rr :& env)
      else do
        SomeTy t <- resolveTy (sC sc) ty
        initF <- maybe (pure (\_ -> pure (defaultOf t))) (compileAs sc t) mInit
        k <- compileBlock (pushVar n t sc) rest
        pure $ \env -> do v <- initF env; rr <- liftIO (newIORef v); k (rr :& env)
  S.SimpleStatement (S.VariableDefinition [S.VarDefEntry Nothing _ _ _] _) a -> atLine a (unsupported "untyped `var` declaration")
  S.SimpleStatement (S.VariableDefinition entries (Just initE)) a -> atLine a $ do
    -- (T1 a, T2 b) = rhs
    CE rt' rf <- compileE sc initE
    case rt' of
      TStruct _ fs -> do
        k <- destructure sc fs entries rest
        pure $ \env -> rf env >>= k env
      TTuple fs -> do
        k <- destructure sc fs entries rest
        pure $ \env -> rf env >>= k env
      TRaw -> do
        k <- destructureRaw sc entries rest
        pure $ \env -> rf env >>= k env
      _ -> typeErr ("destructuring a non-tuple " <> showTy rt')
  S.SimpleStatement (S.VariableDefinition _ Nothing) a -> atLine a (typeErr "tuple declaration without an initialiser")
  _ -> do
    sf <- compileStmt sc s
    k <- compileBlock sc rest
    pure $ \env -> sf env >>= \case
      Next -> k env
      fl -> pure fl

implicitStorageAlias :: Scope ls r -> Maybe Expression -> Bool
implicitStorageAlias sc (Just expression) = case compileStorage sc expression of
  Right (SStruct{}, _) -> True
  Right (SArray{}, _) -> True
  Right (SMap{}, _) -> True
  _ -> False
implicitStorageAlias _ Nothing = False

-- Declare each tuple component as a typed local (blank entries are skipped), then continue.
destructure :: Scope ls r -> Fields ts -> [VarDefEntry] -> [Statement] -> C (Env ls -> HL ts -> M (Flow r))
destructure sc FNil [] rest = do k <- compileBlock sc rest; pure (\env _ -> k env)
destructure sc (FCons _ t fs) (en : ens) rest = case en of
  S.BlankEntry -> do
    k <- destructure sc fs ens rest
    pure (\env hl -> case hl of (_ :* vs) -> k env vs)
  S.VarDefEntry mty _ n _ -> do
    forM_ mty $ \ty -> do SomeTy dt <- resolveTy (sC sc) ty; void (sameTy dt t)
    k <- destructure (pushVar n t sc) fs ens rest
    pure (\env hl -> case hl of (v :* vs) -> do rr <- liftIO (newIORef v); k (rr :& env) vs)
destructure _ _ _ _ = typeErr "destructuring arity mismatch"

-- Low-level results acquire their types at the destructuring boundary.
destructureRaw :: Scope ls r -> [VarDefEntry] -> [Statement] -> C (Env ls -> [Dyn] -> M (Flow r))
destructureRaw sc [] rest = do
  k <- compileBlock sc rest
  pure $ \env ds -> if null ds then k env else revert "destructuring arity mismatch"
destructureRaw sc (S.BlankEntry : entries) rest = do
  k <- destructureRaw sc entries rest
  pure $ \env ds -> case ds of
    _ : values -> k env values
    [] -> revert "destructuring arity mismatch"
destructureRaw sc (S.VarDefEntry (Just ty) _ name _ : entries) rest = do
  SomeTy t <- resolveTy (sC sc) ty
  k <- destructureRaw (pushVar name t sc) entries rest
  pure $ \env ds -> case ds of
    d : values -> do
      value <- fromDyn t d
      slot <- liftIO $ newIORef value
      k (slot :& env) values
    [] -> revert "destructuring arity mismatch"
destructureRaw _ _ _ = unsupported "untyped raw result declaration"

compileStmt :: forall ls r. Scope ls r -> Statement -> C (Env ls -> M (Flow r))
compileStmt sc s = atLine (S.extractStatement s) $ case s of
  S.SimpleStatement (S.ExpressionStatement e) _ -> do
    CE _ f <- case e of
      S.Binary _ "=" l r -> case l of
        S.TupleExpression _ lhss -> compileTupleAssignment sc True lhss r
        S.Variable _ n | Just (Var _ (TRef _) _) <- lookupVar sc n -> do
          CE t action <- compileExpression sc False e
          pure (CE t (charged 1 . action))
        S.Variable _ n | Just (Var _ (TAlias _ _) _) <- lookupVar sc n -> do
          CE t action <- compileExpression sc False e
          pure (CE t (charged 1 . action))
        S.IndexAccess{} -> compileAssignment sc False True l r
        _ -> compileAssignment sc True True l r
      _ -> compileE sc e
    pure $ \env -> Next <$ f env
  S.SimpleStatement{} -> err Internal "declaration outside compileBlock"
  S.IfStatement cnd th mel _ -> do
    cf <- compileAs sc TBool cnd
    tf <- compileBlock sc th
    ef <- maybe (pure (\_ -> pure Next)) (compileBlock sc) mel
    pure $ \env -> cf env >>= \b -> if b then tf env else ef env
  S.WhileStatement cnd body _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure $ loop cf bf (\_ -> pure ())
  S.DoWhileStatement body cnd _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure $ \env -> let
      go = do
        result <- bf env
        chargeGas 1
        case result of
          Brk -> pure Next
          Cnt -> go
          Next -> cf env >>= \condition -> if condition then go else pure Next
          flow -> pure flow
      in go
  S.ForStatement mInit mCond mStep body a -> case mInit of
    Just (S.VariableDefinition [S.VarDefEntry (Just ty) _ n _] mInitE) -> atLine a $ do
      SomeTy t <- resolveTy (sC sc) ty
      initF <- maybe (pure (\_ -> pure (defaultOf t))) (compileAs sc t) mInitE
      k <- forBody (pushVar n t sc)
      pure $ \env -> do v <- initF env; rr <- liftIO (newIORef v); k (rr :& env)
    Just (S.ExpressionStatement e) -> do
      CE _ f <- compileE sc e
      k <- forBody sc
      pure $ \env -> f env >> k env
    Nothing -> forBody sc
    Just _ -> unsupported "for-loop initialiser"
    where
      forBody :: forall ls'. Scope ls' r -> C (Env ls' -> M (Flow r))
      forBody sc' = do
        cf <- maybe (pure (\_ -> charged 1 (pure True))) (compileAs sc' TBool) mCond
        stepF <- maybe (pure (\_ -> chargeGas 1)) (\e -> do CE _ f <- compileE sc' e; pure (void . f)) mStep
        bf <- compileBlock sc' body
        pure $ loop cf (\env -> do result <- bf env; stepF env; pure result) (\_ -> pure ())
  S.Block _ -> pure (\_ -> pure Next)
  S.Continue _ -> pure (\_ -> pure Cnt)
  S.Break _ -> pure (\_ -> pure Brk)
  S.Return Nothing _ -> case (sRet sc, sNamedRet sc) of
    (TUnit, _) -> pure (\_ -> pure (Ret ()))
    (r, [rn]) | Just (Var _ t i) <- lookupVar sc rn -> do
      Refl <- sameTy r t
      pure $ \env -> Ret <$> liftIO (readIORef (ref i env))
    (TTuple fs, names@(_ : _ : _)) -> do
      g <- gatherNamed sc fs names
      pure $ \env -> Ret <$> g env
    (r, _) -> typeErr ("return without a value in a function returning " <> showTy r)
  S.Return (Just e) _ -> do
    case compileE sc e of
      Right (CE TRaw f) | isJust (tyEq (sRet sc) TRaw) || isJust (sInner sc) ->
        pure $ \env -> RetDynamic <$> f env
      Right (CE TVariadic f) | isJust (sInner sc), isNothing (tyEq (sRet sc) TVariadic) ->
        pure $ \env -> f env >>= \case
          ds@[Dyn TUnit ()] -> pure $ RetDynamic ds
          ds -> pure $ RetDynamic [Dyn TVariadic ds]
      _ -> do
        f <- compileAs sc (sRet sc) e
        pure $ \env -> Ret <$> f env
  S.Throw _ _ -> pure (\_ -> revert "throw")
  S.EmitStatement en args _ -> do
    ev <- maybe (unknown ("event " <> en)) pure (M.lookup en (cContract (sC sc) ^. events))
    let logs = ev ^. eventLogs
    when (length logs /= length args) $ typeErr ("event " <> en <> " argument count mismatch")
    fs <- forM (zip logs args) $ \(lg, (mn, e)) -> do
      when (maybe False (/= (lg ^. eventLogName)) mn) $ typeErr ("event argument name mismatch: " <> fromMaybe "" mn)
      SomeTy t <- resolveTy (sC sc) (indexedTypeType (lg ^. eventLogType))
      f <- compileAs sc t e
      pure (\env -> (lg ^. eventLogName,) . Dyn t <$> f env)
    let cn = cName (sC sc)
    pure $ \env -> do
      vs <- mapM ($ env) fs
      (r, fr) <- ask
      liftIO (rtEmit r fr cn en vs)
      pure Next
  S.AssemblyStatement{} -> unsupported "inline assembly"
  S.RevertStatement mName args _ -> case (mName, args) of
    (Nothing, []) -> pure (\_ -> revert "")
    (Nothing, [m]) -> do f <- compileAs sc TStr m; pure (\env -> f env >>= revert)
    (Just n, _) -> do
      fs <- forM args $ \e -> do CE t f <- compileE sc e; pure (\env -> Dyn t <$> f env)
      pure $ \env -> do vs <- mapM ($ env) fs; revert (n <> "(" <> T.intercalate "," (map showDyn vs) <> ")")
    _ -> typeErr "revert takes at most one argument"
  S.UncheckedStatement body _ -> compileBlock sc body
  S.SolidityTryCatchStatement expression returnsDecl success handlers _ -> do
    CE t f <- compileE sc expression
    sf <- case returnsDecl of
      Nothing -> do k <- compileBlock sc success; pure (\env _ -> k env)
      Just [(name, ty)] -> do
        SomeTy dt <- resolveTy (sC sc) ty
        Refl <- sameTy dt t
        k <- compileBlock (pushVar name t sc) success
        pure (\env value -> do rr <- liftIO (newIORef value); k (rr :& env))
      Just declarations -> case t of
        TTuple fs -> destructure sc fs [S.VarDefEntry (Just ty) Nothing name (S.extractStatement s) | (name, ty) <- declarations] success
        _ -> typeErr "try return declaration mismatch"
    hf <- case M.lookup "Nill" handlers of
      Just (Nothing, body) | M.size handlers == 1 -> compileBlock sc body
      _ -> unsupported "typed catch clauses"
    pure $ \env -> do
      value <- catchContractFailure (Right <$> f env) (pure (Left ()))
      either (const (hf env)) (sf env) value
  S.TryCatchStatement body handlers _ -> do
    bf <- compileBlock sc body
    hf <- case M.toList handlers of
      [("", (Nothing, hs))] -> compileBlock sc hs
      [("", (Just _, _))] -> unsupported "catch with parameters"
      _ -> unsupported ("typed catch clauses " <> T.pack (show (M.keys handlers)))
    pure $ \env -> catchContractFailure (bf env) (hf env)
  S.ModifierExecutor _ -> case sInner sc of
    Just inner -> pure $ \env -> inner env >>= \case
      Ret v -> do
        -- stash in the innermost $ret slot and keep running the modifier
        setRet sc env v
        pure Next
      RetDynamic ds -> do
        setRawRet sc env (Just ds)
        pure Next
      fl -> pure fl
    Nothing -> typeErr "`_` outside a modifier"
  where
    loop :: (Env ls' -> M Bool) -> (Env ls' -> M (Flow r)) -> (Env ls' -> M ()) -> Env ls' -> M (Flow r)
    loop cf bf stepF env = go
      where
        go = cf env >>= \b -> chargeGas 1 >> if not b then pure Next else bf env >>= \case
          Brk -> pure Next
          Ret v -> pure (Ret v)
          RetDynamic ds -> pure (RetDynamic ds)
          _ -> stepF env >> go

fieldsLen :: Fields ts -> Int
fieldsLen FNil = 0
fieldsLen (FCons _ _ rest) = 1 + fieldsLen rest

-- Write the function's return value into the modifier's hidden `$ret` slot.
setRet :: Scope ls r -> Env ls -> r -> M ()
setRet sc env v = case lookupVar sc "$ret" of
  Just (Var _ (TMaybe t) i) | Just Refl <- tyEq t (sRet sc) -> do
    liftIO (writeIORef (ref i env) (Just v))
    setRawRet sc env Nothing
  _ -> diverge "internal: $ret slot missing"

setRawRet :: Scope ls r -> Env ls -> Maybe [Dyn] -> M ()
setRawRet sc env ds = case lookupVar sc "$rawRet" of
  Just (Var _ (TMaybe TVariadic) i) -> liftIO $ writeIORef (ref i env) ds
  _ -> diverge "lost modifier dynamic return slot"

-- ---------------------------------------------------------------- contracts

data CompiledContract = CompiledContract
  { ccName :: T.Text
  , ccStorage :: M.Map T.Text (C SType)
  , ccFuns :: M.Map T.Text (C Fun)        -- "name/arity"
  , ccConstructor :: Maybe (C Fun)
  , ccInitializers :: C Fun
  , ccParentArguments :: M.Map T.Text (C Fun)
  }

newtype CompiledCollection = CompiledCollection { colContracts :: M.Map T.Text CompiledContract }

mkCtx :: CodeCollection -> Contract -> CCtx
mkCtx cc c = ctx
  where
    ctx0 = CCtx (c ^. contractName) cc c M.empty M.empty M.empty
    storageE = M.map (storageTy ctx0 . (^. varType)) (c ^. storageDefs)
    ctx = ctx0 { cStorage = M.mapMaybe (either (const Nothing) Just) storageE, cFuns = funs, cSigs = sigs }
    key n f = n <> "/" <> T.pack (show (length (f ^. funcArgs)))
    allFuncs = [(n, f') | (n, f) <- M.toList (c ^. functions), f' <- f : (f ^. funcOverload)]
    getters = M.fromList [(n <> "/" <> T.pack (show (getterArity st)), getterEntry ctx n st) | (n, vd) <- M.toList (c ^. storageDefs), vd ^. varVisibility == Just Public, Right st <- [storageTy ctx0 (vd ^. varType)]]
    -- declarations without a body (interfaces, abstract) have a signature but no code
    funs = M.union (M.fromList [(key n f, FunEntry (funSig ctx f) (compileFunction ctx n f)) | (n, f) <- allFuncs, isJust (f ^. funcContents)]) getters
    sigs = M.union (M.fromList [(key n f, funSig ctx f) | (n, f) <- allFuncs]) (M.map (\(FunEntry es _) -> es) getters)

-- Solidity auto-getter for a public state variable: one argument per mapping key / array index.
getterArity :: SType -> Int
getterArity (SMap _ v) = 1 + getterArity v
getterArity (SArray v) = 1 + getterArity v
getterArity _ = 0

data Getter = forall args r. Getter (Sig args r) (StoragePath -> Env args -> M r)

getterEntry :: CCtx -> T.Text -> SType -> FunEntry
getterEntry c n st = FunEntry (fst <$> g) (snd <$> g)
  where
    g = inFun (cName c <> "." <> n) $ do
      Getter sig body <- build st
      pure (SomeSig sig, Fun n sig (mkFn sig (body (StoragePath [Field (TE.encodeUtf8 n)]))))
    build :: SType -> C Getter
    build (SMap (SomeTy k) v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons k sig) (\p env -> case env of (r :& env') -> do key <- liftIO (readIORef r); body (snocP p (encodeKey k key)) env')
    build (SArray v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons TInt sig) (\p env -> case env of (r :& env') -> do i <- liftIO (readIORef r); body (snocP p (Index (BC.pack (show i)))) env')
    build (SStruct name fields) = do
      SomeTy ty <- stypeTy (SStruct name [(field, fieldTy) | (field, fieldTy) <- fields, scalarField fieldTy])
      case ty of
        TStruct _ fs -> do
          let t = TTuple fs
          pure $ Getter (SigNil t) (\p env -> case env of ENil -> readVal t p)
        _ -> err Internal "struct getter type"
    build leaf = do
      SomeTy t <- stypeTy leaf
      pure $ Getter (SigNil t) (\p env -> case env of ENil -> readVal t p)
    scalarField SArray{} = False
    scalarField SMap{} = False
    scalarField _ = True

compileContract :: CodeCollection -> Contract -> CompiledContract
compileContract cc c = CompiledContract (c ^. contractName) storageE funsE ctorE initE parentE
  where
    ctx = mkCtx cc c
    storageE = M.map (storageTy ctx . (^. varType)) (c ^. storageDefs)
    funsE = M.map (\(FunEntry _ ef) -> ef) (cFuns ctx)
    ctorE = (\f -> compileFunction ctx "constructor" (f & funcModifiers .~ filter ((`notElem` (c ^. parents)) . fst) (f ^. funcModifiers))) <$> (c ^. constructor)
    initE = compileConstructorStage ctx "<initializers>" TUnit $ \sc -> do
      actions <- forM [(n, e) | (n, vd) <- M.toList (c ^. storageDefs), Just e <- [vd ^. varInitialVal]] $ \(n, e) -> do
        CE _ action <- compileExpression sc False (S.Binary (S.extractExpression e) "=" (S.Variable (S.extractExpression e) n) e)
        pure (void . action)
      pure $ \env -> mapM_ ($ env) actions
    parentE = M.mapWithKey (\n expressions -> compileConstructorStage ctx ("<parent:" <> n <> ">") TVariadic $ \sc -> do
      parent <- maybe (unknown ("parent contract " <> n)) pure (M.lookup n (cc ^. contracts))
      case parent ^. constructor of
        Nothing -> compileDynArgs sc expressions
        Just ctor -> do
          SomeSig sig <- funSig (mkCtx cc parent) ctor
          compileTypedArgs sc sig expressions) $
      maybe M.empty (^. funcConstructorCalls) (c ^. constructor)

-- Constructor stages share the parameter scope while STRATO controls the order
-- of initializers, parent construction, and the constructor body.
compileConstructorStage :: CCtx -> T.Text -> Ty a -> (forall ls. Scope ls a -> C (Env ls -> M a)) -> C Fun
compileConstructorStage ctx name result compile = inFun (cName ctx <> "." <> name) $ do
  SomeSig original <- maybe (pure (SomeSig (SigNil TUnit))) (funSig ctx) (cContract ctx ^. constructor)
  let sig = replaceReturn original result
      names = maybe [] (map (fromMaybe "" . fst) . (^. funcArgs)) (cContract ctx ^. constructor)
      sc = paramScope ctx sig names
      outputSig = replaceReturn original TRaw
  action <- compile sc
  pure $ Fun name outputSig $ mkFn outputSig $ \env -> do
    value <- action env
    updated <- snapshot sig env
    pure [Dyn TVariadic updated, Dyn result value]
  where
    snapshot :: Sig args r -> Env args -> M [Dyn]
    snapshot (SigNil _) ENil = pure []
    snapshot (SigCons t rest) (slot :& env) =
      (:) <$> (Dyn t <$> liftIO (readIORef slot)) <*> snapshot rest env
    replaceReturn :: Sig args r -> Ty a -> Sig args a
    replaceReturn (SigNil _) r = SigNil r
    replaceReturn (SigCons t rest) r = SigCons t (replaceReturn rest r)

compileCollection :: CodeCollection -> CompiledCollection
compileCollection cc = CompiledCollection (M.map (compileContract cc) (cc ^. contracts))

compileContractChecked :: CodeCollection -> Contract -> Either [(T.Text, Err)] CompiledContract
compileContractChecked cc c =
  let compiled = compileContract cc c
   in case collectionErrors (CompiledCollection (M.singleton (ccName compiled) compiled)) of
        [] -> Right compiled
        failures -> Left failures

-- All compile errors of a collection, for the census.
collectionErrors :: CompiledCollection -> [(T.Text, Err)]
collectionErrors (CompiledCollection cs) = concat
  [ [(ccName c <> "." <> k, e) | (k, Left e) <- M.toList (ccStorage c)]
    ++ [(ccName c <> "." <> k, e) | (k, Left e) <- M.toList (ccFuns c)]
    ++ [(ccName c <> ".constructor", e) | Just (Left e) <- [ccConstructor c]]
    ++ [(ccName c <> ".initializers", e) | Left e <- [ccInitializers c]]
    ++ [(ccName c <> ".parent:" <> n, e) | (n, Left e) <- M.toList (ccParentArguments c)]
  | c <- M.elems cs ]
