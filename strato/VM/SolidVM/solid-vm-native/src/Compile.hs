{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, RankNTypes, ScopedTypeVariables,
             LambdaCase, OverloadedStrings, ExistentialQuantification, TupleSections, NamedFieldPuns #-}
-- SolidVM source -> typed Haskell actions.  Typecheck and compile in one pass over the
-- existing parser's CodeCollection.  Strict: no implicit coercions; anything the typed
-- model cannot express is reported as an Err, never approximated.
module Compile where

import Control.Exception (try)
import Control.Lens ((^.))
import Control.Monad
import Control.Monad.Reader
import Data.Bifunctor (first)
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
import SolidVM.Model.CodeCollection hiding (DelegateCall, Internal)
import qualified SolidVM.Model.CodeCollection.Statement as S
import SolidVM.Model.Storable (StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as Ty
import Core
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)

-- Measurement toggle only: SVMC_LENIENT=1 allows implicit contract->address conversion so the
-- census can report how many failures are due to that single SolidVM leniency.
lenientContractAddress :: Bool
lenientContractAddress = unsafePerformIO ((== Just "1") <$> lookupEnv "SVMC_LENIENT")
{-# NOINLINE lenientContractAddress #-}

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
  Ty.Variadic -> pure (SomeTy TVariadic)
  Ty.Enum{Ty.typedef = n} -> enumTy c n
  Ty.Contract{Ty.typedef = n} -> pure (SomeTy (TContract n))
  Ty.UserDefined _ actual -> resolveTy c actual
  Ty.UnknownLabel n -> resolveName c n
  Ty.Struct{Ty.typedef = n} -> stypeTy =<< storageTy c (Ty.UnknownLabel n)
  Ty.Array{Ty.entry = e} -> do SomeTy t <- resolveTy c e; pure (SomeTy (TArr t))
  Ty.Mapping{} -> typeErr "mapping used as a value type"
  Ty.Decimal -> unsupported "decimal"
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
  (TTuple fs, S.TupleExpression _ xs) | all isJust xs -> compileFields sc fs (catMaybes xs)
  (TStruct _ fs, S.TupleExpression _ xs) | all isJust xs -> compileFields sc fs (catMaybes xs)
  (TArr et, S.ArrayExpression _ xs) -> do
    fs <- mapM (compileAs sc et) xs
    pure (\env -> Seq.fromList <$> mapM ($ env) fs)
  -- storage pointer: the expression must be a storage location of the same layout
  (TRef st, _) -> do
    (st', pathOf) <- compileStorage sc e
    when (showST st /= showST st') $ typeErr ("storage pointer layout mismatch: " <> showST st <> " vs " <> showST st')
    pure pathOf
  _ -> do
    CE t' f <- compileE sc e
    case (t, t') of
      (TAddr, TContract _) | lenientContractAddress -> pure f
      _ -> do Refl <- sameTy t t'; pure f

compileFields :: Scope ls r -> Fields ts -> [Expression] -> C (Env ls -> M (HL ts))
compileFields _ FNil [] = pure (\_ -> pure HNil)
compileFields sc (FCons _ t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileFields sc rest xs
  pure (\env -> (:*) <$> f env <*> k env)
compileFields _ _ _ = typeErr "tuple arity mismatch"

compileE :: Scope ls r -> Expression -> C (CE ls)
compileE sc e = atLine (S.extractExpression e) (compileE' sc e)

compileE' :: forall ls r. Scope ls r -> Expression -> C (CE ls)
compileE' sc e = case e of
  S.NumberLiteral _ n unit -> lit TInt (n * unitMul unit)
  S.BoolLiteral _ b -> lit TBool b
  S.StringLiteral _ s -> lit TStr (T.pack s)
  S.AddressLiteral _ a -> lit TAddr a
  S.HexaLiteral _ h -> case B16.decode (TE.encodeUtf8 h) of
    Right bs -> lit TBytes bs
    Left _ -> typeErr ("bad hex literal " <> h)
  S.DecimalLiteral{} -> unsupported "decimal literal"
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
    Just (Var _ (TRef _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ t i) -> pure $ CE t (\env -> liftIO (readIORef (ref i env)))
    Just (RefVar{}) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Nothing
      | Just _ <- M.lookup n (cStorage c) -> do LV t g _ <- compileLV sc e; pure (CE t g)
      | Just cd <- M.lookup n (cContract c ^. constants) -> do
          SomeTy t <- resolveTy c (cd ^. constType)
          f <- compileAs sc t (cd ^. constInitialVal)
          pure (CE t f)
      | Just cd <- M.lookup n (cCC c ^. flConstants) -> do
          SomeTy t <- resolveTy c (cd ^. constType)
          f <- compileAs sc t (cd ^. constInitialVal)
          pure (CE t f)
      | otherwise -> unknown ("variable " <> n)
  S.MemberAccess _ (S.Variable _ "msg") m -> case m of
    "sender" -> pure $ CE TAddr (\_ -> fSender <$> frame)
    "sig" -> pure $ CE TStr (\_ -> fSig <$> frame)
    "value" -> pure $ CE TInt (\_ -> fValue <$> frame)
    "data" -> pure $ CE TVariadic (\_ -> fArgs <$> frame)
    _ -> unsupported ("msg." <> m)
  S.MemberAccess _ (S.Variable _ "tx") "origin" -> pure $ CE TAddr (\_ -> fOrigin <$> frame)
  S.MemberAccess _ (S.Variable _ "block") m -> case m of
    "number" -> pure $ CE TInt (\_ -> rtBlockNumber <$> rt)
    "timestamp" -> pure $ CE TInt (\_ -> rtTimestamp <$> rt)
    _ -> unsupported ("block." <> m)
  S.MemberAccess _ (S.Variable _ en) member
    | Nothing <- lookupVar sc en, Nothing <- M.lookup en (cStorage c), Just names <- lookupEnum c en ->
        case lookup member (zip names [0 ..]) of
          Just i -> lit (TEnum en names) i
          Nothing -> unknown ("enum member " <> en <> "." <> member)
  S.MemberAccess _ (S.Variable _ lib) cn
    | Nothing <- lookupVar sc lib, Nothing <- M.lookup lib (cStorage c), Just libC <- M.lookup lib (cCC c ^. contracts)
    , Just cd <- M.lookup cn (libC ^. constants) -> do
        SomeTy t <- resolveTy c (cd ^. constType)
        f <- compileAs sc { sC = mkCtx (cCC c) libC } t (cd ^. constInitialVal)
        pure (CE t f)
  S.MemberAccess _ x "length" | Right (CE t f) <- compileE sc x, isSeqLike t -> case t of
    TArr _ -> pure $ CE TInt (fmap (fromIntegral . Seq.length) . f)
    TStr -> pure $ CE TInt (fmap (fromIntegral . T.length) . f)
    TBytes -> pure $ CE TInt (fmap (fromIntegral . B.length) . f)
    _ -> err Internal "length"
  S.MemberAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.IndexAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.FunctionCall _ callee args -> compileCall sc callee args
  S.Unitary _ op x -> case op of
    "!" -> do f <- compileAs sc TBool x; pure $ CE TBool (fmap not . f)
    "-" -> do f <- compileAs sc TInt x; pure $ CE TInt (fmap negate . f)
    "~" -> do f <- compileAs sc TInt x; pure $ CE TInt (fmap complement . f)
    "delete" -> do
      LV t _ set <- compileLV sc x
      pure $ CE TUnit (\env -> set env (defaultOf t))
    _ -> unsupported ("unary " <> T.pack op)
  S.PlusPlus _ x -> incr x 1
  S.MinusMinus _ x -> incr x (-1)
  S.Ternary _ cnd a b -> do
    cf <- compileAs sc TBool cnd
    CE t af <- compileE sc a
    bf <- compileAs sc t b
    pure $ CE t (\env -> cf env >>= \k -> if k then af env else bf env)
  S.Binary _ "=" (S.TupleExpression _ lhss) r -> do
    -- (a, b) = rhs : assign through each l-value (holes skip)
    CE rt' rf <- compileE sc r
    case rt' of
      TTuple fs -> do
        setters <- tupleSetters sc fs lhss
        pure $ CE TUnit (\env -> rf env >>= setters env)
      _ -> typeErr ("destructuring a non-tuple " <> showTy rt')
  S.Binary _ "=" l r -> do
    LV t _ set <- compileLV sc l
    rf <- compileAs sc t r
    pure $ CE t (\env -> do v <- rf env; set env v; pure v)
  S.Binary _ op l r | Just bop <- T.stripSuffix "=" (T.pack op), bop `elem` ["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>"] -> do
    LV t get set <- compileLV sc l
    case (t, bop) of
      (TStr, "+") -> do
        rf <- compileAs sc TStr r
        pure $ CE TStr (\env -> do a <- get env; b <- rf env; set env (a <> b); pure (a <> b))
      _ -> do
        Refl <- sameTy TInt t
        rf <- compileAs sc TInt r
        f <- intOp bop
        pure $ CE TInt (\env -> do a <- get env; b <- rf env; v <- f a b; set env v; pure v)
  S.Binary _ op l r -> binop (T.pack op) l r
  where
    c = sC sc

    lit :: Ty t -> t -> C (CE ls)
    lit t v = pure (CE t (\_ -> pure v))

    isArrayTy :: Ty.Type -> Bool
    isArrayTy = \case Ty.Array{} -> True; _ -> False

    isSeqLike :: Ty t -> Bool
    isSeqLike = \case TArr _ -> True; TStr -> True; TBytes -> True; _ -> False

    incr :: Expression -> Integer -> C (CE ls)
    incr x d = do
      LV t get set <- compileLV sc x
      Refl <- sameTy TInt t
      pure $ CE TInt (\env -> do v <- (+ d) <$> get env; set env v; pure v)

    binop :: T.Text -> Expression -> Expression -> C (CE ls)
    binop op l r
      | op `elem` ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"] = do
          CE lt lf <- compileE sc l
          case (lt, op) of
            (TStr, "+") -> do rf <- compileAs sc TStr r; pure $ CE TStr (\env -> (<>) <$> lf env <*> rf env)
            (TBytes, "+") -> do rf <- compileAs sc TBytes r; pure $ CE TBytes (\env -> (<>) <$> lf env <*> rf env)
            _ -> do
              Refl <- sameTy TInt lt
              rf <- compileAs sc TInt r
              f <- intOp op
              pure $ CE TInt (\env -> do a <- lf env; b <- rf env; f a b)
      | op `elem` ["==", "!="] = do
          CE lt lf <- compileE sc l
          rf <- compileAs sc lt r
          eq <- eqOn lt
          let k = if op == "==" then id else not
          pure $ CE TBool (\env -> do a <- lf env; b <- rf env; pure (k (eq a b)))
      | op `elem` ["<", ">", "<=", ">="] = do
          lf <- compileAs sc TInt l
          rf <- compileAs sc TInt r
          let cmp = case op of "<" -> (<); ">" -> (>); "<=" -> (<=); _ -> (>=)
          pure $ CE TBool (\env -> cmp <$> lf env <*> rf env)
      | op == "&&" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (\env -> lf env >>= \a -> if a then rf env else pure False)
      | op == "||" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (\env -> lf env >>= \a -> if a then pure True else rf env)
      | otherwise = unsupported ("operator " <> op)

    eqOn :: Ty t -> C (t -> t -> Bool)
    eqOn = \case
      TInt -> pure (==); TBool -> pure (==); TAddr -> pure (==); TStr -> pure (==); TBytes -> pure (==)
      TEnum _ _ -> pure (==); TContract _ -> pure (==)
      t -> typeErr ("no equality on " <> showTy t)

data SomeTuple ls = forall ts. SomeTuple (Fields ts) (Env ls -> M (HL ts))

tupleOf :: [CE ls] -> C (SomeTuple ls)
tupleOf [] = pure (SomeTuple FNil (\_ -> pure HNil))
tupleOf (CE t f : rest) = do
  SomeTuple fs k <- tupleOf rest
  pure (SomeTuple (FCons "" t fs) (\env -> (:*) <$> f env <*> k env))

tupleSetters :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Env ls -> HL ts -> M ())
tupleSetters _ FNil [] = pure (\_ _ -> pure ())
tupleSetters sc (FCons _ t rest) (mx : xs) = do
  set <- case mx of
    Nothing -> pure (\_ _ -> pure ())
    Just x -> do LV lt _ s <- compileLV sc x; Refl <- sameTy lt t; pure s
  k <- tupleSetters sc rest xs
  pure (\env hl -> case hl of (v :* vs) -> set env v >> k env vs)
tupleSetters _ _ _ = typeErr "destructuring arity mismatch"

intOp :: T.Text -> C (Integer -> Integer -> M Integer)
intOp = \case
  "+" -> pure (\a b -> pure (a + b))
  "-" -> pure (\a b -> pure (a - b))
  "*" -> pure (\a b -> pure (a * b))
  "/" -> pure (\a b -> if b == 0 then revert "division by zero" else pure (a `quot` b))
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

compileLV :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLV sc e = atLine (S.extractExpression e) $ case e of
  S.InlineBoundsCheck _ lo hi x -> do
    LV t get set <- compileLV sc x
    Refl <- sameTy TInt t
    pure $ LV TInt get $ \env v -> do
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
    (st, pathOf) <- compileStorage sc e
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
          S.Variable _ n | Just (Var{}) <- lookupVar sc n -> compileLV sc x
          S.MemberAccess{} -> compileLV sc x
          S.IndexAccess{} -> compileLV sc x
          _ -> do CE t g <- compileE sc x; pure (LV t g (\_ _ -> diverge "assignment to a temporary"))
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
compileStorage sc = \case
  S.Variable _ n -> case lookupVar sc n of
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
        pure (v, \env -> do ps <- pp env; key <- kf env; pure (snocP ps (encodeKey k key)))
      SArray el -> do
        kf <- compileAs sc TInt ix
        pure (el, \env -> do
          ps <- pp env; i <- kf env
          n <- readSlot TInt (snocP ps (Field "length"))
          when (i < 0 || i >= n) $ revert ("index out of bounds: " <> T.pack (show i))
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
    [x] -> do
      CE t f <- compileE sc x
      case t of
        TBytes -> pure $ CE TBytes (fmap (keccak256ToByteString . hash) . f)
        _ -> unsupported ("keccak256 over " <> showTy t <> " (SolidVM hashes the RLP of the value)")
    _ -> unsupported "keccak256 over several values (SolidVM hashes the RLP of the values)"
  S.Variable _ n | n `elem` ["create", "create2", "ecrecover", "sha256", "ripemd160", "addmod", "mulmod", "blockhash", "selfdestruct", "verifyCert", "getUserCert"] ->
    unsupported ("builtin " <> n)
  S.Variable _ n | Just k <- castTarget n -> cast k
  S.Variable _ n | Just names <- lookupEnum c n -> case args of
    [x] -> do f <- compileAs sc TInt x
              pure $ CE (TEnum n names) $ \env -> do v <- f env
                                                     when (v < 0 || v >= fromIntegral (length names)) $ revert ("enum out of range: " <> T.pack (show v))
                                                     pure v
    _ -> typeErr "enum conversion takes one argument"
  S.Variable _ n | Just _ <- lookupStruct c n -> do
    SomeTy t <- resolveName c n
    case t of
      TStruct _ fs -> do f <- compileFields sc fs args; pure (CE t f)
      _ -> err Internal "struct type"
  S.Variable _ n | M.member n (cCC c ^. contracts) -> case args of
    [x] -> do CE t f <- compileE sc x
              case t of
                TAddr -> pure (CE (TContract n) f)
                TContract _ -> pure (CE (TContract n) f)
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
  S.MemberAccess _ target "call" -> lowLevel Call target
  S.MemberAccess _ target "delegatecall" -> lowLevel DelegateCall target
  S.MemberAccess _ target "push" -> case compileStorage sc target of
    Right (SArray el, pp) -> do
        SomeTy et <- stypeTy el
        vf <- case args of
          [] -> pure (\_ -> pure (defaultOf et))
          [x] -> compileAs sc et x
          _ -> typeErr "push takes at most one argument"
        pure $ CE TInt $ \env -> do
          ps <- pp env; v <- vf env
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
          pure $ CE TInt $ \env -> do xs <- get env; v <- vf env; set env (xs Seq.|> v); pure (fromIntegral (Seq.length xs + 1))
        _ -> typeErr ("push on " <> showTy tt)
  S.MemberAccess _ target m -> do
    CE tt tf <- compileE sc target
    case tt of
      TContract cn | Nothing <- usingLib tt m -> externalCall cn tf m
      TAddr | m == "balance" -> unsupported "address.balance"
      _ -> case usingLib tt m of
        Just (lib, fe) -> do
          -- `using L for T`: x.f(args) == L.f(x, args)
          SomeSig sig <- (\(FunEntry es _) -> es) fe
          case sig of
            SigCons t0 rest -> do
              Refl <- sameTy t0 tt
              let FunEntry _ efun = fe
              CE rt' k <- applyCall sc rest (\env -> do x <- tf env; pure (link sig efun x)) args
              pure (CE rt' k)
            SigNil _ -> typeErr ("library function " <> lib <> "." <> m <> " takes no arguments")
        Nothing -> unsupported ("method " <> m <> " on " <> showTy tt)
  S.NewExpression _ ty _ -> do
    SomeTy t <- resolveTy c ty
    case t of
      TContract n -> unsupported ("contract creation: new " <> n)
      _ -> typeErr ("call of new " <> showTy t)
  _ -> unsupported "call of a computed function"
  where
    c = sC sc
    key n = n <> "/" <> T.pack (show (length args))

    linkCall :: FunEntry -> C (CE ls)
    linkCall (FunEntry esig efun) = do
      SomeSig sig <- esig
      applyCall sc sig (\_ -> pure (link sig efun)) args

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
                   pure $ CE TUnit (\env -> f env >>= \b -> unless b (mf env >>= revert))
      _ -> typeErr (nm <> " takes one or two arguments")

    castTarget :: T.Text -> Maybe T.Text
    castTarget n
      | n `elem` ["address", "payable"] = Just "address"
      | n == "bool" || n == "string" || n == "bytes" = Just n
      | "uint" `T.isPrefixOf` n || "int" `T.isPrefixOf` n = Just "int"
      | "bytes" `T.isPrefixOf` n = Just "bytes"
      | otherwise = Nothing

    cast :: T.Text -> C (CE ls)
    cast k = case args of
      [x] -> do
        CE t f <- compileE sc x
        case (k, t) of
          ("address", TAddr) -> pure (CE TAddr f)
          ("address", TContract _) -> pure (CE TAddr f)
          ("address", TInt) -> pure (CE TAddr (fmap (Address . fromIntegral) . f))
          ("int", TInt) -> pure (CE TInt f)
          ("int", TEnum _ _) -> pure (CE TInt f)
          ("int", TAddr) -> pure (CE TInt (fmap (\(Address a) -> fromIntegral a) . f))
          ("int", TBytes) -> pure (CE TInt (fmap (B.foldl' (\acc w -> acc * 256 + fromIntegral w) 0) . f))
          ("bytes", TInt) -> pure (CE TBytes (fmap intToBytes32 . f))
          ("bytes", TStr) -> pure (CE TBytes (fmap TE.encodeUtf8 . f))
          ("bytes", TBytes) -> pure (CE TBytes f)
          ("string", TBytes) -> pure (CE TStr (fmap TE.decodeUtf8 . f))
          ("string", TStr) -> pure (CE TStr f)
          ("bool", TBool) -> pure (CE TBool f)
          -- explicit conversion out of the dynamic world: checked once at runtime
          (_, TVariadic) -> do
            SomeTy target <- castTy k
            pure $ CE target $ \env -> f env >>= \case
              [d] -> fromDyn target d
              ds -> diverge ("converting " <> T.pack (show (length ds)) <> " dynamic values to " <> showTy target)
          _ -> typeErr ("cannot convert " <> showTy t <> " to " <> k)
      _ -> typeErr "conversion takes one argument"

    castTy :: T.Text -> C SomeTy
    castTy = \case
      "address" -> pure (SomeTy TAddr); "int" -> pure (SomeTy TInt); "bool" -> pure (SomeTy TBool)
      "string" -> pure (SomeTy TStr); "bytes" -> pure (SomeTy TBytes); k -> unknown ("type " <> k)

    lowLevel :: CallKind -> Expression -> C (CE ls)
    lowLevel kind target = do
      CE tt tf <- compileE sc target
      addrOf <- case tt of
        TAddr -> pure tf
        TContract _ -> pure tf
        _ -> typeErr (".call on " <> showTy tt)
      (nameE, rest) <- case args of
        (x : xs) -> pure (x, xs)
        [] -> typeErr ".call needs a function name"
      nf <- compileAs sc TStr nameE
      argsF <- dynArgs rest
      pure $ CE TVariadic $ \env -> do
        a <- addrOf env; n <- nf env; ds <- argsF env
        (r, f) <- ask
        liftIO (rtCall r kind f a n ds Nothing)

    externalCall :: T.Text -> (Env ls -> M Address) -> T.Text -> C (CE ls)
    externalCall cn addrOf m = do
      target <- maybe (unknown ("contract " <> cn)) pure (M.lookup cn (cCC c ^. contracts))
      esig <- maybe (unknown ("function " <> cn <> "." <> key m)) pure (findSig (cSigs (mkCtx (cCC c) target)) m (length args))
      SomeSig sig <- esig
      argsF <- typedArgs sig args
      let r = sigRet sig
      pure $ CE r $ \env -> do
        a <- addrOf env; ds <- argsF env
        (rt', f) <- ask
        out <- liftIO (rtCall rt' Call f a m ds (Just (SomeTy r)))
        case r of
          TUnit -> pure ()
          TVariadic -> pure out
          _ -> case out of
            [d] -> fromDyn r d
            _ -> fromDyn r (Dyn TVariadic out)

    typedArgs :: Sig args r' -> [Expression] -> C (Env ls -> M [Dyn])
    typedArgs (SigNil _) [] = pure (\_ -> pure [])
    typedArgs (SigCons TVariadic (SigNil _)) xs | not (singleVariadic xs) = dynArgs xs
    typedArgs (SigCons t rest) (x : xs) = do
      f <- compileAs sc t x
      k <- typedArgs rest xs
      pure (\env -> (:) <$> (Dyn t <$> f env) <*> k env)
    typedArgs _ _ = typeErr "argument count mismatch"

    singleVariadic :: [Expression] -> Bool
    singleVariadic [x] = case compileE sc x of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False

    dynArgs :: [Expression] -> C (Env ls -> M [Dyn])
    dynArgs [x] = do
      CE t f <- compileE sc x
      pure $ case t of
        TVariadic -> f
        _ -> \env -> (: []) . Dyn t <$> f env
    dynArgs xs = do
      fs <- forM xs $ \x -> do CE t f <- compileE sc x; pure (\env -> Dyn t <$> f env)
      pure (\env -> mapM ($ env) fs)

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
applyCall _ (SigNil r) mf [] = pure $ CE r (\env -> join (mf env))
applyCall sc (SigCons TVariadic (SigNil r)) mf xs | not (isSingleVariadic xs) = do
  -- a trailing `variadic` parameter absorbs the remaining arguments
  fs <- forM xs $ \x -> do CE t f <- compileE sc x; pure (\env -> Dyn t <$> f env)
  pure $ CE r (\env -> do f <- mf env; as <- mapM ($ env) fs; f as)
  where isSingleVariadic [x] = case compileE sc x of Right (CE TVariadic _) -> True; _ -> False
        isSingleVariadic _ = False
applyCall sc (SigCons t rest) mf (x : xs) = do
  af <- compileAs sc t x
  applyCall sc rest (\env -> do f <- mf env; a <- af env; pure (f a)) xs
applyCall _ _ _ _ = typeErr "argument count mismatch"

-- Link a call site to the callee once; the signature was already checked against the AST,
-- so the mismatch branch is unreachable.  A callee that failed to compile throws when called.
link :: Sig args r -> C Fun -> Fn args r
link sig = \case
  Right (Fun _ sig' f) | Just Refl <- sigEq sig sig' -> f
  Right (Fun n _ _) -> throwFn sig ("internal: linked signature mismatch for " <> n)
  Left e -> throwFn sig ("callee failed to compile: " <> showErr e)

throwFn :: Sig args r -> T.Text -> Fn args r
throwFn (SigNil _) msg = diverge msg
throwFn (SigCons _ rest) msg = \_ -> throwFn rest msg

-- super.f: first parent (declaration order) that has f; its body is compiled in the *current*
-- contract's context, i.e. internal calls inside it dispatch virtually (Solidity semantics).
superEntry :: CCtx -> T.Text -> Int -> C FunEntry
superEntry c n arity = do
  let ps = mapMaybe (\p -> M.lookup p (cCC c ^. contracts)) (cContract c ^. parents)
      cands = [f' | p <- ps, Just f <- [M.lookup n (p ^. functions)], f' <- f : (f ^. funcOverload), length (f' ^. funcArgs) == arity, isJust (f' ^. funcContents)]
  case cands of
    (f : _) -> pure (FunEntry (funSig c f) (compileFunction c ("super." <> n) f))
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
      SomeTy t <- paramTy c it
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
  when (M.member mn (cCC (sC sc) ^. contracts)) $ unsupported ("base constructor call " <> mn <> "(...)")
  modi <- maybe (unknown ("modifier " <> mn)) pure (M.lookup mn (cContract (sC sc) ^. modifiers))
  mbody <- maybe (unsupported "modifier without a body") pure (modi ^. modifierContents)
  when (length margs /= length (modi ^. modifierArgs)) $ typeErr ("modifier " <> mn <> " argument count mismatch")
  params <- forM (zip (modi ^. modifierArgs) margs) $ \((pn, it), e) -> do
    SomeTy t <- resolveTy (sC sc) (indexedTypeType it)
    pure (pn, SomeTy t, e)
  let r = sRet sc
      -- hidden slot: a `return` inside the body is stashed here by `_` and the modifier continues
      sc1 = (pushVar "$ret" (TMaybe r) sc) { sInner = Just (\e -> case e of (_ :& env) -> inner env) }
  k <- withParams sc1 params $ \sc2 -> do
    bodyK <- compileBlock sc2 mbody
    retSlot <- maybe (err Internal "lost $ret") pure (lookupVar sc2 "$ret")
    case retSlot of
      Var _ (TMaybe rt') ix -> do
        Refl <- sameTy r rt'
        pure $ \env -> bodyK env >>= \case
          Ret v -> pure (Ret v)
          _ -> liftIO (readIORef (ref ix env)) >>= \case
            Just v -> pure (Ret v)
            Nothing -> pure Next
      _ -> err Internal "$ret has the wrong type"
  pure $ \env -> do slot <- liftIO (newIORef Nothing); k (slot :& env)

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
compileBlock sc (s : rest) = case s of
  S.SimpleStatement (S.VariableDefinition [S.VarDefEntry (Just ty) loc n _] mInit) a -> atLine a $
    if loc == Just S.Storage
      then do
        st <- storageTy (sC sc) ty
        initE <- maybe (typeErr "storage pointer needs an initialiser") pure mInit
        (st', pathOf) <- compileStorage sc initE
        when (showST st /= showST st') $ typeErr ("storage pointer type mismatch: " <> showST st <> " vs " <> showST st')
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
      TTuple fs -> do
        k <- destructure sc fs entries rest
        pure $ \env -> rf env >>= k env
      _ -> typeErr ("destructuring a non-tuple " <> showTy rt')
  S.SimpleStatement (S.VariableDefinition _ Nothing) a -> atLine a (typeErr "tuple declaration without an initialiser")
  _ -> do
    sf <- compileStmt sc s
    k <- compileBlock sc rest
    pure $ \env -> sf env >>= \case
      Next -> k env
      fl -> pure fl

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

compileStmt :: forall ls r. Scope ls r -> Statement -> C (Env ls -> M (Flow r))
compileStmt sc s = atLine (S.extractStatement s) $ case s of
  S.SimpleStatement (S.ExpressionStatement e) _ -> do
    CE _ f <- compileE sc e
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
    pure $ \env -> bf env >>= \case
      Brk -> pure Next
      Ret v -> pure (Ret v)
      _ -> loop cf bf (\_ -> pure ()) env
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
        cf <- maybe (pure (\_ -> pure True)) (compileAs sc' TBool) mCond
        stepF <- maybe (pure (\_ -> pure ())) (\e -> do CE _ f <- compileE sc' e; pure (void . f)) mStep
        bf <- compileBlock sc' body
        pure $ loop cf bf stepF
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
  S.SolidityTryCatchStatement{} -> unsupported "solidity-style try/catch"
  S.TryCatchStatement body handlers _ -> do
    bf <- compileBlock sc body
    hf <- case M.toList handlers of
      [("", (Nothing, hs))] -> compileBlock sc hs
      [("", (Just _, _))] -> unsupported "catch with parameters"
      _ -> unsupported ("typed catch clauses " <> T.pack (show (M.keys handlers)))
    pure $ \env -> do
      st <- ask
      res <- liftIO (try (runReaderT (bf env) st))
      case res of
        Right fl -> pure fl
        Left (Revert _) -> hf env
  S.ModifierExecutor _ -> case sInner sc of
    Just inner -> pure $ \env -> inner env >>= \case
      Ret v -> do
        -- stash in the innermost $ret slot and keep running the modifier
        setRet sc env v
        pure Next
      fl -> pure fl
    Nothing -> typeErr "`_` outside a modifier"
  where
    loop :: (Env ls' -> M Bool) -> (Env ls' -> M (Flow r)) -> (Env ls' -> M ()) -> Env ls' -> M (Flow r)
    loop cf bf stepF env = go
      where
        go = cf env >>= \b -> if not b then pure Next else bf env >>= \case
          Brk -> pure Next
          Ret v -> pure (Ret v)
          _ -> stepF env >> go

fieldsLen :: Fields ts -> Int
fieldsLen FNil = 0
fieldsLen (FCons _ _ rest) = 1 + fieldsLen rest

-- Write the function's return value into the modifier's hidden `$ret` slot.
setRet :: Scope ls r -> Env ls -> r -> M ()
setRet sc env v = case lookupVar sc "$ret" of
  Just (Var _ (TMaybe t) i) | Just Refl <- tyEq t (sRet sc) -> liftIO (writeIORef (ref i env) (Just v))
  _ -> diverge "internal: $ret slot missing"

-- ---------------------------------------------------------------- contracts

data CompiledContract = CompiledContract
  { ccName :: T.Text
  , ccStorage :: M.Map T.Text (C SType)
  , ccFuns :: M.Map T.Text (C Fun)        -- "name/arity"
  , ccConstructor :: Maybe (C Fun)
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
    build leaf = do
      SomeTy t <- stypeTy leaf
      pure $ Getter (SigNil t) (\p env -> case env of ENil -> readVal t p)

compileContract :: CodeCollection -> Contract -> CompiledContract
compileContract cc c = CompiledContract (c ^. contractName) storageE funsE ctorE
  where
    ctx = mkCtx cc c
    storageE = M.map (storageTy ctx . (^. varType)) (c ^. storageDefs)
    funsE = M.map (\(FunEntry _ ef) -> ef) (cFuns ctx)
    ctorE = compileFunction ctx "constructor" <$> (c ^. constructor)

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
  | c <- M.elems cs ]
