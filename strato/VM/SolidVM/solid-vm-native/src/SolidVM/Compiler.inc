#include "HelperActions.inc"

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

data SomeFunction = forall args r. SomeFunction (Sig args r) (Code (Fn args r))

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
  = forall t. Var T.Text (Ty t) (Ix ls (IORef t))
  | forall t. ValueVar T.Text (Ty t) (Ix ls t) (Maybe t)

data Scope ls r = Scope
  { sVars :: [Var ls]
  , sRet :: Ty r
  , sNamedRet :: [T.Text]              -- named return values (locals)
  , sInner :: Maybe (Code (Env ls -> SM (Flow r)))   -- body of the function when compiling a modifier
  , sC :: CCtx
  }

pushVar :: T.Text -> Ty t -> Scope ls r -> Scope (IORef t ': ls) r
pushVar n t sc@(Scope vs r nr inner c) =
  Scope (Var n t IZ : map weaken vs) r nr (fmap (\f -> typedBody (RefSlot t : scopeTypes sc) r (dropEnvironment f)) inner) c

weaken :: Var ls -> Var (u ': ls)
weaken (Var n t i) = Var n t (IS i)
weaken (ValueVar n t i value) = ValueVar n t (IS i) value

varName :: Var ls -> T.Text
varName (Var n _ _) = n
varName (ValueVar n _ _ _) = n

lookupVar :: Scope ls r -> T.Text -> Maybe (Var ls)
lookupVar sc n = listToMaybe [v | v <- sVars sc, varName v == n]

scopeTypes :: Scope ls r -> [EnvTy]
scopeTypes = map variableType . sVars
  where
    variableType (Var _ t _) = RefSlot t
    variableType (ValueVar _ t _ _) = ValueSlot t

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

data CE ls = forall t. CE (Ty t) (Code (Env ls -> SM t))
data LV ls = forall t. LV (Ty t) (Code (Env ls -> SM t)) (Code (Env ls -> t -> SM ()))

sameTy :: Ty a -> Ty b -> C (a :~: b)
sameTy a b = maybe (typeErr ("expected " <> showTy a <> ", got " <> showTy b)) pure (tyEq a b)

compileAs :: Scope ls r -> Ty t -> Expression -> C (Code (Env ls -> SM t))
compileAs sc t e = typedCode (scopeTypes sc) t <$> compileAsBody sc t e

compileAsBody :: Scope ls r -> Ty t -> Expression -> C (Code (Env ls -> SM t))
compileAsBody sc t e = atLine (S.extractExpression e) $ case (t, e) of
  -- a tuple/struct literal is typed by its context
  (TTuple fs, S.TupleExpression _ xs) | all isJust xs -> do k <- compileFields sc fs (catMaybes xs); pure (functionAfter 1 k)
  (TStruct _ fs, S.TupleExpression _ xs) | all isJust xs -> do k <- compileFields sc fs (catMaybes xs); pure (functionAfter 1 k)
  (TArr et, S.ArrayExpression _ xs) -> do
    fs <- mapM (compileAs sc et) xs
    pure (functionAfter 1 (functionMap (primitiveCode FromListPrimitive) (functionTraverse fs)))
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
      (TDecimal, TInt) -> pure (functionMap (primitiveCode FromIntegerPrimitive) f)
      (_, TRaw) -> pure (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (fromDyn t . Dyn TRaw))
        EMIT_END)
      (TRaw, _) -> pure (functionMap (primitiveCode (RetDynPrimitive t')) f)
      (TVariadic, TVariadic) -> pure f
      (TVariadic, _) -> pure (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap (\v_1 -> [Dyn t' v_1]) . compiled_0)
        EMIT_END)
      (_, TVariadic) -> pure (CAPTURE f $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\ds_2 -> fromDyn t (Dyn TVariadic ds_2)))
        EMIT_END)
      _ -> do Refl <- sameTy t t'; pure f

compileFields :: Scope ls r -> Fields ts -> [Expression] -> C (Code (Env ls -> SM (HL ts)))
compileFields sc fs expressions = typedCode (scopeTypes sc) (TTuple fs) <$> compileFieldsBody sc fs expressions

compileFieldsBody :: Scope ls r -> Fields ts -> [Expression] -> C (Code (Env ls -> SM (HL ts)))
compileFieldsBody _ FNil [] = pure (constantFunction (pureAction (primitiveCode HNilPrimitive)))
compileFieldsBody sc (FCons _ t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileFields sc rest xs
  pure (functionPair hlistFunction f k)
compileFieldsBody _ _ _ = typeErr "tuple arity mismatch"

compileE :: forall ls r. Scope ls r -> Expression -> C (CE ls)
compileE sc e = atLine (S.extractExpression e) $ do
  let (base, units) = peel 1 e
      charges = chargeUnits units
      peel n (S.InlineBoundsCheck _ lo hi inner) | boundsImplied sc lo hi inner = peel (n + 1) inner
      peel n expression = (expression, n)
      result :: forall t. Ty t -> Code (Env ls -> SM t) -> C (CE ls)
      result t action = pure (CE t (typedCode (scopeTypes sc) t action))
  case base of
    S.Binary _ op left right | Just action <- atomicIntegerExpression sc (T.pack op) left right charges ->
      result TInt action
    S.NumberLiteral _ n unit ->
      let value = n * unitMul unit in result TInt (constantFunction (thenAction charges (pureAction (integerCode value))))
    S.Variable _ n | n `notElem` ["this", "now"], Just (ValueVar _ t _ (Just value)) <- lookupVar sc n ->
      let literalValue = valueCode t value
       in result t (constantFunction (thenAction charges (pureAction literalValue)))
    S.Variable _ n | n `notElem` ["this", "now"], Just (ValueVar _ t i _) <- lookupVar sc n ->
      result t (functionAfter (fromIntegral units) (valueFunction i))
    S.Variable _ n | n `notElem` ["this", "now"], Just (Var _ t i) <- lookupVar sc n, scalarLocal t ->
      result t (functionAfter (fromIntegral units) (actionFunction (referenceAction i)))
    _ -> do
      CE t action <- compileE' sc base
      if units == 1
        then result t (functionAfter 1 action)
        else result t (functionAfter (fromIntegral units) action)

chargeUnits :: Int -> Code (SM ())
chargeUnits count
  | count <= 0 = pureAction unitCode
  | otherwise = gasAction (fromIntegral count)

data IntegerAtom ls where
  IntegerLiteral :: Integer -> IntegerAtom ls
  IntegerLocal :: IntegerAtom (Integer ': ls)

integerAtom :: Scope ls r -> Expression -> Maybe (IntegerAtom ls, Int)
integerAtom sc = go 1
  where
    go units (S.InlineBoundsCheck _ lo hi e) | boundsImplied sc lo hi e = go (units + 1) e
    go units (S.NumberLiteral _ n unit) = Just (IntegerLiteral (n * unitMul unit), units)
    go units (S.Variable _ n)
      | n `notElem` ["this", "now"], Just (ValueVar _ TInt IZ _) <- lookupVar sc n = Just (IntegerLocal, units)
    go _ _ = Nothing

atomicIntegerExpression :: Scope ls r -> T.Text -> Expression -> Expression -> Code (SM ()) -> Maybe (Code (Env ls -> SM Integer))
atomicIntegerExpression sc op left right charges = do
  (lhs, leftUnits) <- atom left
  (rhs, rightUnits) <- atom right
  let extra = fromIntegral (leftUnits + rightUnits)
  (fixed, _) <- gasOnlyAction charges
  integerExpressionCode op lhs rhs (extra + runCode fixed)
  where
    atom expression = do
      (value, units) <- integerAtom sc expression
      pure (case value of
        IntegerLocal | Just known <- knownInteger sc expression -> IntegerLiteral known
        _ -> value, units)

#define INTEGER_EXPRESSION(operator, operation) \
  case (lhs, rhs) of { \
    (IntegerLiteral a, IntegerLiteral b) -> \
      Just (constantFunction (beforeAction fixed \
        (thenAction (EMIT_BEGIN (operation a b) EMIT_END) \
          (pureAction (withForm (IntegerValue (a operator b)) \
            (EMIT_BEGIN (a operator b) EMIT_END)))))); \
    (IntegerLocal, IntegerLiteral b) -> \
      Just (EMIT_BEGIN (\(a :& _) -> chargeGas fixed >> operation a b) EMIT_END); \
    (IntegerLiteral a, IntegerLocal) -> \
      Just (EMIT_BEGIN (\(b :& _) -> chargeGas fixed >> operation a b) EMIT_END); \
    (IntegerLocal, IntegerLocal) -> \
      Just (EMIT_BEGIN (\(a :& _) -> chargeGas fixed >> operation a a) EMIT_END) }

integerExpressionCode :: T.Text -> IntegerAtom ls -> IntegerAtom ls -> Integer -> Maybe (Code (Env ls -> SM Integer))
integerExpressionCode symbol lhs rhs fixed = case symbol of
  "+" -> INTEGER_EXPRESSION(+, Operators.integerAdd)
  "-" -> INTEGER_EXPRESSION(-, Operators.integerSubtract)
  "*" -> INTEGER_EXPRESSION(*, Operators.integerMultiply)
  _ -> Nothing

#undef INTEGER_EXPRESSION

compileE' :: forall ls r. Scope ls r -> Expression -> C (CE ls)
compileE' sc = compileExpression sc True

compileExpression :: forall ls r. Scope ls r -> Bool -> Expression -> C (CE ls)
compileExpression sc chargeDestination e = do
  CE t action <- compileExpressionBody sc chargeDestination e
  pure (CE t (typedCode (scopeTypes sc) t action))

compileExpressionBody :: forall ls r. Scope ls r -> Bool -> Expression -> C (CE ls)
compileExpressionBody sc chargeDestination e = case e of
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
    pure $ CE (TArr et) (functionMap (primitiveCode FromListPrimitive) (functionTraverse (f : fs)))
  S.ObjectLiteral{} -> typeErr "object literal needs a typed context"
  S.FunctionCall _ (S.NewExpression _ Ty.Bytes{} Nothing) [n] -> do
    lf <- compileAs sc TInt n
    pure $ CE TBytes (CAPTURE lf $ \compiled_0 ->
      EMIT_BEGIN (\env_1 -> (\k_2 -> B.replicate (fromIntegral k_2) 0) <$> compiled_0 env_1)
      EMIT_END)
  S.FunctionCall _ (S.NewExpression _ ty Nothing) [n] | isArrayTy ty -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- compileAs sc TInt n
        pure $ CE t (CAPTURE lf $ \compiled_0 ->
          EMIT_BEGIN (\env_1 -> do {k_2 <- compiled_0 env_1; Operations.allocate k_2; pure (Seq.replicate (fromIntegral k_2) (defaultOf et))})
          EMIT_END)
      _ -> err Internal "array new"
  S.NewExpression _ ty mLen -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- maybe (pure ((
                              (constantFunction (pureAction (EMIT_BEGIN (0)
                              EMIT_END)))))) (compileAs sc TInt) mLen
        pure $ CE t (CAPTURE lf $ \compiled_0 ->
          EMIT_BEGIN (\env_1 -> do {n_2 <- compiled_0 env_1; Operations.allocate n_2; pure (Seq.replicate (fromIntegral n_2) (defaultOf et))})
          EMIT_END)
      TContract _ -> unsupported "contract creation (new)"
      _ -> typeErr ("new " <> showTy t)
  S.InlineBoundsCheck _ lo hi x -> do
    f <- compileAs sc TInt x
    if boundsImplied sc lo hi x || (lo == Nothing && hi == Nothing)
      then pure (CE TInt f)
      else case (lo, hi) of
        (Just lower, Just upper) -> CE TInt <$> pure (functionUnary
          (EMIT_BEGIN (\value -> do {when (value < lower) (revert ("underflow: " <> T.pack (show value))); when (value > upper) (revert ("overflow: " <> T.pack (show value))); pure value})
            EMIT_END) f)
        (Just lower, Nothing) -> CE TInt <$> pure (functionUnary
          (EMIT_BEGIN (\value -> do {when (value < lower) (revert ("underflow: " <> T.pack (show value))); pure value})
            EMIT_END) f)
        (Nothing, Just upper) -> CE TInt <$> pure (functionUnary
          (EMIT_BEGIN (\value -> do {when (value > upper) (revert ("overflow: " <> T.pack (show value))); pure value})
            EMIT_END) f)
        (Nothing, Nothing) -> pure (CE TInt f)
  S.Variable _ "this" -> pure $ CE (TContract (cName c)) ((
                                        (constantFunction (EMIT_BEGIN (thisAddress)
                                        EMIT_END))))
  S.Variable _ "now" -> pure $ CE TInt ((
                                        (constantFunction (EMIT_BEGIN (blockTimestamp)
                                        EMIT_END))))
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ (TRef _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ t i) -> pure $ CE t (actionFunction (referenceAction i))
    Just (ValueVar _ t _ (Just value)) -> pure $ CE t (constantCode t value)
    Just (ValueVar _ t i _) -> pure $ CE t (valueFunction i)
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
    "sender" -> pure $ CE TAddr ((
                                    (constantFunction (EMIT_BEGIN (senderAddress)
                                    EMIT_END))))
    "sig" -> pure $ CE TStr ((
                                (constantFunction (EMIT_BEGIN (Runtime.messageSignature)
                                EMIT_END))))
    "value" -> pure $ CE TInt ((
                                  (constantFunction (EMIT_BEGIN (pure 0)
                                  EMIT_END))))
    "data" -> pure $ CE TVariadic ((
                                      (constantFunction (EMIT_BEGIN (Runtime.messageArguments)
                                      EMIT_END))))
    _ -> unsupported ("msg." <> m)
  S.MemberAccess _ (S.Variable _ "tx") "origin" -> parentMember $ pure $ CE TAddr ((
                                        (constantFunction (EMIT_BEGIN (originAddress)
                                        EMIT_END))))
  S.MemberAccess _ (S.Variable _ "block") m -> parentMember $ case m of
    "number" -> pure $ CE TInt ((
                                   (constantFunction (EMIT_BEGIN (blockNumber)
                                   EMIT_END))))
    "timestamp" -> pure $ CE TInt ((
                                      (constantFunction (EMIT_BEGIN (blockTimestamp)
                                      EMIT_END))))
    _ | m `elem` ["prevProposer", "prevIntendedProposer", "coinbase", "proposer"] -> pure $ CE TAddr $ (
                                        (constantFunction (EMIT_BEGIN (case m of
                                        {"prevProposer" -> (\(a_1, _, _) -> a_1) <$> Runtime.previousBlock;
                                        "prevIntendedProposer" -> (\(_, a_2, _) -> a_2) <$> Runtime.previousBlock;
                                        _ -> Runtime.proposer})
                                        EMIT_END)))
      | m == "prevRound" -> pure $ CE TInt $ (
                                        (constantFunction (EMIT_BEGIN ((\(_, _, n_1) -> n_1) <$> Runtime.previousBlock)
                                        EMIT_END)))
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
  S.MemberAccess _ x "length" | Right (ALV (TArr _) _ _ _) <- compileAliasLV sc x -> do
    Destination t prepare <- compileAliasDestination sc True x
    case t of
      TArr _ -> pure $ CE TInt (CAPTURE prepare $ \compiled_prepare ->
        EMIT_BEGIN (\env -> do
          (path, get, _) <- compiled_prepare env
          case path of
            Just location -> readSlot TInt (snocP location (Field "length"))
            Nothing -> fromIntegral . Seq.length <$> get)
        EMIT_END)
      _ -> err Internal "alias array length"
  S.MemberAccess _ x "length" | Right (SArray _, _) <- compileStorage sc x -> do
    LV t get _ <- compileLV sc e
    Refl <- sameTy TInt t
    pure (CE TInt get)
  S.MemberAccess _ x "length" | Right (CE t f) <- compileE sc x, isSeqLike t -> case t of
    TArr _ -> pure $ CE TInt (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap (fromIntegral . Seq.length) . compiled_0)
      EMIT_END)
    TStr -> pure $ CE TInt (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap (fromIntegral . T.length) . compiled_0)
      EMIT_END)
    TBytes -> pure $ CE TInt (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap (fromIntegral . B.length) . compiled_0)
      EMIT_END)
    _ -> err Internal "length"
  S.MemberAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.IndexAccess _ (S.FunctionCall _ (S.Variable _ "getUserCert") args) (Just ix)
    | Nothing <- findFun (cFuns c) "getUserCert" (length args) -> do
        argsF <- compileDynArgs sc args
        _ <- compileAs sc TStr ix
        pure $ CE TStr $ (CAPTURE argsF $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {_ <- compiled_0 env_1;
          Builtins.missingUserCert})
          EMIT_END)
  S.IndexAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.FunctionCall _ callee args -> compileCall sc callee args
  S.Unitary _ op x -> case op of
    "!" -> do f <- compileAs sc TBool x; pure $ CE TBool (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap not . compiled_0)
               EMIT_END)
    "-" -> do
      CE t f <- compileE sc x
      case t of
        TDecimal -> pure $ CE TDecimal (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap negate . compiled_0)
          EMIT_END)
        _ -> do Refl <- sameTy TInt t; pure $ CE TInt (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (fmap negate . compiled_0)
                 EMIT_END)
    "++" -> incr True x 1
    "--" -> incr True x (-1)
    "~" -> do f <- compileAs sc TInt x; pure $ CE TInt (CAPTURE f $ \compiled_0 ->
               EMIT_BEGIN (fmap complement . compiled_0)
               EMIT_END)
    "delete" -> do
      (_, pathF) <- compileStorage sc x
      pure $ CE TUnit $ (CAPTURE pathF $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {path_2 <- compiled_0 env_1;
        writeBasic path_2 BDefault})
        EMIT_END)
    _ -> unsupported ("unary " <> T.pack op)
  S.PlusPlus _ x -> incr False x 1
  S.MinusMinus _ x -> incr False x (-1)
  S.Ternary _ cnd a b -> do
    cf <- compileAs sc TBool cnd
    CE t af <- compileE sc a
    bf <- compileAs sc t b
    pure $ CE t (CAPTURE3 cf af bf $ \compiled_0 compiled_1 compiled_2 ->
      EMIT_BEGIN (\env_3 -> compiled_0 env_3 >>= (\k_4 -> if k_4
      then compiled_1 env_3
      else compiled_2 env_3))
      EMIT_END)
  S.Binary _ "=" (S.TupleExpression _ lhss) r -> do
    -- (a, b) = rhs : assign through each l-value (holes skip)
    compileTupleAssignment sc False lhss r
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TAlias t _) i) <- lookupVar sc n -> do
        valueF <- compileAs sc t r
        pure $ CE t $ (CAPTURE valueF $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {value_2 <- compiled_0 env_1;
          when chargeDestination $ chargeGas 1;
          Operations.localWrite;
          liftIO $ writeIORef (ref i env_1) (Right value_2);
          pure value_2})
          EMIT_END)
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TRef st) i) <- lookupVar sc n -> do
        (other, pathF) <- compileStorage sc r
        when (showST st /= showST other) $ typeErr "storage alias type mismatch"
        pure $ CE TUnit $ (CAPTURE pathF $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {path_2 <- compiled_0 env_1;
          when chargeDestination $ chargeGas 1;
          Operations.localWrite;
          liftIO $ writeIORef (ref i env_1) path_2})
          EMIT_END)
  S.Binary _ "=" l r -> compileAssignment sc False chargeDestination l r
  S.Binary _ op l r | Just bop <- T.stripSuffix "=" (T.pack op), bop `elem` ["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>"] -> do
    LV t get set <- compileLV sc l
    case (t, bop) of
      (TDecimal, _) -> do
        rf <- compileAs sc TDecimal r
        f <- if bop == "/" then pure (EMIT_BEGIN Operators.decimalDivideAssign EMIT_END)
             else decimalOp True (case compileE sc r of Right (CE TDecimal _) -> True; _ -> False) bop
        pure $ CE TDecimal (CAPTURE4 rf get f set $ \compiled_0 compiled_1 compiled_2 compiled_3 ->
          EMIT_BEGIN (\env_4 -> do {b_5 <- compiled_0 env_4;
          a_6 <- chargeAfter 1 (compiled_1 env_4);
          void $ chargeAfter 1 (compiled_1 env_4);
          v_7 <- compiled_2 a_6 b_5;
          compiled_3 env_4 v_7;
          pure v_7})
          EMIT_END)
      (TStr, "+") -> do
        rf <- compileAs sc TStr r
        pure $ CE TStr (CAPTURE3 rf get set $ \compiled_0 compiled_1 compiled_2 ->
          EMIT_BEGIN (\env_3 -> do {b_4 <- compiled_0 env_3;
          a_5 <- chargeAfter 1 (compiled_1 env_3);
          void $ chargeAfter 1 (compiled_1 env_3);
          value_5 <- Operators.textAdd a_5 b_4;
          compiled_2 env_3 value_5;
          pure value_5})
          EMIT_END)
      _ -> do
        Refl <- sameTy TInt t
        rf <- compileAs sc TInt r
        f <- if bop == "/" then pure (EMIT_BEGIN Operators.integerDivideAssign EMIT_END) else intOp bop
        pure $ CE TInt (CAPTURE4 rf get f set $ \compiled_0 compiled_1 compiled_2 compiled_3 ->
          EMIT_BEGIN (\env_4 -> do {b_5 <- compiled_0 env_4;
          a_6 <- chargeAfter 1 (compiled_1 env_4);
          void $ chargeAfter 1 (compiled_1 env_4);
          v_7 <- compiled_2 a_6 b_5;
          compiled_3 env_4 v_7;
          pure v_7})
          EMIT_END)
  S.Binary _ op l r -> binop (T.pack op) l r
  where
    c = sC sc

    compileConstant :: Ty t -> Expression -> C (Code (Env ls -> SM t))
    compileConstant t initial = case initial of
      S.NumberLiteral{} -> literalConstant t initial
      S.AddressLiteral{} -> literalConstant t initial
      _ -> compileAs sc t initial

    literalConstant :: Ty t -> Expression -> C (Code (Env ls -> SM t))
    literalConstant t initial = do
      CE source f <- compileE' sc initial
      case (t, source) of
        (TDecimal, TInt) -> pure (functionMap (primitiveCode FromIntegerPrimitive) f)
        (TContract _, TAddr) -> pure f
        _ -> do Refl <- sameTy t source; pure f

    parentMember compiled = do
      CE t action <- compiled
      pure $ CE t (functionBefore 1 action)

    lit :: Ty t -> t -> C (CE ls)
    lit t v = pure (CE t (constantCode t v))

    isArrayTy :: Ty.Type -> Bool
    isArrayTy = \case Ty.Array{} -> True; _ -> False

    isSeqLike :: Ty t -> Bool
    isSeqLike = \case TArr _ -> True; TStr -> True; TBytes -> True; _ -> False

    incr :: Bool -> Expression -> Integer -> C (CE ls)
    incr prefix x d = do
      Destination t prepare <- compileDestination sc True x
      Refl <- sameTy TInt t
      pure $ CE TInt $ (CAPTURE prepare $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> do {(_, get_2, set_3) <- compiled_0 env_1;
        v_4 <- get_2;
        next_5 <- if d == 1 then Operators.integerAdd v_4 1 else Operators.integerSubtract v_4 1;
        set_3 next_5;
        pure (if prefix
        then next_5
        else v_4)})
        EMIT_END)

    binop :: T.Text -> Expression -> Expression -> C (CE ls)
    binop op l r
      | op `elem` ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"] = do
          CE lt lf <- compileE sc l
          case (lt, op) of
            (TDecimal, _) -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp True (isDecimal r) op
              pure $ CE TDecimal $ if op `elem` ["/", "%"]
                then (CAPTURE3 rf lf f $ \compiled_0 compiled_1 compiled_2 ->
                  EMIT_BEGIN (\env_3 -> do {compiled_0 env_3 >>= (\b_4 -> Operators.checkDivisor b_4);
                  a_5 <- compiled_1 env_3;
                  b_6 <- compiled_0 env_3;
                  compiled_2 a_5 b_6})
                  EMIT_END)
                else functionBinary f lf rf
            (TInt, _) | Right (CE TDecimal _) <- compileE sc r -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp False True op
              pure $ CE TDecimal $ if op `elem` ["/", "%"]
                then (CAPTURE3 rf lf f $ \compiled_0 compiled_1 compiled_2 ->
                  EMIT_BEGIN (\env_3 -> do {compiled_0 env_3 >>= (\b_4 -> Operators.checkDivisor b_4);
                  a_5 <- compiled_1 env_3;
                  b_6 <- compiled_0 env_3;
                  compiled_2 (fromInteger a_5) b_6})
                  EMIT_END)
                else (CAPTURE3 lf rf f $ \compiled_0 compiled_1 compiled_2 ->
                  EMIT_BEGIN (\env_3 -> do {a_4 <- compiled_0 env_3;
                  b_5 <- compiled_1 env_3;
                  compiled_2 (fromInteger a_4) b_5})
                  EMIT_END)
            (TStr, "+") -> do rf <- compileAs sc TStr r; pure $ CE TStr (CAPTURE2 lf rf $ \compiled_0 compiled_1 ->
                               EMIT_BEGIN (\env_2 -> do {a_3 <- compiled_0 env_2;
                               b_4 <- compiled_1 env_2;
                               Operators.textAdd a_3 b_4})
                               EMIT_END)
            (TBytes, "+") -> do rf <- compileAs sc TBytes r; pure $ CE TBytes (CAPTURE2 lf rf $ \compiled_0 compiled_1 ->
                                 EMIT_BEGIN (\env_2 -> do {a_3 <- compiled_0 env_2;
                                 b_4 <- compiled_1 env_2;
                                 Operators.bytesAdd a_3 b_4})
                                 EMIT_END)
            _ -> do
              Refl <- sameTy TInt lt
              rf <- compileAs sc TInt r
              f <- intOp op
              pure $ CE TInt $ if op `elem` ["/", "%"]
                then (CAPTURE3 rf lf f $ \compiled_0 compiled_1 compiled_2 ->
                  EMIT_BEGIN (\env_3 -> do {compiled_0 env_3 >>= (\b_4 -> Operators.checkDivisor b_4);
                  a_5 <- compiled_1 env_3;
                  b_6 <- compiled_0 env_3;
                  compiled_2 a_5 b_6})
                  EMIT_END)
                else functionBinary f lf rf
      | op `elem` ["==", "!="] = do
          CE lt lf <- compileE sc l
          rf <- compileAs sc lt r
          eq <- eqOn lt
          let k = if op == "==" then (identityFunction) else (primitiveCode NotPrimitive)
          pure $ CE TBool (CAPTURE4 lf rf k eq $ \compiled_0 compiled_1 compiled_2 compiled_3 ->
            EMIT_BEGIN (\env_4 -> do {a_5 <- compiled_0 env_4;
            b_6 <- compiled_1 env_4;
            pure (compiled_2 (compiled_3 a_5 b_6))})
            EMIT_END)
      | op `elem` ["<", ">", "<=", ">="] = do
          if isDecimal l || isDecimal r then do
            lf <- compileAs sc TDecimal l
            rf <- compileAs sc TDecimal r
            let comparison = comparisonOp op
            pure $ CE TBool (CAPTURE3 comparison lf rf $ \compiled_0 compiled_1 compiled_2 ->
              EMIT_BEGIN (\env_3 -> (compiled_0 <$> compiled_1 env_3) <*> compiled_2 env_3)
              EMIT_END)
          else do
            lf <- compileAs sc TInt l
            rf <- compileAs sc TInt r
            let comparison = comparisonOp op
            pure $ CE TBool (CAPTURE3 comparison lf rf $ \compiled_0 compiled_1 compiled_2 ->
              EMIT_BEGIN (\env_3 -> (compiled_0 <$> compiled_1 env_3) <*> compiled_2 env_3)
              EMIT_END)
      | op == "&&" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (CAPTURE2 lf rf $ \compiled_0 compiled_1 ->
            EMIT_BEGIN (\env_2 -> compiled_0 env_2 >>= (\a_3 -> if a_3
            then compiled_1 env_2
            else pure False))
            EMIT_END)
      | op == "||" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool (CAPTURE2 lf rf $ \compiled_0 compiled_1 ->
            EMIT_BEGIN (\env_2 -> compiled_0 env_2 >>= (\a_3 -> if a_3
            then pure True
            else compiled_1 env_2))
            EMIT_END)
      | otherwise = unsupported ("operator " <> op)

    isDecimal x = case compileE sc x of Right (CE TDecimal _) -> True; _ -> False

    eqOn :: Ty t -> C (Code (t -> t -> Bool))
    eqOn = \case
      TDecimal -> pure (primitiveCode EqualPrimitive); TInt -> pure (primitiveCode EqualPrimitive); TBool -> pure (primitiveCode EqualPrimitive); TAddr -> pure (primitiveCode EqualPrimitive); TStr -> pure (primitiveCode EqualPrimitive); TBytes -> pure (primitiveCode EqualPrimitive)
      TEnum _ _ -> pure (primitiveCode EqualPrimitive); TContract _ -> pure (primitiveCode EqualPrimitive)
      t -> typeErr ("no equality on " <> showTy t)

boundsImplied :: Scope ls r -> Maybe Integer -> Maybe Integer -> Expression -> Bool
boundsImplied sc lo hi expression = case knownInteger sc expression of
  Just value -> maybe True (<= value) lo && maybe True (>= value) hi
  Nothing -> case expression of
    S.InlineBoundsCheck _ innerLo innerHi _ ->
      maybe True (\lower -> maybe False (>= lower) innerLo) lo &&
      maybe True (\upper -> maybe False (<= upper) innerHi) hi
    _ -> False

knownInteger :: Scope ls r -> Expression -> Maybe Integer
knownInteger sc = \case
  S.NumberLiteral _ n unit -> Just (n * unitMul unit)
  S.Variable _ n | n `notElem` ["this", "now"], Just (ValueVar _ TInt _ value) <- lookupVar sc n -> value
  S.InlineBoundsCheck _ lo hi e -> do
    value <- knownInteger sc e
    guard (maybe True (<= value) lo && maybe True (>= value) hi)
    pure value
  S.Unitary _ "-" e -> negate <$> knownInteger sc e
  S.Binary _ "+" l r -> (+) <$> knownInteger sc l <*> knownInteger sc r
  S.Binary _ "-" l r -> (-) <$> knownInteger sc l <*> knownInteger sc r
  _ -> Nothing

-- These facts describe values already checked by their initializer. Effects
-- and gas charges still execute; only subsequent environment reads disappear.
knownValue :: Scope ls r -> Ty a -> Expression -> Maybe a
knownValue sc TInt expression = knownInteger sc expression
knownValue sc t (S.Variable _ n)
  | n `notElem` ["this", "now"]
  , Just (ValueVar _ vt _ value) <- lookupVar sc n
  , Just Refl <- tyEq t vt = value
knownValue _ TBool (S.BoolLiteral _ value) = Just value
knownValue _ TStr (S.StringLiteral _ value) = Just (T.pack value)
knownValue _ TAddr (S.AddressLiteral _ value) = Just value
knownValue _ (TContract _) (S.AddressLiteral _ value) = Just value
knownValue _ TDecimal (S.DecimalLiteral _ value) = Just (S.unwrapDecimal value)
knownValue _ TBytes (S.HexaLiteral _ value) = either (const Nothing) Just (B16.decode (TE.encodeUtf8 value))
knownValue _ _ _ = Nothing

comparisonOp :: Ord a => T.Text -> Code (a -> a -> Bool)
comparisonOp = \case
  "<" -> (primitiveCode LessPrimitive)
  ">" -> (primitiveCode GreaterPrimitive)
  "<=" -> (primitiveCode LessEqualPrimitive)
  _ -> (primitiveCode GreaterEqualPrimitive)

decimalOp :: Bool -> Bool -> T.Text -> C (Code (Decimal -> Decimal -> SM Decimal))
decimalOp leftDecimal rightDecimal op = case op of
  "+" -> pure (EMIT_BEGIN Operators.decimalAdd EMIT_END)
  "-" -> pure (EMIT_BEGIN Operators.decimalSubtract EMIT_END)
  "*" -> pure (EMIT_BEGIN Operators.decimalMultiply EMIT_END)
  "/" | leftDecimal && rightDecimal -> pure (EMIT_BEGIN Operators.decimalDivide EMIT_END)
      | leftDecimal -> pure (EMIT_BEGIN (\a b -> Operators.decimalIntegerDivide a (decimalMantissa b)) EMIT_END)
      | otherwise -> pure (EMIT_BEGIN (\a b -> Operators.integerDecimalDivide (decimalMantissa a) b) EMIT_END)
  _ -> unsupported ("decimal operator " <> op)

data SomeTuple ls = forall ts. SomeTuple (Fields ts) (Code (Env ls -> SM (HL ts)))

tupleOf :: [CE ls] -> C (SomeTuple ls)
tupleOf [] = pure (SomeTuple FNil (constantFunction (pureAction (primitiveCode HNilPrimitive))))
tupleOf (CE t f : rest) = do
  SomeTuple fs k <- tupleOf rest
  pure (SomeTuple (FCons "" t fs) (functionPair hlistFunction f k))

compileTupleAssignment :: forall ls r. Scope ls r -> Bool -> [Maybe Expression] -> Expression -> C (CE ls)
compileTupleAssignment sc destinationFirst lhss rhs = do
  CE t valueF <- compileE sc rhs
  case t of
    TStruct _ fs -> assignment fs valueF
    TTuple fs -> assignment fs valueF
    _ -> typeErr ("destructuring a non-tuple " <> showTy t)
  where
    assignment :: Fields ts -> (Code (Env ls -> SM (HL ts))) -> C (CE ls)
    assignment fs valueF = do
      prepare <- tupleSetters sc fs lhss
      pure $ CE TUnit $ (CAPTURE2 prepare valueF $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {let {destination_3 = chargeAfter 1 (compiled_0 env_2)};
        (set_4, values_5) <- if destinationFirst
        then ((,) <$> destination_3) <*> compiled_1 env_2
        else do {values_6 <- compiled_1 env_2;
        set_7 <- destination_3;
        pure (set_7, values_6)};
        set_4 values_5})
        EMIT_END)

tupleSetters :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Code (Env ls -> SM (HL ts -> SM ())))
tupleSetters sc fs entries = typedTupleSetters (scopeTypes sc) fs <$> tupleSettersBody sc fs entries

tupleSettersBody :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Code (Env ls -> SM (HL ts -> SM ())))
tupleSettersBody _ FNil [] = pure ((
                                      (constantFunction (pureAction (EMIT_BEGIN ((\_ -> pure ()))
                                      EMIT_END)))))
tupleSettersBody sc (FCons _ t rest) (mx : xs) = do
  prepare <- case mx of
    Nothing -> pure ((
                        (constantFunction (pureAction (EMIT_BEGIN ((\_ -> pure ()))
                        EMIT_END)))))
    Just x -> do
      Destination lt location <- compileDestination sc True x
      Refl <- sameTy lt t
      pure (CAPTURE location $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {(_, _, set_2) <- compiled_0 env_1;
        pure set_2})
        EMIT_END)
  remaining <- tupleSetters sc rest xs
  pure $ (CAPTURE2 prepare remaining $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {set_3 <- compiled_0 env_2;
    next_4 <- compiled_1 env_2;
    pure (\hl_5 -> case hl_5 of
    {v_6 :* vs_7 -> set_3 v_6 >> next_4 vs_7})})
    EMIT_END)
tupleSettersBody _ _ _ = typeErr "destructuring arity mismatch"

intOp :: T.Text -> C (Code (Integer -> Integer -> SM Integer))
intOp op = case T.unpack op of
  "+" -> pure (
                 (EMIT_BEGIN (Operators.integerAdd)
                 EMIT_END))
  "-" -> pure (
                 (EMIT_BEGIN (Operators.integerSubtract)
                 EMIT_END))
  "*" -> pure (
                 (EMIT_BEGIN (Operators.integerMultiply)
                 EMIT_END))
  "/" -> pure (
                 (EMIT_BEGIN (Operators.integerDivide)
                 EMIT_END))
  "%" -> pure (
                 (EMIT_BEGIN (Operators.integerRemainder)
                 EMIT_END))
  "**" -> pure (
                  (EMIT_BEGIN (Operators.integerPower)
                  EMIT_END))
  "|" -> pure (
                 (EMIT_BEGIN (Operators.integerOr)
                 EMIT_END))
  "&" -> pure (
                 (EMIT_BEGIN (Operators.integerAnd)
                 EMIT_END))
  "^" -> pure (
                 (EMIT_BEGIN (Operators.integerXor)
                 EMIT_END))
  "<<" -> pure (
                  (EMIT_BEGIN (Operators.integerShiftLeftAssign)
                  EMIT_END))
  ">>" -> pure (
                  (EMIT_BEGIN (Operators.integerShiftRight)
                  EMIT_END))
  _ -> unsupported ("operator " <> op)

unitMul :: Maybe S.NumberUnit -> Integer
unitMul = \case
  Nothing -> 1; Just S.Wei -> 1; Just S.Szabo -> 10 ^ (12 :: Int); Just S.Finney -> 10 ^ (15 :: Int); Just S.Ether -> 10 ^ (18 :: Int)

-- ---------------------------------------------------------------- l-values

data ALV ls = forall t. ALV (Ty t) (Code (Env ls -> SM (Maybe StoragePath))) (Code (Env ls -> SM t)) (Code (Env ls -> t -> SM ()))

compileAliasLV :: Scope ls r -> Expression -> C (ALV ls)
compileAliasLV sc e = do
  ALV t path get set <- compileAliasLVBody sc e
  pure (ALV t (typedPath (scopeTypes sc) path) (typedCode (scopeTypes sc) t get) (typedSetter (scopeTypes sc) t set))

compileAliasLVBody :: Scope ls r -> Expression -> C (ALV ls)
compileAliasLVBody sc expression = case expression of
  S.Variable _ name | Just (Var _ (TAlias t _) i) <- lookupVar sc name ->
    pure $ ALV t
      ((
          (EMIT_BEGIN (\env_0 -> either Just (const Nothing) <$> liftIO (readIORef (ref i env_0)))
          EMIT_END)))
      ((
          (EMIT_BEGIN (\env_0 -> liftIO (readIORef (ref i env_0)) >>= either (readVal t) pure)
          EMIT_END)))
      ((
          (EMIT_BEGIN (\env_0 value_1 -> liftIO $ writeIORef (ref i env_0) (Right value_1))
          EMIT_END)))
  S.MemberAccess _ parent field -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    case t of
      TStruct _ fields -> do
        SomeIx ft i <- fieldIx fields field
        pure $ ALV ft
          (CAPTURE pathOf $ \compiled_0 ->
            EMIT_BEGIN (\env_1 -> fmap (`snocP` Field (TE.encodeUtf8 field)) <$> compiled_0 env_1)
            EMIT_END)
          (CAPTURE get $ \compiled_0 -> EMIT_BEGIN (\env_1 -> hget i <$> compiled_0 env_1)
            EMIT_END)
          (CAPTURE2 get set $ \compiled_0 compiled_1 ->
            EMIT_BEGIN (\env_2 value_3 -> compiled_0 env_2 >>= (compiled_1 env_2 . hset i value_3))
            EMIT_END)
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    indexF <- compileAs sc TInt index
    case t of
      TArr et -> pure $ ALV et
        (CAPTURE2 pathOf indexF $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> compiled_0 env_2 >>= (\case
          {Nothing -> pure Nothing;
          Just path_3 -> do {i_4 <- compiled_1 env_2;
          pure $ (Just $ snocP path_3 (Index (BC.pack (show i_4))))}}))
          EMIT_END)
        (CAPTURE2 get indexF $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {values_3 <- compiled_0 env_2;
          i_4 <- compiled_1 env_2;
          maybe (revert "alias array index out of bounds") pure (Seq.lookup (fromIntegral i_4) values_3)})
          EMIT_END)
        (CAPTURE3 get indexF set $ \compiled_0 compiled_1 compiled_2 ->
          EMIT_BEGIN (\env_3 value_4 -> do {values_5 <- compiled_0 env_3;
          i_6 <- compiled_1 env_3;
          when ((i_6 < 0) || (i_6 >= fromIntegral (Seq.length values_5))) $ revert "alias array index out of bounds";
          compiled_2 env_3 (Seq.update (fromIntegral i_6) value_4 values_5)})
          EMIT_END)
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileLV :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLV sc e = do
  LV t get set <- compileLVUnmetered sc e
  let localCell = case (compileAliasLV sc e, compileStorage' sc e) of
        (Right _, _) -> False
        (_, Right _) -> False
        _ -> True
      write = if not localCell then set else CAPTURE set $ \compiled_set ->
        EMIT_BEGIN (\env value -> Operations.localWrite >> compiled_set env value) EMIT_END
  pure (LV t get write)

compileLVUnmetered :: Scope ls r -> Expression -> C (LV ls)
compileLVUnmetered sc e = do
  LV t get set <- compileLVBody sc e
  pure (LV t (typedCode (scopeTypes sc) t get) (typedSetter (scopeTypes sc) t set))

compileLVBody :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLVBody sc e | Right (ALV originalTy pathOf _ set) <- compileAliasLV sc e = do
  Destination t prepare <- compileAliasDestination sc False e
  Refl <- sameTy originalTy t
  pure $ LV t
    (CAPTURE prepare $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {(_, get_2, _) <- compiled_0 env_1;
      get_2})
      EMIT_END)
    (CAPTURE2 pathOf set $ \compiled_0 compiled_1 ->
      EMIT_BEGIN (\env_2 value_3 -> compiled_0 env_2 >>= maybe (Operations.localWrite >> compiled_1 env_2 value_3) (\path_4 -> writeVal t path_4 value_3))
      EMIT_END)
compileLVBody sc e = atLine (S.extractExpression e) $ case e of
  S.InlineBoundsCheck _ lo hi x -> do
    LV t get set <- compileLVUnmetered sc x
    Refl <- sameTy TInt t
    pure $ LV TInt (functionAfter 1 get) $ (CAPTURE set $ \compiled_0 ->
      EMIT_BEGIN (\env_1 v_2 -> do {when (maybe False (v_2 <) lo) $ revert ("underflow: " <> T.pack (show v_2));
      when (maybe False (v_2 >) hi) $ revert ("overflow: " <> T.pack (show v_2));
      compiled_0 env_1 v_2})
      EMIT_END)
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notRef t ->
    pure $ LV t ((
                    (EMIT_BEGIN (\env_0 -> liftIO (readIORef (ref i env_0)))
                    EMIT_END))) ((
                    (EMIT_BEGIN (\env_0 v_1 -> liftIO (writeIORef (ref i env_0) v_1))
                    EMIT_END)))
  -- field of a struct *value* (memory): read-modify-write the whole parent
  S.MemberAccess _ p f | Right (LV pt get set) <- valueLV p, TStruct _ fs <- pt -> do
    SomeIx t ix <- fieldIx fs f
    pure $ LV t (CAPTURE get $ \compiled_0 -> EMIT_BEGIN (\env_1 -> hget ix <$> compiled_0 env_1)
      EMIT_END) (CAPTURE2 get set $ \compiled_0 compiled_1 ->
                      EMIT_BEGIN (\env_2 v_3 -> compiled_0 env_2 >>= (compiled_1 env_2 . hset ix v_3))
                      EMIT_END)
  -- element of an array / bytes *value*
  S.IndexAccess _ p (Just ix) | Right (LV pt get set) <- valueLV p, isIndexable pt -> do
    kf <- compileAs sc TInt ix
    case pt of
      TArr et -> do
        pure $ LV et (CAPTURE2 get kf $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {xs_3 <- compiled_0 env_2;
          i_4 <- compiled_1 env_2;
          checkIndex (Seq.length xs_3) i_4;
          pure (Seq.index xs_3 (fromIntegral i_4))})
          EMIT_END)
                    (CAPTURE3 get kf set $ \compiled_0 compiled_1 compiled_2 ->
                      EMIT_BEGIN (\env_3 v_4 -> do {xs_5 <- compiled_0 env_3;
                      i_6 <- compiled_1 env_3;
                      checkIndex (Seq.length xs_5) i_6;
                      compiled_2 env_3 (Seq.update (fromIntegral i_6) v_4 xs_5)})
                      EMIT_END)
      TBytes -> do
        pure $ LV TInt (CAPTURE2 get kf $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {bs_3 <- compiled_0 env_2;
          i_4 <- compiled_1 env_2;
          checkIndex (B.length bs_3) i_4;
          pure (fromIntegral (B.index bs_3 (fromIntegral i_4)))})
          EMIT_END)
                      (CAPTURE3 get kf set $ \compiled_0 compiled_1 compiled_2 ->
                        EMIT_BEGIN (\env_3 v_4 -> do {bs_5 <- compiled_0 env_3;
                        i_6 <- compiled_1 env_3;
                        checkIndex (B.length bs_5) i_6;
                        let {(a_7, b_8) = B.splitAt (fromIntegral i_6) bs_5};
                        compiled_2 env_3 (a_7 <> (B.singleton (fromIntegral v_4) <> B.drop 1 b_8))})
                        EMIT_END)
      _ -> err Internal "indexable"
  _ -> do
    (st, pathOf) <- compileStorage' sc e
    case st of
      SScalar (SomeTy t) -> pure $ LV t
        (functionUnary
          (EMIT_BEGIN (readSlot t)
            EMIT_END) pathOf)
        (CAPTURE pathOf $ \compiled_path ->
          EMIT_BEGIN (\env value -> compiled_path env >>= (\path -> writeSlot t path value))
          EMIT_END)
      SMap{} -> typeErr "mapping used as a value"
      _ -> do
        SomeTy t <- stypeTy st
        pure $ LV t
          (functionUnary
            (EMIT_BEGIN (readVal t)
              EMIT_END) pathOf)
          (CAPTURE pathOf $ \compiled_path ->
            EMIT_BEGIN (\env value -> compiled_path env >>= (\path -> writeVal t path value))
            EMIT_END)
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
          _ -> do CE t g <- compileE sc x; pure (LV t g ((
                                        (EMIT_BEGIN (\_ _ -> diverge "assignment to a temporary")
                                        EMIT_END))))
    chargedParent x = do
      LV t get set <- compileLVUnmetered sc x
      pure $ LV t (functionAfter 1 get) set
    isStorageRooted :: Expression -> Bool
    isStorageRooted = \case
      S.Variable _ n -> case lookupVar sc n of
        Just (Var _ (TRef _) _) -> True
        Just (Var{}) -> False
        Just (ValueVar{}) -> False
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

compileStorage :: Scope ls r -> Expression -> C (SType, Code (Env ls -> SM StoragePath))
compileStorage sc expression = do
  (st, action) <- compileStorage' sc expression
  pure (st, case expression of
    S.FunctionCall{} -> action
    _ -> (functionAfter 1 action))

compileStorage' :: Scope ls r -> Expression -> C (SType, Code (Env ls -> SM StoragePath))
compileStorage' sc = \case
  S.InlineBoundsCheck _ _ _ expression -> compileStorage sc expression
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ st) i) -> pure (st, (
                                        (EMIT_BEGIN (\env_0 -> liftIO (readIORef (ref i env_0)) >>= either pure (const (diverge "memory value used as storage pointer")))
                                        EMIT_END)))
    Just (Var _ (TRef st) i) -> pure (st, (
                                        (EMIT_BEGIN (\env_0 -> liftIO (readIORef (ref i env_0)))
                                        EMIT_END)))
    Just (ValueVar{}) -> typeErr ("local value " <> n <> " used where a storage location is required")
    Just (Var{}) -> typeErr ("local value " <> n <> " used where a storage location is required")
    Nothing -> case M.lookup n (cStorage (sC sc)) of
      Just st -> pure (st, (
                              (constantFunction (pureAction (EMIT_BEGIN ((StoragePath [Field (TE.encodeUtf8 n)]))
                              EMIT_END)))))
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
        pure (v, (CAPTURE2 pp kf $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {_ <- compiled_0 env_2;
          ps_3 <- compiled_0 env_2;
          key_4 <- compiled_1 env_2;
          pure (snocP ps_3 (encodeKey k key_4))})
          EMIT_END))
      SArray el -> do
        kf <- compileAs sc TInt ix
        pure (el, (CAPTURE2 pp kf $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {_ <- compiled_0 env_2;
          ps_3 <- compiled_0 env_2;
          i_4 <- compiled_1 env_2;
          pure (snocP ps_3 (Index (BC.pack (show i_4))))})
          EMIT_END))
      _ -> typeErr "index into a non-mapping"
  S.IndexAccess _ _ Nothing -> typeErr "empty index"
  S.MemberAccess _ p f -> do
    (st, pp) <- compileStorage sc p
    case st of
      SStruct _ fs | Just ft <- lookup f fs -> pure (ft, (CAPTURE pp $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> (`snocP` Field (TE.encodeUtf8 f)) <$> compiled_0 env_1)
        EMIT_END))
                   | otherwise -> unknown ("struct field " <> f)
      SArray _ | f == "length" -> pure (SScalar (SomeTy TInt), (CAPTURE pp $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> (`snocP` Field "length") <$> compiled_0 env_1)
        EMIT_END))
      _ -> typeErr ("member " <> f <> " of a non-struct storage value")
  e -> unsupported ("storage reference " <> T.take 60 (T.pack (show (() <$ e))))

-- Resolve the destination before writing, so gas is charged at lookup rather
-- than during a setter that may otherwise re-evaluate an index or parent.
data Destination ls = forall t. Destination (Ty t) (Code (Env ls -> SM (Maybe StoragePath, SM t, t -> SM ())))

compileDestination :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestination sc metered e = do
  Destination t action <- compileDestinationUnmetered sc metered e
  pure $ Destination t $ CAPTURE action $ \compiled_run ->
    EMIT_BEGIN (\env -> do
      (path, get, set) <- compiled_run env
      pure (path, get, \value -> do
        when (isNothing path) $ Operations.localWrite
        set value)) EMIT_END

compileDestinationUnmetered :: Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestinationUnmetered sc metered e = do
  Destination t action <- compileDestinationBody sc metered e
  pure (Destination t (typedDestination (scopeTypes sc) t action))

compileDestinationBody :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestinationBody sc metered expression = case expression of
  S.InlineBoundsCheck _ lo hi inner -> do
    Destination t prepare <- compileDestinationUnmetered sc True inner
    Refl <- sameTy TInt t
    pure $ Destination TInt $ (CAPTURE prepare $ \compiled_0 ->
      EMIT_BEGIN (\env_1 -> do {(path_2, get_3, set_3) <- compiled_0 env_1;
      value_4 <- get_3;
      when (maybe False (value_4 <) lo) $ revert ("underflow: " <> T.pack (show value_4));
      when (maybe False (value_4 >) hi) $ revert ("overflow: " <> T.pack (show value_4));
      when metered $ chargeGas 1;
      pure (path_2, pure value_4, set_3)})
      EMIT_END)
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notReference t ->
    pure $ Destination t $ EMIT_BEGIN (\env_0 -> do {when metered $ chargeGas 1;
      pure (Nothing, liftIO (readIORef (ref i env_0)), liftIO . writeIORef (ref i env_0))})
      EMIT_END
  _ | Right _ <- compileAliasLV sc expression -> compileAliasDestination sc metered expression
  _ | Right (st, pathOf) <- compileStorage' sc expression -> do
    SomeTy t <- stypeTy st
    pure $ Destination t $ (CAPTURE pathOf $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {path_2 <- compiled_0 env_1;
      when metered $ chargeGas 1;
      pure (Just path_2, readVal t path_2, writeVal t path_2)})
      EMIT_END)
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileDestinationUnmetered sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ (CAPTURE prepare $ \compiled_0 ->
          EMIT_BEGIN (\env_1 -> do {(_, get_2, set_3) <- compiled_0 env_1;
          when metered $ chargeGas 1;
          pure (Nothing, hget i <$> get_2, \value_4 -> get_2 >>= (set_3 . hset i value_4))})
          EMIT_END)
      _ -> typeErr "destination member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileDestinationUnmetered sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ (CAPTURE2 prepare indexF $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {(_, get_3, set_4) <- compiled_0 env_2;
        i_5 <- compiled_1 env_2;
        values_6 <- get_3;
        when ((i_5 < 0) || (i_5 >= fromIntegral (Seq.length values_6))) $ revert "index out of bounds";
        when metered $ chargeGas 1;
        pure (Nothing, (maybe (revert "index out of bounds") pure . Seq.lookup (fromIntegral i_5)) =<< get_3,
        \value_7 -> get_3 >>= (set_4 . Seq.update (fromIntegral i_5) value_7))})
        EMIT_END)
      TBytes -> pure $ Destination TInt $ (CAPTURE2 prepare indexF $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {(_, get_3, set_4) <- compiled_0 env_2;
        i_5 <- compiled_1 env_2;
        bytes_6 <- get_3;
        when ((i_5 < 0) || (i_5 >= fromIntegral (B.length bytes_6))) $ revert "index out of bounds";
        when metered $ chargeGas 1;
        pure (Nothing, (fromIntegral . (`B.index` fromIntegral i_5)) <$> get_3, \value_7 -> do {bytesPrime_0 <- get_3;
        let {(before_8, after_9) = B.splitAt (fromIntegral i_5) bytesPrime_0};
        set_4 (before_8 <> (B.singleton (fromIntegral value_7) <> B.drop 1 after_9))})})
        EMIT_END)
      _ -> typeErr "destination index into a non-array"
  _ -> do
    LV t get set <- compileLVUnmetered sc expression
    pure $ Destination t $ (CAPTURE2 get set $ \compiled_0 compiled_1 ->
      EMIT_BEGIN (\env_2 -> do {when metered $ chargeGas 1;
      pure (Nothing, compiled_0 env_2, compiled_1 env_2)})
      EMIT_END)
  where
    notReference :: Ty t -> Bool
    notReference = \case TRef _ -> False; TAlias{} -> False; _ -> True

compileAliasDestination :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileAliasDestination sc metered e = do
  Destination t action <- compileAliasDestinationBody sc metered e
  pure (Destination t (typedDestination (scopeTypes sc) t action))

compileAliasDestinationBody :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileAliasDestinationBody sc metered expression = case expression of
  S.Variable _ name | Just (Var _ (TAlias t _) i) <- lookupVar sc name ->
    pure $ Destination t $ (
                              (EMIT_BEGIN (\env_0 -> do {value_1 <- liftIO $ readIORef (ref i env_0);
                              when metered $ chargeGas 1;
                              pure $ (case value_1 of
                              {Left path_2 -> (Just path_2, readVal t path_2, writeVal t path_2);
                              Right current_3 -> (Nothing, pure current_3,
                              liftIO . (writeIORef (ref i env_0) . Right))})})
                              EMIT_END))
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ (CAPTURE prepare $ \compiled_0 ->
          EMIT_BEGIN (\env_1 -> do {(parentPath_2, get_3, set_4) <- compiled_0 env_1;
          when metered $ chargeGas 1;
          pure $ (case parentPath_2 of
          {Just path_5 -> let child_6 = snocP path_5 (Field (TE.encodeUtf8 field))
          in (Just child_6, readVal t child_6, writeVal t child_6);
          Nothing -> (Nothing, hget i <$> get_3, \value_7 -> get_3 >>= (set_4 . hset i value_7))})})
          EMIT_END)
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ (CAPTURE2 prepare indexF $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {initial_3@(parentPath_4, _, _) <- compiled_0 env_2;
        (path_5, get_6, set_7) <- maybe (pure initial_3) (const (compiled_0 env_2)) parentPath_4;
        i_8 <- compiled_1 env_2;
        location_9 <- case path_5 of
        {Just storage_10 -> let child_11 = snocP storage_10 (Index (BC.pack (show i_8)))
        in pure (Just child_11, readVal t child_11, writeVal t child_11);
        Nothing -> do {values_12 <- get_6;
        when ((i_8 < 0) || (i_8 >= fromIntegral (Seq.length values_12))) $ revert "alias array index out of bounds";
        pure (Nothing,
        (maybe (revert "alias array index out of bounds") pure . Seq.lookup (fromIntegral i_8)) =<< get_6,
        \value_13 -> get_6 >>= (set_7 . Seq.update (fromIntegral i_8) value_13))}};
        when metered $ chargeGas 1;
        pure location_9})
        EMIT_END)
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileAssignment :: Scope ls r -> Bool -> Bool -> Expression -> Expression -> C (CE ls)
compileAssignment sc destinationFirst metered l r
  | S.Variable _ name <- l
  , not scalarSource
  , Just (Var _ t i) <- lookupVar sc name
  , plainLocal t = do
      valueF <- compileAs sc t r
      let chargedValue = meterLocalValue valueF
          evaluateValue = if not metered then chargedValue
            else if destinationFirst
              then (
                                        functionBefore 1 chargedValue)
              else (functionAfter 1 chargedValue)
      pure $ CE t $ typedCode (scopeTypes sc) t (CAPTURE evaluateValue $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> do {value_2 <- compiled_0 env_1;
        liftIO $ writeIORef (ref i env_1) value_2;
        pure value_2})
        EMIT_END)
  | S.Variable{} <- l
  , not scalarSource
  , Right (SScalar (SomeTy t), pathOf) <- compileStorage' sc l = do
      valueF <- compileAs sc t r
      let pathF = if metered
            then (functionAfter 1 pathOf)
            else pathOf
          write = case (t, compileE sc r) of
            (TContract _, Right (CE TAddr _)) -> (
                                        (EMIT_BEGIN (writeSlot TAddr)
                                        EMIT_END))
            _ -> writePrimitive t
      pure $ CE t $ typedCode (scopeTypes sc) t $ functionStore destinationFirst write pathF valueF
  | otherwise = compileGeneralAssignment sc destinationFirst metered l r
  where
    scalarSource = case compileStorage sc r of Right (SScalar{}, _) -> True; _ -> False
    plainLocal :: Ty t -> Bool
    plainLocal = \case TRef{} -> False; TAlias{} -> False; _ -> True


functionStore :: Bool -> Code (StoragePath -> a -> SM ()) -> Code (env -> SM StoragePath) -> Code (env -> SM a) -> Code (env -> SM a)
functionStore destinationFirst setter path value = staticFunction residual $ \environment ->
  let location = applyCode path environment
      evaluated = applyCode value environment
      store p v = thenAction (applyCode (applyCode setter p) v) (pureAction v)
   in if destinationFirst
        then bindAction location $ staticFunction
          (CAPTURE2 setter evaluated $ \compiled_setter compiled_value ->
            EMIT_BEGIN (\p -> do {v <- compiled_value; compiled_setter p v; pure v})
            EMIT_END) $ \p ->
                  bindAction evaluated $ staticFunction
                    (CAPTURE2 setter p $ \compiled_setter compiled_path ->
                      EMIT_BEGIN (\v -> compiled_setter compiled_path v >> pure v)
                      EMIT_END) (store p)
        else bindAction evaluated $ staticFunction
          (CAPTURE2 setter location $ \compiled_setter compiled_path ->
            EMIT_BEGIN (\v -> do {p <- compiled_path; compiled_setter p v; pure v})
            EMIT_END) $ \v ->
                  bindAction location $ staticFunction
                    (CAPTURE2 setter v $ \compiled_setter compiled_value ->
                      EMIT_BEGIN (\p -> compiled_setter p compiled_value >> pure compiled_value)
                      EMIT_END) (\p -> store p v)
  where
    residual = actionFunction $
      (CAPTURE3 (composedAction path) (composedAction value) setter $ \compiled_path compiled_value compiled_setter ->
        if destinationFirst
        then (EMIT_BEGIN (do {p <- compiled_path; v <- compiled_value; liftAction (compiled_setter p v); pure v})
          EMIT_END)
        else (EMIT_BEGIN (do {v <- compiled_value; p <- compiled_path; liftAction (compiled_setter p v); pure v})
          EMIT_END))

compileGeneralAssignment :: Scope ls r -> Bool -> Bool -> Expression -> Expression -> C (CE ls)
compileGeneralAssignment sc destinationFirst metered l r = do
  let indexedMemory = case l of
        S.IndexAccess _ _ _ -> case compileStorage sc l of Left _ -> True; _ -> False
        _ -> False
  Destination t prepare <- compileDestination sc (metered && not indexedMemory) l
  extraParent <- case l of
    S.IndexAccess _ parent _ | not indexedMemory -> do
      (_, parentF) <- compileStorage sc parent
      pure (CAPTURE parentF $ \compiled_0 -> EMIT_BEGIN (void . compiled_0)
        EMIT_END)
    _ -> pure (constantFunction (pureAction unitCode))
  case compileStorage sc r of
    Right (SScalar (SomeTy sourceTy), sourceF) -> do
      _ <- compileAs sc t r
      pure $ CE t $ (CAPTURE3 sourceF prepare extraParent $ \compiled_0 compiled_1 compiled_2 ->
        EMIT_BEGIN (\env_3 -> do {let {source_4 = do {path_5 <- compiled_0 env_3;
        basic_8 <- readBasic path_5;
        value_9 <- either diverge pure (fromBasic sourceTy basic_8) >>= (fromDyn t . Dyn sourceTy);
        pure (path_5, basic_8, value_9)}};
        (location_10, (path_11, basic_12, value_13)) <- if destinationFirst
        then ((,) <$> compiled_1 env_3) <*> source_4
        else do {src_14 <- source_4;
        compiled_2 env_3;
        dst_15 <- compiled_1 env_3;
        pure (dst_15, src_14)};
        case location_10 of
        {(Just destination_16, _, _) -> case basic_12 of
        {BDefault -> Runtime.copyStorage destination_16 path_11;
        _ -> writeBasic destination_16 basic_12};
        (_, _, set_19) -> set_19 value_13};
        pure value_13})
        EMIT_END)
    _ -> do
      valueF <- compileAs sc t r
      let addressValue :: Bool
          addressValue = case (t, compileE sc r) of
            (TContract _, Right (CE TAddr _)) -> True
            _ -> False
      pure $ CE t $ (CAPTURE3 prepare valueF extraParent $ \compiled_0 compiled_1 compiled_2 ->
        EMIT_BEGIN (\env_3 -> do {(location_4, value_5) <- if destinationFirst
        then ((,) <$> compiled_0 env_3) <*> compiled_1 env_3
        else do {value_6 <- compiled_1 env_3;
        compiled_2 env_3;
        location_7 <- compiled_0 env_3;
        pure (location_7, value_6)};
        case (location_4, addressValue) of
        {((Just path_8, _, _), True) -> case t of
        {TContract _ -> writeSlot TAddr path_8 value_5;
        _ -> diverge "contract assignment witness"};
        ((_, _, set_9), _) -> set_9 value_5};
        pure value_5})
        EMIT_END)

-- ---------------------------------------------------------------- calls

compileCall :: forall ls r. Scope ls r -> Expression -> [Expression] -> C (CE ls)
compileCall sc callee args = case callee of
  S.Variable _ "require" -> requireLike "require"
  S.Variable _ "assert" -> requireLike "assert"
  S.Variable _ "revert" -> case args of
    [] -> pure $ CE TUnit ((
                              (constantFunction (EMIT_BEGIN (revert "")
                              EMIT_END))))
    [m] -> do mf <- compileAs sc TStr m; pure $ CE TUnit (CAPTURE mf $ \compiled_0 ->
               EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= revert)
               EMIT_END)
    _ -> typeErr "revert takes at most one argument"
  S.Variable _ "keccak256" -> case args of
    [x] | Right (CE TBytes f) <- compileE sc x -> pure $ CE TBytes (CAPTURE f $ \compiled_0 ->
      EMIT_BEGIN (\env -> compiled_0 env >>= Metered.keccak256)
      EMIT_END)
    _ -> builtinCall TStr "keccak256"
  S.MemberAccess _ (S.Variable _ "abi") member ->
    fromMaybe (unknown ("builtin abi." <> member)) (lookupBuiltinCall sc True ("abi." <> member) args)
  S.MemberAccess _ target "derive" -> deriveCall target
  S.Variable _ "derive" -> deriveCall (S.Variable (S.extractExpression callee) "this")
  S.Variable _ n | Just k <- castTarget n -> cast k
  S.Variable _ n | Just call <- lookupBuiltinCall sc False n args -> call
  S.Variable _ n | Just names <- lookupEnum c n -> case args of
    [x] -> do f <- compileAs sc TInt x
              pure $ CE (TEnum n names) $ (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {v_2 <- compiled_0 env_1;
                when ((v_2 < 0) || (v_2 >= fromIntegral (length names))) $ revert ("enum out of range: " <> T.pack (show v_2));
                pure (enumValue v_2)})
                EMIT_END)
    _ -> typeErr "enum conversion takes one argument"
  S.Variable _ n | Just _ <- lookupStruct c n -> do
    SomeTy t <- resolveName c n
    case t of
      TStruct _ fs -> do f <- compileFields sc fs args; pure (CE t f)
      _ -> err Internal "struct type"
  S.Variable _ n | M.member n (cCC c ^. contracts) -> case args of
    [x] -> do CE t f <- compileE sc x
              case t of
                TAddr -> pure (CE (TContract n) (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\environment -> compiled_0 environment >>= Metered.contractCast)
                  EMIT_END))
                TContract _ -> pure (CE (TContract n) (CAPTURE f $ \compiled_0 ->
                  EMIT_BEGIN (\environment -> compiled_0 environment >>= Metered.contractCast)
                  EMIT_END))
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
          [] -> pure (constantCode et (defaultOf et))
          [x] -> compileAs sc et x
          _ -> typeErr "push takes at most one argument"
        pure $ CE TInt $ (CAPTURE2 vf pp $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {v_3 <- compiled_0 env_2;
          _ <- compiled_1 env_2;
          ps_4 <- compiled_1 env_2;
          Operations.invoke 0 (pure ());
          n_5 <- readSlot TInt (snocP ps_4 (Field "length"));
          writeSlot TInt (snocP ps_4 (Field "length")) (n_5 + 1);
          writeVal et (snocP ps_4 (Index (BC.pack (show n_5)))) v_3;
          pure (n_5 + 1)})
          EMIT_END)
    Right _ -> typeErr "push on a non-array"
    Left _ -> do
      -- a local array is a Seq: push is a typed snoc, returns the new length
      LV tt get set <- compileLV sc target
      case tt of
        TArr et -> do
          vf <- case args of
            [] -> pure (constantCode et (defaultOf et))
            [x] -> compileAs sc et x
            _ -> typeErr "push takes at most one argument"
          pure $ CE TInt $ (CAPTURE3 vf get set $ \compiled_0 compiled_1 compiled_2 ->
            EMIT_BEGIN (\env_3 -> do {v_4 <- compiled_0 env_3;
            chargeGas 1;
            Operations.invoke 0 (pure ());
            xs_5 <- chargeAfter 1 (compiled_1 env_3);
            compiled_2 env_3 (xs_5 Seq.|> v_4);
            pure (fromIntegral (Seq.length xs_5 + 1))})
            EMIT_END)
        _ -> typeErr ("push on " <> showTy tt)
  S.MemberAccess _ target m -> do
    CE tt tf <- compileE sc target
    case tt of
      TContract cn | Nothing <- usingLib tt m -> externalCall cn tf m
      TAddr | m == "balance" -> unsupported "address.balance"
      TDecimal | m == "truncate", [places] <- args -> do
        placesF <- compileAs sc TInt places
        pure $ CE TDecimal (CAPTURE2 placesF tf $ \compiled_0 compiled_1 ->
          EMIT_BEGIN (\env_2 -> do {n_3 <- compiled_0 env_2;
          value_4 <- compiled_1 env_2;
          pure $ roundTo' truncate (fromInteger n_3) value_4})
          EMIT_END)
      _ -> case usingLib tt m of
        Just (lib, fe) -> do
          -- `using L for T`: x.f(args) == L.f(x, args)
          SomeSig sig <- (\(FunEntry es _) -> es) fe
          case sig of
            SigCons t0 rest -> do
              Refl <- sameTy t0 tt
              let FunEntry _ efun = fe
              CE rt' k <- applyCall sc rest (
                CAPTURE tf $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {x_2 <- compiled_0 env_1;
                chargeGas 1;
                pure (link sig efun x_2)})
                EMIT_END) args
              pure (CE rt' k)
            SigNil _ -> typeErr ("library function " <> lib <> "." <> m <> " takes no arguments")
        Nothing -> unsupported ("method " <> m <> " on " <> showTy tt)
  S.NewExpression _ ty mSalt -> do
    saltF <- traverse (\salt -> do CE st sf <- compileE sc salt; pure (functionMap (primitiveCode (DynPrimitive st)) sf)) mSalt
    SomeTy t <- resolveTy c ty
    case t of
      TContract n -> do
        target <- maybe (unknown ("contract " <> n)) pure (M.lookup n (cCC c ^. contracts))
        SomeSig sig <- maybe (pure (SomeSig (SigNil TUnit))) (funSig (mkCtx (cCC c) target)) (target ^. constructor)
        argsF <- typedArgs sig args
        let optionalSalt = optionalCode saltF
        pure $ CE t $ (CAPTURE2 optionalSalt argsF $ \compiled_0 compiled_1 ->
          EMIT_BEGIN (\env_2 -> Runtime.createContract n (($ env_2) <$> compiled_0) (compiled_1 env_2))
          EMIT_END)
      _ -> typeErr ("call of new " <> showTy t)
  _ -> unsupported "call of a computed function"
  where
    c = sC sc
    key n = n <> "/" <> T.pack (show (length args))

    linkCall :: FunEntry -> C (CE ls)
    linkCall (FunEntry esig efun) = do
      SomeSig sig <- esig
      let getter = case callee of
            S.Variable _ n -> M.member n (cStorage c) && not (M.member n (cContract c ^. functions))
            _ -> False
          hasParent = case callee of S.MemberAccess{} -> True; _ -> False
      let simple = not getter && scalarSignature sig && case callee of
            S.Variable _ n -> case M.lookup n (cContract c ^. functions) of
              Just declaration -> null (declaration ^. funcOverload) && simpleScalarFunction (length args) declaration
              Nothing -> False
            _ -> False
          operation = if simple
            then EMIT_BEGIN (linkScalar sig efun) EMIT_END
            else EMIT_BEGIN (linkWithCharge (not getter) sig efun) EMIT_END
          target = pureAction operation
          linked = if hasParent then beforeAction 2 target else target
      applyCall sc sig (constantFunction linked) args

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
      [x] -> do f <- compileAs sc TBool x; pure $ CE TUnit (CAPTURE f $ \compiled_0 ->
                 EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\b_2 -> Operations.invoke 0 (unless b_2 (revert nm))))
                 EMIT_END)
      [x, m] -> do f <- compileAs sc TBool x; mf <- compileAs sc TStr m
                   pure $ CE TUnit (CAPTURE2 f mf $ \compiled_0 compiled_1 ->
                     EMIT_BEGIN (\env_2 -> do {b_3 <- compiled_0 env_2;
                     message_4 <- compiled_1 env_2;
                     Operations.invoke (fromIntegral (B.length (TE.encodeUtf8 message_4))) (unless b_3 (revert message_4))})
                     EMIT_END)
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
      pure $ CE TVariadic (CAPTURE f $ \compiled_run -> EMIT_BEGIN (\env -> compiled_run env >>= Metered.variadic) EMIT_END)
    cast "string" | [x] <- args = do
      CE t raw <- compileE sc x
      case t of
        TStr -> pure $ CE TStr (functionUnary (typedUnary t TStr (EMIT_BEGIN MeteredCasts.string EMIT_END)) raw)
        TAddr -> pure $ CE TStr (functionUnary (typedUnary t TStr (EMIT_BEGIN MeteredCasts.string EMIT_END)) raw)
        TInt -> pure $ CE TStr (functionUnary (typedUnary t TStr (EMIT_BEGIN MeteredCasts.string EMIT_END)) raw)
        TBool -> pure $ CE TStr (functionUnary (typedUnary t TStr (EMIT_BEGIN MeteredCasts.string EMIT_END)) raw)
        _ -> builtinCall TStr "string"
    cast k | k `elem` ["string", "decimal"] = do
      SomeTy t <- castTy k
      builtinCall t k
    cast k = case args of
      [x] -> do
        CE t raw <- compileE sc x
        case (k, t) of
          ("address", TAddr) -> pure $ CE TAddr (functionUnary (typedUnary t TAddr (EMIT_BEGIN MeteredCasts.address EMIT_END)) raw)
          ("address", TContract _) -> pure $ CE TAddr (functionUnary (typedUnary t TAddr (EMIT_BEGIN MeteredCasts.address EMIT_END)) raw)
          ("address", TStr) -> builtinCall TAddr "address"
          ("address", TBytes) -> builtinCall TAddr "address"
          ("int", TDecimal) -> builtinCall TInt "int"
          ("int", TStr) -> builtinCall TInt "int"
          ("address", TInt) -> pure $ CE TAddr (functionUnary (typedUnary t TAddr (EMIT_BEGIN MeteredCasts.address EMIT_END)) raw)
          ("int", TInt) -> pure $ CE TInt (functionUnary (typedUnary t TInt (EMIT_BEGIN MeteredCasts.int EMIT_END)) raw)
          ("int", TEnum _ _) -> pure $ CE TInt (functionUnary (typedUnary t TInt (EMIT_BEGIN (MeteredCasts.int . enumNumber) EMIT_END)) raw)
          ("int", TAddr) -> pure $ CE TInt (functionUnary (typedUnary t TInt (EMIT_BEGIN MeteredCasts.int EMIT_END)) raw)
          ("int", TBytes) -> pure $ CE TInt (functionUnary (typedUnary t TInt (EMIT_BEGIN MeteredCasts.int EMIT_END)) raw)
          ("bytes", TInt) -> pure $ CE TBytes (functionUnary (typedUnary t TBytes (EMIT_BEGIN MeteredCasts.bytes32 EMIT_END)) raw)
          ("bytes", TStr) -> pure $ CE TBytes (functionUnary (typedUnary t TBytes (EMIT_BEGIN MeteredCasts.bytes EMIT_END)) raw)
          ("bytes", TBytes) -> pure $ CE TBytes (functionUnary (typedUnary t TBytes (EMIT_BEGIN MeteredCasts.bytes EMIT_END)) raw)
          ("bool", TBool) -> pure $ CE TBool (functionUnary (typedUnary t TBool (EMIT_BEGIN MeteredCasts.bool EMIT_END)) raw)
          -- explicit conversion out of the dynamic world: checked once at runtime
          (_, TVariadic) -> do
            SomeTy target <- castTy k
            pure $ CE target $ (CAPTURE raw $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do
              {values <- compiled_0 env_1;
              Operations.invokeSized values $ case values of
                {[d_2] -> fromDyn target d_2;
                ds_3 -> diverge ("converting " <> (T.pack (show (length ds_3)) <> (" dynamic values to " <> showTy target)))}})
              EMIT_END)
          (_, TRaw) -> do
            SomeTy target <- castTy k
            pure $ CE target (CAPTURE raw $ \compiled_0 ->
              EMIT_BEGIN (\env_1 -> do {values <- compiled_0 env_1;
                Operations.invokeSized values (fromDyn target (Dyn TRaw values))})
              EMIT_END)
          _ -> typeErr ("cannot convert " <> showTy t <> " to " <> k)
      _ -> typeErr "conversion takes one argument"

    castTy :: T.Text -> C SomeTy
    castTy = \case
      "address" -> pure (SomeTy TAddr); "int" -> pure (SomeTy TInt); "bool" -> pure (SomeTy TBool)
      "decimal" -> pure (SomeTy TDecimal); "string" -> pure (SomeTy TStr); "bytes" -> pure (SomeTy TBytes); k -> unknown ("type " <> k)

    deriveCall target = do
      addressF <- compileAs sc TAddr target
      argsF <- dynArgs args
      pure $ CE TAddr $ (CAPTURE2 argsF addressF $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {ds_3 <- compiled_0 env_2;
        address_4 <- compiled_1 env_2;
        Builtins.derive address_4 ds_3})
        EMIT_END)

    builtinCall :: Ty t -> T.Text -> C (CE ls)
    builtinCall t name = do
      let abiMember = case callee of S.MemberAccess _ (S.Variable _ "abi") _ -> True; _ -> False
      selected <- maybe (unknown ("builtin " <> name)) pure (lookupBuiltinCall sc abiMember name args)
      CE actual action <- selected
      Refl <- sameTy t actual
      pure $ CE t action

    lowLevel :: CallKind -> Expression -> C (CE ls)
    lowLevel kind target = do
      CE tt tf <- compileE sc target
      addrOf <- (case tt of
        TAddr -> pure tf
        TContract _ -> pure tf
        _ -> typeErr (".call on " <> showTy tt)) :: C (Code (Env ls -> SM Address))
      (nameE, rest) <- case args of
        (x : xs) -> pure (x, xs)
        [] -> typeErr ".call needs a function name"
      CE nameTy nameF <- compileE sc nameE
      argsF <- dynArgs rest
      case nameTy of
        TStr -> pure $ CE TRaw $ (CAPTURE3 nameF argsF addrOf $ \compiled_0 compiled_1 compiled_2 ->
          EMIT_BEGIN (\env_3 -> do {n_4 <- compiled_0 env_3;
          ds_5 <- compiled_1 env_3;
          a_6 <- compiled_2 env_3;
          Runtime.callContract kind a_6 n_4 ds_5 (Just (SomeTy TRaw))})
          EMIT_END)
        _ -> pure $ CE TRaw $ (CAPTURE3 nameF argsF addrOf $ \compiled_0 compiled_1 compiled_2 ->
          EMIT_BEGIN (\env_3 -> do {n_4 <- compiled_0 env_3;
          ds_5 <- compiled_1 env_3;
          _ <- compiled_2 env_3;
          Builtins.invalidLowLevel (Dyn nameTy n_4 : ds_5)})
          EMIT_END)

    externalCall :: T.Text -> (Code (Env ls -> SM Address)) -> T.Text -> C (CE ls)
    externalCall cn addrOf m = do
      target <- maybe (unknown ("contract " <> cn)) pure (M.lookup cn (cCC c ^. contracts))
      esig <- maybe (unknown ("function " <> cn <> "." <> key m)) pure (findSig (cSigs (mkCtx (cCC c) target)) m (length args))
      SomeSig sig <- esig
      argsF <- typedArgs sig args
      let r = sigRet sig
      pure $ CE r $ (CAPTURE2 argsF addrOf $ \compiled_0 compiled_1 ->
        EMIT_BEGIN (\env_2 -> do {ds_3 <- compiled_0 env_2;
        _ <- compiled_1 env_2;
        a_4 <- compiled_1 env_2;
        out_6 <- Runtime.callContract Call a_4 m ds_3 (Just (SomeTy r));
        case r of
        {TUnit -> pure ();
        TRaw -> pure out_6;
        TVariadic -> pure out_6;
        _ -> case out_6 of
        {[d_7] -> fromDyn r d_7;
        _ -> fromDyn r (Dyn TVariadic out_6)}}})
        EMIT_END)

    typedArgs :: Sig args r' -> [Expression] -> C (Code (Env ls -> SM [Dyn]))
    typedArgs = compileTypedArgs sc

    dynArgs = compileDynArgs sc

#include "BuiltinCalls.inc"

compileTypedArgs :: Scope ls r -> Sig args r' -> [Expression] -> C (Code (Env ls -> SM [Dyn]))
compileTypedArgs _ (SigNil _) [] = pure (constantFunction (pureAction (primitiveCode EmptyListPrimitive)))
compileTypedArgs sc (SigCons TVariadic (SigNil _)) xs | not (singleVariadic xs) = compileDynArgs sc xs
  where
    singleVariadic [x] = case compileE sc x of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
compileTypedArgs sc (SigCons t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileTypedArgs sc rest xs
  pure (CAPTURE2 f k $ \compiled_0 compiled_1 ->
    EMIT_BEGIN (\env_2 -> ((:) <$> (Dyn t <$> compiled_0 env_2)) <*> compiled_1 env_2)
    EMIT_END)
compileTypedArgs _ _ _ = typeErr "argument count mismatch"

compileDynArgs :: Scope ls r -> [Expression] -> C (Code (Env ls -> SM [Dyn]))
compileDynArgs sc [x] = do
  CE t f <- compileE sc x
  pure $ case t of
    TVariadic -> f
    TRaw -> (CAPTURE f $ \compiled_0 ->
      EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\values_2 -> pure $ (case values_2 of
      {[Dyn (TVariadic)
      remaining_3] -> remaining_3;
      _ -> [Dyn TRaw values_2]})))
      EMIT_END)
    _ -> (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> ((: []) . Dyn t) <$> compiled_0 env_1)
      EMIT_END)
compileDynArgs sc xs = do
  fs <- forM xs $ \x -> do CE t f <- compileE sc x; pure (functionMap (primitiveCode (DynPrimitive t)) f)
  pure $ (CAPTURES fs $ \compiled_0 ->
    EMIT_BEGIN (\env_1 -> mapM ($ env_1) compiled_0 >>= (\values_2 -> pure $ (case reverse values_2 of
    {Dyn (TVariadic)
    remaining_3 : rest_4 -> reverse rest_4 ++ remaining_3;
    Dyn (TRaw)
    [Dyn (TVariadic)
    remaining_5] : rest_6 -> reverse rest_6 ++ remaining_5;
    _ -> values_2})))
    EMIT_END)

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

-- Evaluate arguments left to right into the exactly typed action.
applyCall :: Scope ls r -> Sig args r' -> (Code (Env ls -> SM (Fn args r'))) -> [Expression] -> C (CE ls)
applyCall sc sig mf expressions = do
  arguments <- callArguments sc sig expressions
  pure $ CE (sigRet sig) $ functionCall (typedApplication sig) mf arguments


functionUnary :: Code (a -> SM b) -> Code (env -> SM a) -> Code (env -> SM b)
functionUnary operation value = staticFunction residual $ \environment ->
  bindAction (applyCode value environment) operation
  where
    residual = actionFunction $
      (CAPTURE2 (composedAction value) operation $ \compiled_value compiled_operation ->
        EMIT_BEGIN (do {v <- compiled_value; liftAction (compiled_operation v)})
        EMIT_END)

functionConditional :: Code (env -> SM Bool) -> Code (env -> SM a) -> Code (env -> SM a) -> Code (env -> SM a)
functionConditional condition yes no = actionFunction $
  (CAPTURE3 (composedAction condition) (composedAction yes) (composedAction no) $ \compiled_condition compiled_yes compiled_no ->
    EMIT_BEGIN (do {c <- compiled_condition; if c then compiled_yes else compiled_no})
    EMIT_END)

functionCall :: Code (f -> args -> SM a) -> Code (env -> SM f) -> Code (env -> SM args) -> Code (env -> SM a)
functionCall application target arguments = staticFunction residual $ \environment ->
  let linked = applyCode target environment
      prepared = applyCode arguments environment
      withArguments = staticFunction
        (CAPTURE2 application linked $ \compiled_apply compiled_linked ->
          EMIT_BEGIN (\values -> do {function <- compiled_linked; compiled_apply function values})
          EMIT_END) $ \values ->
          bindAction linked $ staticFunction
            (CAPTURE2 application values $ \compiled_apply compiled_values ->
              EMIT_BEGIN (\function -> compiled_apply function compiled_values)
              EMIT_END) $ \function ->
                    applyCode (applyCode application function) values
   in bindAction prepared withArguments
  where
    residual = actionFunction $
      (CAPTURE3 (composedAction arguments) (composedAction target) application $ \compiled_arguments compiled_target compiled_apply ->
        EMIT_BEGIN (do {values <- compiled_arguments; function <- compiled_target; liftAction (compiled_apply function values)})
        EMIT_END)

functionBinary :: Code (a -> b -> SM c) -> Code (env -> SM a) -> Code (env -> SM b) -> Code (env -> SM c)
functionBinary operation left right = staticFunction residual $ \environment ->
  let lhs = applyCode left environment
      rhs = applyCode right environment
      withLeft = staticFunction
        (CAPTURE2 operation rhs $ \compiled_operation compiled_right ->
          EMIT_BEGIN (\a -> do {b <- compiled_right; compiled_operation a b})
          EMIT_END) $ \a ->
                bindAction rhs (applyCode operation a)
   in bindAction lhs withLeft
  where
    residual = actionFunction $
      (CAPTURE3 (composedAction left) (composedAction right) operation $ \compiled_left compiled_right compiled_operation ->
        EMIT_BEGIN (do {a <- compiled_left; b <- compiled_right; liftAction (compiled_operation a b)})
        EMIT_END)

-- Unroll the checked signature at compilation, rather than dispatching on it
-- for every call. Argument evaluation remains left to right before linking.
typedApplication :: Sig args r -> Code (Fn args r -> HL args -> SM r)
typedApplication signature@(SigNil _) = typedCall signature $ staticFunction
  (primitiveCode ApplyLastPrimitive) constantFunction
typedApplication signature@(SigCons _ rest) = typedCall signature $
  let next = typedApplication rest
      application = (CAPTURE next $ \compiled_0 -> EMIT_BEGIN (applyNext compiled_0)
        EMIT_END)
   in staticFunction application $ \function ->
        let arguments = (CAPTURE2 next function $ \compiled_0 compiled_1 -> EMIT_BEGIN (applyNext compiled_0 compiled_1)
             EMIT_END)
         in staticFunction arguments $ \values -> case codeForm values of
              HListValue value remaining -> applyCode (applyCode next (applyCode function value)) remaining
              _ -> applyResidual arguments values

callArguments :: Scope ls r -> Sig args r' -> [Expression] -> C (Code (Env ls -> SM (HL args)))
callArguments _ (SigNil _) [] = pure (constantFunction (pureAction (primitiveCode HNilPrimitive)))
callArguments sc (SigCons TVariadic (SigNil _)) expressions
  | not (singleVariadic expressions) = do
      -- a trailing `variadic` parameter absorbs the remaining arguments
      arguments <- compileDynArgs sc expressions
      pure $ (CAPTURE arguments $ \compiled_0 -> EMIT_BEGIN (\env_1 -> (:* HNil) <$> compiled_0 env_1)
        EMIT_END)
  where
    singleVariadic [expression] = case compileE sc expression of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
callArguments sc (SigCons t rest) (expression : expressions) = do
  value <- compileAs sc t expression
  remaining <- callArguments sc rest expressions
  pure $ (functionPair hlistFunction value remaining)
callArguments _ _ _ = typeErr "argument count mismatch"

scalarSignature :: Sig args r -> Bool
scalarSignature (SigNil result) = scalarType result
scalarSignature (SigCons argument rest) = scalarType argument && scalarSignature rest

scalarType :: Ty a -> Bool
scalarType = \case
  TInt -> True; TDecimal -> True; TBool -> True; TAddr -> True; TStr -> True; TBytes -> True
  _ -> False

simpleScalarFunction :: Int -> Func -> Bool
simpleScalarFunction arity declaration =
  length (declaration ^. funcArgs) == arity && null (declaration ^. funcModifiers) &&
  all (maybe True T.null . fst) (declaration ^. funcVals) && case declaration ^. funcContents of
    Just [S.Return (Just expression) _] -> simple expression
    _ -> False
  where
    parameters = [name | (Just name, _) <- declaration ^. funcArgs]
    simple = \case
      S.Variable _ name -> name `elem` parameters
      S.NumberLiteral{} -> True; S.DecimalLiteral{} -> True; S.BoolLiteral{} -> True
      S.StringLiteral{} -> True; S.AddressLiteral{} -> True; S.HexaLiteral{} -> True
      S.Binary _ operator left right -> operator `elem` ["+", "-", "*", "/", "%", "**", "<<", ">>", "&", "|", "^", "==", "!=", "<", ">", "<=", ">=", "&&", "||"] && simple left && simple right
      S.Unitary _ operator value -> operator `elem` ["!", "-", "~", "+"] && simple value
      S.Ternary _ condition yes no -> all simple [condition, yes, no]
      S.InlineBoundsCheck _ _ _ value -> simple value
      _ -> False

linkScalar :: Sig args r -> C Fun -> Fn args r
linkScalar sig = \case
  Right (Fun _ sig' function) | Just Refl <- sigEq sig sig' -> chargeFunction sig (linkedAction function)
  Right (Fun n _ _) -> throwFn sig ("internal: linked signature mismatch for " <> n)
  Left e -> throwFn sig ("callee failed to compile: " <> showErr e)

-- Link a call site to the callee once; the signature was already checked against the AST,
-- so the mismatch branch is unreachable.  A callee that failed to compile throws when called.
link :: Sig args r -> C Fun -> Fn args r
link sig = linkWithCharge True sig

linkWithCharge :: Bool -> Sig args r -> C Fun -> Fn args r
linkWithCharge metered sig = \case
  Right (Fun n sig' f) | Just Refl <- sigEq sig sig' -> typedReturns sig (Runtime.internalFrame n sig (if metered then chargeFunction sig (linkedAction f) else linkedAction f))
  Right (Fun n _ _) -> throwFn sig ("internal: linked signature mismatch for " <> n)
  Left e -> throwFn sig ("callee failed to compile: " <> showErr e)

chargeFunction :: Sig args r -> Fn args r -> Fn args r
chargeFunction signature = go signature ()
  where
    go :: SharedSize.FunctionArguments values => Sig as result -> values -> Fn as result -> Fn as result
    go (SigNil _) = \values action -> Operations.functionEntry values >> action
    go (SigCons t rest) = withGasArgument t $ \adapt ->
      let next = go rest
       in next `seq` \values f value -> next (adapt value, values) (f value)

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
paramScope :: CCtx -> Sig args r -> [T.Text] -> Scope (RefTypes args) r
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
  let ordinary
        | null (f ^. funcModifiers), null names = do
            if valueParameters c sig argNames body
              then do
                arguments <- compileValueParameters sig argNames (Scope [] r [] Nothing c) body
                pure (applyCode arguments emptyEnvironment)
              else do
                bodyAction <- compileBlockWith ReturnValue sc0 body
                pure $ compileArguments sig bodyAction
        | otherwise = do
        inner <- case (r, names) of
          -- a single named return value is a local initialised to its default
          (_, [rn]) | [_] <- f ^. funcVals -> do
            k <- withModifiers (pushVar rn r sc0) { sNamedRet = [rn] } (f ^. funcModifiers) body
            pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {rr_2 <- liftIO (newIORef (defaultOf r));
              compiled_0 (rr_2 :& env_1) >>= (\case
              {Next -> Ret <$> liftIO (readIORef rr_2);
              flow_3 -> pure flow_3})})
              EMIT_END)
          -- several named return values: locals, gathered by a bare `return`
          (TTuple fs, _ : _ : _) | length names == fieldsLen fs -> namedReturns sc0 fs names (f ^. funcModifiers) body
          _ -> withModifiers sc0 (f ^. funcModifiers) body
        let action = (CAPTURE inner $ \compiled_0 -> EMIT_BEGIN (mkFn sig $ (\env_1 -> compiled_0 env_1 >>= (\case
             {Ret v_2 -> pure v_2;
             RetDynamic ds_3 -> liftIO $ (throwIO $ ForwardReturn ds_3);
             _ -> pure (defaultOf r)})))
             EMIT_END)
        pure action
  action <- case sig of
    SigNil TUnit | null (f ^. funcModifiers), null names,
      Just compiled <- compileLinearInteger c body -> pure compiled
    _ -> ordinary
  pure $ makeFun name sig $ namedFunction (cName c <> "." <> name <> "/" <> T.pack (show (sigArity sig))) f action

-- Parameters which need no mutable frame use values throughout their body. The
-- signature is consumed here; execution contains ordinary argument lambdas.
valueParameters :: CCtx -> Sig args r -> [T.Text] -> [Statement] -> Bool
valueParameters c signature names body = go signature names
  where
    sc = Scope [] (sigRet signature) [] Nothing c
    go :: Sig as result -> [T.Text] -> Bool
    go (SigNil _) _ = True
    go (SigCons t rest) (name : remaining) =
      valueLocal t && valueLocalTail sc name body && go rest remaining
    go SigCons{} [] = False

compileValueParameters :: Sig args r -> [T.Text] -> Scope ls r -> [Statement]
  -> C (Code (Env ls -> Fn args r))
compileValueParameters (SigNil _) _ sc body = compileBlockWith ReturnValue sc body
compileValueParameters (SigCons t signature) (name : names) sc body = do
  let scope = Scope (ValueVar name t IZ Nothing : map weaken (sVars sc)) (sRet sc) [] Nothing (sC sc)
  next <- compileValueParameters signature names scope body
  pure (extendValueFunction next)
compileValueParameters SigCons{} [] _ _ = typeErr "missing parameter name"

-- Ignored parameters need no mutable frame. The signature is traversed during
-- compilation; the executable only contains the resulting argument lambdas.
compileArguments :: Sig args r -> Code (Env (RefTypes args) -> SM r) -> Code (Fn args r)
compileArguments sig body = case codeForm body of
  ConstantFunction action -> ignoreArguments sig action
  _ -> case sig of
    SigNil _ -> (applyCode body emptyEnvironment)
    SigCons{} -> (CAPTURE body $ \compiled_0 -> EMIT_BEGIN (mkFn sig compiled_0)
      EMIT_END)

ignoreArguments :: Sig args r -> Code (SM r) -> Code (Fn args r)
ignoreArguments (SigNil _) action = action
ignoreArguments (SigCons _ rest) action = constantFunction (ignoreArguments rest action)

-- Push each named return value as a local; `return;` reads them back as a tuple.
namedReturns :: forall ls ts. Scope ls (HL ts) -> Fields ts -> [T.Text] -> [(T.Text, [Expression])] -> [Statement] -> C (Code (Env ls -> SM (Flow (HL ts))))
namedReturns sc0 fs0 names mods body = go sc0 fs0 names
  where
    go :: forall ls' us. Scope ls' (HL ts) -> Fields us -> [T.Text] -> C (Code (Env ls' -> SM (Flow (HL ts))))
    go sc FNil [] = do
      k <- withModifiers sc { sNamedRet = names } mods body
      gather <- gatherNamed sc fs0 names
      pure $ (CAPTURE2 k gather $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> compiled_0 env_2 >>= (\case
        {Next -> Ret <$> compiled_1 env_2;
        flow_3 -> pure flow_3}))
        EMIT_END)
    go sc (FCons _ t rest) (n : ns) = do
      k <- go (pushVar n t sc) rest ns
      pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {rr_2 <- liftIO (newIORef (defaultOf t));
        compiled_0 (rr_2 :& env_1)})
        EMIT_END)
    go _ _ _ = typeErr "named return arity"

-- Read the named return locals back into the tuple (used by a bare `return`).
gatherNamed :: Scope ls r -> Fields ts -> [T.Text] -> C (Code (Env ls -> SM (HL ts)))
gatherNamed _ FNil [] = pure (constantFunction (pureAction (primitiveCode HNilPrimitive)))
gatherNamed sc (FCons _ t rest) (n : ns) = do
  case lookupVar sc n of
    Just (Var _ vt i) -> do
      Refl <- sameTy t vt
      k <- gatherNamed sc rest ns
      pure (CAPTURE k $ \compiled_0 ->
        EMIT_BEGIN (\env_1 -> ((:*) <$> liftIO (readIORef (ref i env_1))) <*> compiled_0 env_1)
        EMIT_END)
    _ -> unknown ("named return " <> n)
gatherNamed _ _ _ = typeErr "named return arity"

-- Modifiers apply left to right, the first being outermost.
withModifiers :: Scope ls r -> [(T.Text, [Expression])] -> [Statement] -> C (Code (Env ls -> SM (Flow r)))
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
        CE _ call <- applyCall sc sig (
                                        (constantFunction (pureAction (EMIT_BEGIN (link sig (Right fun))
                                        EMIT_END)))) margs
        pure $ (functionThen call inner)
    Nothing -> withModifier sc mn margs inner

withModifier :: forall ls r. Scope ls r -> T.Text -> [Expression] -> (Code (Env ls -> SM (Flow r))) -> C (Code (Env ls -> SM (Flow r)))
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
        { sInner = Just (typedBody (RefSlot (TMaybe TVariadic) : RefSlot (TMaybe r) : scopeTypes sc) r (CAPTURE inner $ \compiled_0 ->
          EMIT_BEGIN (\e_1 -> case e_1 of
          {_ :& (_ :& env_2) -> compiled_0 env_2})
          EMIT_END)) }
  k <- withParams @_ @_ @(Flow r) sc1 params $ \sc2 -> do
    bodyK <- compileBlock sc2 mbody
    retSlot <- maybe (err Internal "lost $ret") pure (lookupVar sc2 "$ret")
    case retSlot of
      Var _ (TMaybe rt') ix -> do
        Refl <- sameTy r rt'
        case lookupVar sc2 "$rawRet" of
          Just (Var _ (TMaybe TVariadic) rawIx) -> pure $ (CAPTURE bodyK $ \compiled_0 ->
            EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\case
            {Ret v_2 -> pure (Ret v_2);
            RetDynamic ds_3 -> pure (RetDynamic ds_3);
            _ -> liftIO (readIORef (ref rawIx env_1)) >>= (\case
            {Just ds_4 -> pure (RetDynamic ds_4);
            Nothing -> liftIO (readIORef (ref ix env_1)) >>= (\case
            {Just v_5 -> pure (Ret v_5);
            Nothing -> pure Next})})}))
            EMIT_END)
          _ -> pure (
                       (constantFunction (EMIT_BEGIN (diverge "lost modifier dynamic return slot")
                       EMIT_END)))
      _ -> err Internal "$ret has the wrong type"
  pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {slot_2 <- liftIO (newIORef Nothing);
    rawSlot_3 <- liftIO (newIORef Nothing);
    compiled_0 (rawSlot_3 :& (slot_2 :& env_1))})
    EMIT_END)

-- Push a list of typed parameters (evaluated in the enclosing scope) and continue.
withParams :: forall ls r a. Scope ls r -> [(T.Text, SomeTy, Expression)] -> (forall ls'. Scope ls' r -> C (Code (Env ls' -> SM a))) -> C (Code (Env ls -> SM a))
withParams sc [] k = k sc
withParams sc ((n, SomeTy t, e) : ps) k = do
  ve <- meterLocalValue <$> compileAs sc t e
  rest <- withParams (pushVar n t sc) ps k
  pure $ (CAPTURE2 ve rest $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {v_3 <- compiled_0 env_2;
    rr_4 <- liftIO (newIORef v_3);
    compiled_1 (rr_4 :& env_2)})
    EMIT_END)

-- ---------------------------------------------------------------- statements

-- Straight-line scalar locals need values, not mutable references. Nested writes
-- and control flow retain the general local representation.
scalarLocal :: Ty t -> Bool
scalarLocal = \case
  TInt -> True; TDecimal -> True; TBool -> True; TAddr -> True
  TStr -> True; TBytes -> True; TEnum{} -> True; TContract{} -> True
  _ -> False

valueLocal :: Ty t -> Bool
valueLocal t | scalarLocal t = True
valueLocal (TArr t) = valueLocal t
valueLocal (TStruct _ fields) = valueFields fields
valueLocal (TTuple fields) = valueFields fields
valueLocal _ = False

valueFields :: Fields ts -> Bool
valueFields FNil = True
valueFields (FCons _ t rest) = valueLocal t && valueFields rest

valueLocalTail :: Scope ls r -> T.Text -> [Statement] -> Bool
valueLocalTail sc name = all safeStatement
  where
    safeStatement (S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" lhs rhs)) _) =
      readOnly lhs && readOnly rhs && case lhs of
        S.Variable _ n | n == name -> case compileStorage sc rhs of Right _ -> False; _ -> True
        _ -> not (localDestination lhs)
    safeStatement (S.SimpleStatement (S.ExpressionStatement e) _) = readOnly e
    safeStatement (S.SimpleStatement (S.VariableDefinition entries initial) _) =
      all (\case S.VarDefEntry _ _ n _ -> n /= name; S.BlankEntry -> True) entries && maybe True readOnly initial
    safeStatement (S.Return (Just e) _) = readOnly e
    safeStatement _ = False
    localDestination = \case
      S.Variable _ n -> n == name
      S.MemberAccess _ e _ -> localDestination e
      S.IndexAccess _ e _ -> localDestination e
      S.InlineBoundsCheck _ _ _ e -> localDestination e
      S.TupleExpression _ es -> any (maybe False localDestination) es
      _ -> True
    readOnly = \case
      S.FunctionCall _ (S.MemberAccess _ target method) args
        | method `elem` ["push", "pop"] -> not (localDestination target) && readOnly target && all readOnly args
      S.FunctionCall _ callee args -> readOnly callee && all readOnly args
      S.Variable{} -> True; S.NumberLiteral{} -> True; S.DecimalLiteral{} -> True
      S.BoolLiteral{} -> True; S.StringLiteral{} -> True; S.AddressLiteral{} -> True; S.HexaLiteral{} -> True
      S.InlineBoundsCheck _ _ _ e -> readOnly e
      S.Binary _ op l r -> op `elem` ["+", "-", "*", "/", "%", "**", "<<", ">>", "&", "|", "^", "==", "!=", "<", ">", "<=", ">=", "&&", "||"] && readOnly l && readOnly r
      S.Unitary _ op e -> op `elem` ["!", "-", "~", "+"] && readOnly e
      S.MemberAccess _ e _ -> readOnly e
      S.IndexAccess _ e i -> readOnly e && maybe True readOnly i
      S.Ternary _ c a b -> all readOnly [c, a, b]
      S.TupleExpression _ es -> all (maybe True readOnly) es
      S.ArrayExpression _ es -> all readOnly es
      _ -> False

-- Compile a straight-line integer local as actions joined by binds. The scope
-- here describes expressions at compile time; execution passes the value itself.
compileLinearInteger :: CCtx -> [Statement] -> Maybe (Code (SM ()))
compileLinearInteger c (S.SimpleStatement (S.VariableDefinition [S.VarDefEntry (Just ty) loc name _] (Just initial)) _ : rest) = do
  guard (loc /= Just S.Storage && name `notElem` ["this", "now"])
  guard $ case resolveTy c ty of Right (SomeTy TInt) -> True; _ -> False
  (IntegerLiteral value, units) <- integerAtom (Scope [] TUnit [] Nothing c) initial
  let initializer = beforeAction (fromIntegral units + Operations.localWriteCost) (pureAction (integerCode value))
      sc = Scope [ValueVar name TInt IZ (Just value)] TUnit [] Nothing c
  case fusedIntegerSequence sc name value units rest of
    Just action -> Just action
    Nothing -> do
      (steps, final) <- commands sc rest
      pure (bindCodeChain name initializer steps final)
  where
    commands :: Scope '[Integer] () -> [Statement] -> Maybe ([Code (Integer -> SM Integer)], Code (Integer -> SM ()))
    commands _ [] = Just ([], (constantFunction (pureAction unitCode)))
    commands sc (S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ target) rhs)) _ : remaining)
      | target == name = do
          rawCommand <- linearIntegerExpression sc rhs (chargeUnits 1)
          let command = meterLocalValue rawCommand
          let nextScope = sc { sVars = [ValueVar name TInt IZ (knownInteger sc rhs)] }
          (steps, final) <- commands nextScope remaining
          pure (command : steps, final)
      | Just (SScalar (SomeTy TInt)) <- M.lookup target (cStorage c) = do
          write <- linearIntegerWrite sc target rhs
          case remaining of
            [] -> Just ([], write)
            _ -> do
              (steps, final) <- commands sc remaining
              let command = functionKeep write
              pure (command : steps, final)
    commands _ _ = Nothing
compileLinearInteger _ _ = Nothing

linearIntegerExpression :: Scope '[Integer] () -> Expression -> Code (SM ()) -> Maybe (Code (Integer -> SM Integer))
linearIntegerExpression sc expression before = do
  (prefix, _) <- gasOnlyAction before
  case integerAtom sc expression of
    Just (IntegerLiteral value, units) ->
      Just (constantFunction (beforeAction (runCode prefix + fromIntegral units) (pureAction (integerCode value))))
    Just (IntegerLocal, units) ->
      Just (functionBefore (runCode prefix + fromIntegral units) (functionPure (identityFunction)))
    Nothing -> do
      (op, lhs, leftUnits, rhs, rightUnits, units) <- integerBinaryAtoms sc expression
      let fixed = runCode prefix + fromIntegral (leftUnits + rightUnits + units)
          specialize value = integerExpressionCode op (literalAtom value lhs) (literalAtom value rhs) fixed
          literalAtom :: Integer -> IntegerAtom slots -> IntegerAtom slots
          literalAtom value IntegerLocal = IntegerLiteral value
          literalAtom _ atom = atom
      prototype <- integerExpressionCode op lhs rhs fixed
      pure (staticFunction (CAPTURE prototype $ \compiled_integer ->
        EMIT_BEGIN (\value -> compiled_integer (value :& ENil))
        EMIT_END)
                              (\argument -> case codeForm argument of
                              IntegerValue value -> fromMaybe (applyResidual prototype (valueEnvironment argument emptyEnvironment)) (specialize value >>= constantBody)
                              _ -> applyResidual prototype (valueEnvironment argument emptyEnvironment)))
integerBinaryAtoms :: Scope ls r -> Expression -> Maybe (T.Text, IntegerAtom ls, Int, IntegerAtom ls, Int, Int)
integerBinaryAtoms sc expression = do
  let peel count (S.InlineBoundsCheck _ lo hi inner) | boundsImplied sc lo hi inner = peel (count + 1) inner
      peel count e = (e, count)
      (base, units) = peel 1 expression
  S.Binary _ symbol left right <- Just base
  (lhs, leftUnits) <- integerAtom sc left
  (rhs, rightUnits) <- integerAtom sc right
  pure (T.pack symbol, lhs, leftUnits, rhs, rightUnits, units)

-- Fuse a scalar initialization, arithmetic assignment, and final storage write.
-- Other straight-line blocks keep their existing bind-chain compilation.
fusedIntegerSequence :: Scope '[Integer] () -> T.Text -> Integer -> Int -> [Statement] -> Maybe (Code (SM ()))
fusedIntegerSequence sc name value initialUnits
  [S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ assigned) expression)) _,
   S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ target) source)) _] = do
  guard (assigned == name && target /= name)
  guard $ case M.lookup target (cStorage (sC sc)) of Just (SScalar (SomeTy TInt)) -> True; _ -> False
  let nextScope = sc { sVars = [ValueVar name TInt IZ (knownInteger sc expression)] }
  (IntegerLocal, storeUnits) <- integerAtom nextScope source
  (op, lhs, leftUnits, rhs, rightUnits, units) <- integerBinaryAtoms sc expression
  let operand IntegerLocal = value
      operand (IntegerLiteral number) = number
      fixed = fromIntegral (initialUnits + 1 + leftUnits + rightUnits + units + 1 + storeUnits)
  calculation <- integerExpressionCode op (IntegerLiteral (operand lhs)) (IntegerLiteral (operand rhs)) fixed
  result <- constantBody calculation
  (charges, computed) <- knownAction result
  pure (CAPTURE (thenAction charges (writeAction TInt (valueCode (TRef (SScalar (SomeTy TInt))) (StoragePath [Field (TE.encodeUtf8 target)])) computed)) $ \compiled_run ->
    EMIT_BEGIN (do
      Operations.localWrite
      Operations.localWrite
      compiled_run) EMIT_END)
fusedIntegerSequence _ _ _ _ _ = Nothing

linearIntegerWrite :: Scope '[Integer] () -> T.Text -> Expression -> Maybe (Code (Integer -> SM ()))
linearIntegerWrite sc target rhs = do
  (source, units) <- integerAtom sc rhs
  let path = constantFunction (valueCode (TRef (SScalar (SomeTy TInt))) (StoragePath [Field (TE.encodeUtf8 target)]))
      computed = case source of
        IntegerLocal -> identityFunction
        IntegerLiteral value -> constantFunction (integerCode value)
  pure (functionBefore (1 + fromIntegral units) (functionWrite TInt path computed))

functionKeep :: Code (env -> SM a) -> Code (env -> SM env)
functionKeep action = staticFunction
  (CAPTURE action $ \compiled_action -> EMIT_BEGIN (\environment -> compiled_action environment >> pure environment)
    EMIT_END) $ \environment ->
        thenAction (applyCode action environment) (pureAction environment)

functionReplace :: Ix slots a -> Code (Env slots -> SM a) -> Code (Env slots -> SM b) -> Code (Env slots -> SM b)
functionReplace index value next = staticFunction residual $ \environment ->
  let evaluated = applyCode value environment
      continuation = staticFunction
        (CAPTURE2 next environment $ \compiled_next compiled_environment ->
          EMIT_BEGIN (\v -> compiled_next (replaceValue index v compiled_environment))
          EMIT_END) $ \v -> applyCode next (replaceCode index v environment)
   in bindAction evaluated continuation
  where
    residual = actionFunction $
      (CAPTURE2 (composedAction value) (composedAction next) $ \compiled_value compiled_next ->
        EMIT_BEGIN (do {environment <- askEnvironment; v <- compiled_value; withEnvironment (\_ -> replaceValue index v environment) compiled_next})
        EMIT_END)

compileBlock :: Scope ls r -> [Statement] -> C (Code (Env ls -> SM (Flow r)))
compileBlock = compileBlockWith KeepFlow

-- Ordinary function bodies return their result directly. Flow values are only
-- needed at boundaries that can propagate break, continue, or modifier returns.
data BlockExit r a where
  KeepFlow :: BlockExit r (Flow r)
  ReturnValue :: BlockExit r r

compileBlockWith :: BlockExit r a -> Scope ls r -> [Statement] -> C (Code (Env ls -> SM a))
compileBlockWith exit sc body = do
  action <- compileBlockBody exit sc body
  pure $ case exit of
    KeepFlow -> typedBody (scopeTypes sc) (sRet sc) action
    ReturnValue -> typedCode (scopeTypes sc) (sRet sc) action

blockEnd :: BlockExit r a -> Ty r -> Code (Env ls -> SM a)
blockEnd KeepFlow _ = (constantFunction (pureAction (primitiveCode NextPrimitive)))
blockEnd ReturnValue TUnit = (constantFunction (pureAction unitCode))
blockEnd ReturnValue result = constantCode result (defaultOf result)

finishBlock :: BlockExit r a -> Ty r -> Code (Env ls -> SM (Flow r)) -> Code (Env ls -> SM a)
finishBlock KeepFlow _ action = action
finishBlock ReturnValue result action = (CAPTURE action $ \compiled_0 ->
  EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\case
  {Ret value_2 -> pure value_2;
  RetDynamic values_3 -> liftIO $ (throwIO $ ForwardReturn values_3);
  _ -> pure (defaultOf result)}))
  EMIT_END)

compileBlockBody :: BlockExit r a -> Scope ls r -> [Statement] -> C (Code (Env ls -> SM a))
compileBlockBody exit sc [] = pure (blockEnd exit (sRet sc))
compileBlockBody exit sc statements@(_ : _) = compileBlockStatements exit sc statements

meterLocalValue :: Code (env -> SM a) -> Code (env -> SM a)
meterLocalValue action = CAPTURE action $ \compiled_run ->
  EMIT_BEGIN (\env -> do
    value <- compiled_run env
    Operations.localWrite
    pure value)
  EMIT_END

compileBlockStatements :: BlockExit r a -> Scope ls r -> [Statement] -> C (Code (Env ls -> SM a))
compileBlockStatements exit sc [] = pure (blockEnd exit (sRet sc))
compileBlockStatements exit sc (s : rest) = case s of
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
            k <- compileBlockWith exit (pushVar n (TAlias t st) sc) rest
            pure $ (CAPTURE2 pathOf k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {
              p_3 <- compiled_0 env_2;
              Operations.localWrite;
              rr_4 <- liftIO (newIORef (Left p_3));
              compiled_1 (rr_4 :& env_2)})
              EMIT_END)
          _ -> do
            k <- compileBlockWith exit (pushVar n (TRef st) sc) rest
            pure $ (CAPTURE2 pathOf k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {
              p_3 <- compiled_0 env_2;
              Operations.localWrite;
              rr_4 <- liftIO (newIORef p_3);
              compiled_1 (rr_4 :& env_2)})
              EMIT_END)
      else do
        SomeTy t <- resolveTy (sC sc) ty
        initF <- meterLocalValue <$> maybe (pure (constantCode t (defaultOf t))) (compileAs sc t) mInit
        if valueLocal t && valueLocalTail sc n rest
          then do
            let known = maybe (Just (defaultOf t)) (knownValue sc t) mInit
                sc' = Scope (ValueVar n t IZ known : map weaken (sVars sc)) (sRet sc) (sNamedRet sc)
                  (fmap (\f -> (dropEnvironment f)) (sInner sc)) (sC sc)
            k <- compileBlockWith exit sc' rest
            pure (bindEnvironment initF k)
          else do
            k <- compileBlockWith exit (pushVar n t sc) rest
            pure $ (CAPTURE2 initF k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {
              v_3 <- compiled_0 env_2;
              rr_4 <- liftIO (newIORef v_3);
              compiled_1 (rr_4 :& env_2)})
              EMIT_END)
  S.SimpleStatement (S.VariableDefinition [S.VarDefEntry Nothing _ _ _] _) a -> atLine a (unsupported "untyped `var` declaration")
  S.SimpleStatement (S.VariableDefinition entries (Just initE)) a -> atLine a $ do
    -- (T1 a, T2 b) = rhs
    CE rt' rf <- compileE sc initE
    case rt' of
      TStruct _ fs -> do
        k <- destructure sc fs entries rest
        pure $ finishBlock exit (sRet sc) $ (functionBind rf k)
      TTuple fs -> do
        k <- destructure sc fs entries rest
        pure $ finishBlock exit (sRet sc) $ (functionBind rf k)
      TRaw -> do
        k <- destructureRaw sc entries rest
        pure $ finishBlock exit (sRet sc) $ (functionBind rf k)
      _ -> typeErr ("destructuring a non-tuple " <> showTy rt')
  S.SimpleStatement (S.VariableDefinition _ Nothing) a -> atLine a (typeErr "tuple declaration without an initialiser")
  S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ name) rhs)) a
    | Just (ValueVar _ t i _) <- lookupVar sc name -> atLine a $ do
        valueF <- compileAs sc t rhs
        let sc' = sc { sVars = updateKnown (sVars sc) }
            updateKnown (ValueVar n vt ix _ : vs) | n == name = ValueVar n vt ix (knownValue sc vt rhs) : vs
            updateKnown (v : vs) = v : updateKnown vs
            updateKnown [] = []
        k <- compileBlockWith exit sc' rest
        pure (functionBefore 1 (functionReplace i (meterLocalValue valueF) k))
  S.SimpleStatement (S.ExpressionStatement e) a -> atLine a $ do
    CE _ action <- compileStatementExpression sc e
    case rest of
      [] -> pure $ case exit of
        KeepFlow -> functionMap (constantFunction (primitiveCode NextPrimitive)) action
        ReturnValue -> case sRet sc of
          TUnit -> functionMap (constantFunction unitCode) action
          result -> functionMap (constantFunction (valueCode result (defaultOf result))) action
      _ -> do
        k <- compileBlockWith exit sc rest
        pure (functionThen action k)
  S.Return (Just expression) annotation | ReturnValue <- exit -> atLine annotation $ do
    _ <- compileBlockWith exit sc rest
    case compileE sc expression of
      Right (CE TRaw action) | isJust (tyEq (sRet sc) TRaw) ->
        pure (CAPTURE action $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {
          compiled_0 env_1 >>= (liftIO . (throwIO . ForwardReturn))})
          EMIT_END)
      _ -> do
        action <- compileAs sc (sRet sc) expression
        pure action
  S.Return Nothing annotation | ReturnValue <- exit, TUnit <- sRet sc -> atLine annotation $ do
    _ <- compileBlockWith exit sc rest
    pure (constantFunction (pureAction unitCode))
  _ -> do
    sf <- compileStmt sc s
    k <- compileBlockWith exit sc rest
    let done = finishBlock exit (sRet sc) sf
    pure $ if null rest then done
      else case exit of
        KeepFlow -> (CAPTURE2 sf k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {
          compiled_0 env_2 >>= (\case
          {Next -> compiled_1 env_2;
          flow_3 -> pure flow_3})})
          EMIT_END)
        ReturnValue ->
          let result = sRet sc
           in (CAPTURE2 sf k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {
             compiled_0 env_2 >>= (\case
             {Next -> compiled_1 env_2;
             Ret value_3 -> pure value_3;
             RetDynamic values_4 -> liftIO $ (throwIO $ ForwardReturn values_4);
             _ -> pure (defaultOf result)})})
             EMIT_END)

implicitStorageAlias :: Scope ls r -> Maybe Expression -> Bool
implicitStorageAlias sc (Just expression) = case compileStorage sc expression of
  Right (SStruct{}, _) -> True
  Right (SArray{}, _) -> True
  Right (SMap{}, _) -> True
  _ -> False
implicitStorageAlias _ Nothing = False

-- Declare each tuple component as a typed local (blank entries are skipped), then continue.
destructure :: Scope ls r -> Fields ts -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> HL ts -> SM (Flow r)))
destructure sc fs entries rest = typedDestructure (scopeTypes sc) fs (sRet sc) <$> destructureBody sc fs entries rest

destructureBody :: Scope ls r -> Fields ts -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> HL ts -> SM (Flow r)))
destructureBody sc FNil [] rest = do k <- compileBlock sc rest; pure (CAPTURE k $ \compiled_0 ->
                                      EMIT_BEGIN (\env_1 _ -> compiled_0 env_1)
                                      EMIT_END)
destructureBody sc (FCons _ t fs) (en : ens) rest = case en of
  S.BlankEntry -> do
    k <- destructure sc fs ens rest
    pure (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 hl_2 -> case hl_2 of
      {_ :* vs_3 -> compiled_0 env_1 vs_3})
      EMIT_END)
  S.VarDefEntry mty _ n _ -> do
    forM_ mty $ \ty -> do SomeTy dt <- resolveTy (sC sc) ty; void (sameTy dt t)
    k <- destructure (pushVar n t sc) fs ens rest
    pure (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 hl_2 -> case hl_2 of
      {v_3 :* vs_4 -> do {Operations.localWrite; rr_5 <- liftIO (newIORef v_3);
      compiled_0 (rr_5 :& env_1) vs_4}})
      EMIT_END)
destructureBody _ _ _ _ = typeErr "destructuring arity mismatch"

-- Low-level results acquire their types at the destructuring boundary.
destructureRaw :: Scope ls r -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> [Dyn] -> SM (Flow r)))
destructureRaw sc [] rest = do
  k <- compileBlock sc rest
  pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 ds_2 -> if null ds_2
    then compiled_0 env_1
    else revert "destructuring arity mismatch")
    EMIT_END)
destructureRaw sc (S.BlankEntry : entries) rest = do
  k <- destructureRaw sc entries rest
  pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 ds_2 -> case ds_2 of
    {_ : values_3 -> compiled_0 env_1 values_3;
    [] -> revert "destructuring arity mismatch"})
    EMIT_END)
destructureRaw sc (S.VarDefEntry (Just ty) _ name _ : entries) rest = do
  SomeTy t <- resolveTy (sC sc) ty
  k <- destructureRaw (pushVar name t sc) entries rest
  pure $ (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 ds_2 -> case ds_2 of
    {d_3 : values_4 -> do {value_5 <- fromDyn t d_3;
    Operations.localWrite;
    slot_6 <- liftIO $ newIORef value_5;
    compiled_0 (slot_6 :& env_1) values_4};
    [] -> revert "destructuring arity mismatch"})
    EMIT_END)
destructureRaw _ _ _ = unsupported "untyped raw result declaration"

compileStatementExpression :: Scope ls r -> Expression -> C (CE ls)
compileStatementExpression sc e = case e of
  S.Binary _ "=" l r -> case l of
    S.TupleExpression _ lhss -> compileTupleAssignment sc True lhss r
    S.Variable _ n | Just (Var _ (TRef _) _) <- lookupVar sc n -> do
      CE t action <- compileExpression sc False e
      pure (CE t ((
                                        functionBefore 1 action)))
    S.Variable _ n | Just (Var _ (TAlias _ _) _) <- lookupVar sc n -> do
      CE t action <- compileExpression sc False e
      pure (CE t ((
                                        functionBefore 1 action)))
    S.IndexAccess{} -> compileAssignment sc False True l r
    _ -> compileAssignment sc True True l r
  _ -> compileE sc e

compileStmt :: forall ls r. Scope ls r -> Statement -> C (Code (Env ls -> SM (Flow r)))
compileStmt sc statement = typedBody (scopeTypes sc) (sRet sc) <$> compileStmtBody sc statement

compileStmtBody :: forall ls r. Scope ls r -> Statement -> C (Code (Env ls -> SM (Flow r)))
compileStmtBody sc s = atLine (S.extractStatement s) $ case s of
  S.SimpleStatement (S.ExpressionStatement e) _ -> do
    CE _ f <- compileStatementExpression sc e
    pure (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> Next <$ compiled_0 env_1)
      EMIT_END)
  S.SimpleStatement{} -> err Internal "declaration outside compileBlock"
  S.IfStatement cnd th mel _ -> do
    cf <- compileAs sc TBool cnd
    tf <- compileBlock sc th
    ef <- maybe (pure (constantFunction (pureAction (primitiveCode NextPrimitive)))) (compileBlock sc) mel
    pure (functionConditional cf tf ef)
  S.WhileStatement cnd body _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure (CAPTURE2 cf bf $ \compiled_0 compiled_1 -> EMIT_BEGIN (loop compiled_0 compiled_1 (\_ -> pure ()))
      EMIT_END)
  S.DoWhileStatement body cnd _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure $ (CAPTURE2 bf cf $ \compiled_0 compiled_1 ->
      EMIT_BEGIN (\env_2 -> let go_3 = do {result_4 <- compiled_0 env_2;
      chargeGas 1;
      case result_4 of
      {Brk -> pure Next;
      Cnt -> go_3;
      Next -> compiled_1 env_2 >>= (\condition_5 -> if condition_5
      then go_3
      else pure Next);
      flow_6 -> pure flow_6}}
      in go_3)
      EMIT_END)
  S.ForStatement mInit mCond mStep body a -> case mInit of
    Just (S.VariableDefinition [S.VarDefEntry (Just ty) _ n _] mInitE) -> atLine a $ do
      SomeTy t <- resolveTy (sC sc) ty
      initF <- meterLocalValue <$> maybe (pure (constantCode t (defaultOf t))) (compileAs sc t) mInitE
      k <- forBody (pushVar n t sc)
      pure $ (CAPTURE2 initF k $ \compiled_0 compiled_1 -> EMIT_BEGIN (\env_2 -> do {v_3 <- compiled_0 env_2;
        rr_4 <- liftIO (newIORef v_3);
        compiled_1 (rr_4 :& env_2)})
        EMIT_END)
    Just (S.ExpressionStatement e) -> do
      CE _ f <- compileE sc e
      k <- forBody sc
      pure $ (functionThen f k)
    Nothing -> forBody sc
    Just _ -> unsupported "for-loop initialiser"
    where
      forBody :: forall ls'. Scope ls' r -> C (Code (Env ls' -> SM (Flow r)))
      forBody sc' = do
        cf <- maybe (pure (constantFunction (beforeAction 1 (pureAction (valueCode TBool True))))) (compileAs sc' TBool) mCond
        stepF <- maybe (pure (constantFunction (gasAction 1)))
          (\e -> do CE _ f <- compileE sc' e; pure (functionMap (constantFunction unitCode) f)) mStep
        bf <- compileBlock sc' body
        pure (CAPTURE3 cf bf stepF $ \compiled_0 compiled_1 compiled_2 ->
          EMIT_BEGIN (loop compiled_0 (\env_3 -> do {result_4 <- compiled_1 env_3;
          compiled_2 env_3;
          pure result_4}) (\_ -> pure ()))
          EMIT_END)
  S.Block _ -> pure (constantFunction (pureAction (primitiveCode NextPrimitive)))
  S.Continue _ -> pure (constantFunction (pureAction (primitiveCode ContinuePrimitive)))
  S.Break _ -> pure (constantFunction (pureAction (primitiveCode BreakPrimitive)))
  S.Return Nothing _ -> case (sRet sc, sNamedRet sc) of
    (TUnit, _) -> pure ((
                           (constantFunction (pureAction (EMIT_BEGIN ((Ret ()))
                           EMIT_END)))))
    (r, [rn]) | Just (Var _ t i) <- lookupVar sc rn -> do
      Refl <- sameTy r t
      pure $ (
                (EMIT_BEGIN (\env_0 -> Ret <$> liftIO (readIORef (ref i env_0)))
                EMIT_END))
    (TTuple fs, names@(_ : _ : _)) -> do
      g <- gatherNamed sc fs names
      pure $ functionMap (primitiveCode ReturnPrimitive) g
    (r, _) -> typeErr ("return without a value in a function returning " <> showTy r)
  S.Return (Just e) _ -> do
    case compileE sc e of
      Right (CE TRaw f) | isJust (tyEq (sRet sc) TRaw) || isJust (sInner sc) ->
        pure $ functionMap (primitiveCode DynamicReturnPrimitive) f
      Right (CE TVariadic f) | isJust (sInner sc), isNothing (tyEq (sRet sc) TVariadic) ->
        pure $ (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= (\case
          {ds_2@[Dyn (TUnit)
          (())] -> pure $ RetDynamic ds_2;
          ds_3 -> pure $ RetDynamic [Dyn TVariadic ds_3]}))
          EMIT_END)
      _ -> do
        f <- compileAs sc (sRet sc) e
        pure $ functionMap (primitiveCode ReturnPrimitive) f
  S.Throw _ _ -> pure ((
                          (constantFunction (EMIT_BEGIN (revert "throw")
                          EMIT_END))))
  S.EmitStatement en args _ -> do
    ev <- maybe (unknown ("event " <> en)) pure (M.lookup en (cContract (sC sc) ^. events))
    let logs = ev ^. eventLogs
    when (length logs /= length args) $ typeErr ("event " <> en <> " argument count mismatch")
    fs <- forM (zip logs args) $ \(lg, (mn, e)) -> do
      when (maybe False (/= (lg ^. eventLogName)) mn) $ typeErr ("event argument name mismatch: " <> fromMaybe "" mn)
      SomeTy t <- resolveTy (sC sc) (indexedTypeType (lg ^. eventLogType))
      f <- compileAs sc t e
      let label = lg ^. eventLogName
      pure (CAPTURE f $ \compiled_0 -> EMIT_BEGIN (\env_1 -> ((label,) . Dyn t) <$> compiled_0 env_1)
        EMIT_END)
    let cn = cName (sC sc)
    pure $ (CAPTURES fs $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {vs_2 <- mapM ($ env_1) compiled_0;
      Runtime.emitContractEvent cn en vs_2;
      pure Next})
      EMIT_END)
  S.AssemblyStatement{} -> unsupported "inline assembly"
  S.RevertStatement mName args _ -> case (mName, args) of
    (Nothing, []) -> pure ((
                              (constantFunction (EMIT_BEGIN (revert "")
                              EMIT_END))))
    (Nothing, [m]) -> do f <- compileAs sc TStr m; pure (CAPTURE f $ \compiled_0 ->
                          EMIT_BEGIN (\env_1 -> compiled_0 env_1 >>= revert)
                          EMIT_END)
    (Just n, _) -> do
      fs <- forM args $ \e -> do CE t f <- compileE sc e; pure (functionMap (primitiveCode (DynPrimitive t)) f)
      pure $ (CAPTURES fs $ \compiled_0 -> EMIT_BEGIN (\env_1 -> do {vs_2 <- mapM ($ env_1) compiled_0;
        revert (n <> ("(" <> (T.intercalate "," (map showDyn vs_2) <> ")")))})
        EMIT_END)
    _ -> typeErr "revert takes at most one argument"
  S.UncheckedStatement body _ -> compileBlock sc body
  S.SolidityTryCatchStatement expression returnsDecl success handlers _ -> do
    CE t f <- compileE sc expression
    sf <- case returnsDecl of
      Nothing -> do k <- compileBlock sc success; pure (CAPTURE k $ \compiled_0 ->
                     EMIT_BEGIN (\env_1 _ -> compiled_0 env_1)
                     EMIT_END)
      Just [(name, ty)] -> do
        SomeTy dt <- resolveTy (sC sc) ty
        Refl <- sameTy dt t
        k <- compileBlock (pushVar name t sc) success
        pure (CAPTURE k $ \compiled_0 -> EMIT_BEGIN (\env_1 value_2 -> do {rr_3 <- liftIO (newIORef value_2);
          compiled_0 (rr_3 :& env_1)})
          EMIT_END)
      Just declarations -> case t of
        TTuple fs -> destructure sc fs [S.VarDefEntry (Just ty) Nothing name (S.extractStatement s) | (name, ty) <- declarations] success
        _ -> typeErr "try return declaration mismatch"
    hf <- case M.lookup "Nill" handlers of
      Just (Nothing, body) | M.size handlers == 1 -> compileBlock sc body
      _ -> unsupported "typed catch clauses"
    pure $ (CAPTURE3 f hf sf $ \compiled_0 compiled_1 compiled_2 ->
      EMIT_BEGIN (\env_3 -> do {value_4 <- catchContractFailure (Right <$> compiled_0 env_3) (pure (Left ()));
      either (const (compiled_1 env_3)) (compiled_2 env_3) value_4})
      EMIT_END)
  S.TryCatchStatement body handlers _ -> do
    bf <- compileBlock sc body
    hf <- case M.toList handlers of
      [("", (Nothing, hs))] -> compileBlock sc hs
      [("", (Just _, _))] -> unsupported "catch with parameters"
      _ -> unsupported ("typed catch clauses " <> T.pack (show (M.keys handlers)))
    pure $ (CAPTURE2 bf hf $ \compiled_0 compiled_1 ->
      EMIT_BEGIN (\env_2 -> catchContractFailure (compiled_0 env_2) (compiled_1 env_2))
      EMIT_END)
  S.ModifierExecutor _ -> case sInner sc of
    Just inner -> do
      let saveReturn = setRet sc
          saveRawReturn = setRawRet sc
      pure $ (CAPTURE3 inner saveReturn saveRawReturn $ \compiled_0 compiled_1 compiled_2 ->
        EMIT_BEGIN (\env_3 -> compiled_0 env_3 >>= (\case
        -- stash in the innermost $ret slot and keep running the modifier
        {Ret v_4 -> do {compiled_1 env_3 v_4;
        pure Next};
        RetDynamic ds_5 -> do {compiled_2 env_3 (Just ds_5);
        pure Next};
        fl_6 -> pure fl_6}))
        EMIT_END)
    Nothing -> typeErr "`_` outside a modifier"
fieldsLen :: Fields ts -> Int
fieldsLen FNil = 0
fieldsLen (FCons _ _ rest) = 1 + fieldsLen rest

-- Write the function's return value into the modifier's hidden `$ret` slot.
setRet :: Scope ls r -> Code (Env ls -> r -> SM ())
setRet sc = case lookupVar sc "$ret" of
  Just (Var _ (TMaybe t) i) | Just Refl <- tyEq t (sRet sc) ->
    let saveRawReturn = setRawRet sc in (CAPTURE saveRawReturn $ \compiled_0 ->
         EMIT_BEGIN (\env_1 v_2 -> do {liftIO (writeIORef (ref i env_1) (Just v_2));
         compiled_0 env_1 Nothing})
         EMIT_END)
  _ -> (
          (EMIT_BEGIN (\_ _ -> diverge "internal: $ret slot missing")
          EMIT_END))

setRawRet :: Scope ls r -> Code (Env ls -> Maybe [Dyn] -> SM ())
setRawRet sc = case lookupVar sc "$rawRet" of
  Just (Var _ (TMaybe TVariadic) i) -> (
                                        (EMIT_BEGIN (\env_0 ds_1 -> liftIO $ writeIORef (ref i env_0) ds_1)
                                        EMIT_END))
  _ -> (
          (EMIT_BEGIN (\_ _ -> diverge "lost modifier dynamic return slot")
          EMIT_END))

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

data Getter = forall args r. Getter (Sig args r) (Code (StoragePath -> Env (RefTypes args) -> SM r))

getterEntry :: CCtx -> T.Text -> SType -> FunEntry
getterEntry c n st = FunEntry (fst <$> g) (snd <$> g)
  where
    g = inFun (cName c <> "." <> n) $ do
      Getter sig body <- build st
      pure (SomeSig sig, makeFun n sig (namedCode (cName c <> "." <> n <> "/" <> T.pack (show (sigArity sig))) (CAPTURE body $ \compiled_0 ->
        EMIT_BEGIN (mkFn sig (compiled_0 (StoragePath [Field (TE.encodeUtf8 n)])))
        EMIT_END)))
    build :: SType -> C Getter
    build (SMap (SomeTy k) v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons k sig) (typedGetter (SigCons k sig) (CAPTURE body $ \compiled_0 ->
        EMIT_BEGIN (\p_1 env_2 -> case env_2 of
        {r_3 :& envPrime_2 -> do {key_4 <- liftIO (readIORef r_3);
        compiled_0 (snocP p_1 (encodeKey k key_4)) envPrime_2}})
        EMIT_END))
    build (SArray v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons TInt sig) (typedGetter (SigCons TInt sig) (CAPTURE body $ \compiled_0 ->
        EMIT_BEGIN (\p_1 env_2 -> case env_2 of
        {r_3 :& envPrime_3 -> do {i_4 <- liftIO (readIORef r_3);
        compiled_0 (snocP p_1 (Index (BC.pack (show i_4)))) envPrime_3}})
        EMIT_END))
    build (SStruct name fields) = do
      SomeTy ty <- stypeTy (SStruct name [(field, fieldTy) | (field, fieldTy) <- fields, scalarField fieldTy])
      case ty of
        TStruct _ fs -> do
          let t = TTuple fs
          pure $ Getter (SigNil t) (typedGetter (SigNil t) (
                                        (EMIT_BEGIN (\p_0 env_1 -> case env_1 of
                                        {ENil -> readVal t p_0})
                                        EMIT_END)))
        _ -> err Internal "struct getter type"
    build leaf = do
      SomeTy t <- stypeTy leaf
      pure $ Getter (SigNil t) (typedGetter (SigNil t) (
                                        (EMIT_BEGIN (\p_0 env_1 -> case env_1 of
                                        {ENil -> readVal t p_0})
                                        EMIT_END)))
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
        pure (functionMap (constantFunction unitCode) action)
      pure $ if null actions then Nothing else Just (sequenceActions actions)
    parentE = M.mapWithKey (\n expressions -> compileConstructorStage ctx ("<parent:" <> n <> ">") TVariadic $ \sc -> do
      parent <- maybe (unknown ("parent contract " <> n)) pure (M.lookup n (cc ^. contracts))
      case parent ^. constructor of
        Nothing -> if null expressions then pure Nothing else Just <$> compileDynArgs sc expressions
        Just ctor -> do
          SomeSig sig <- funSig (mkCtx cc parent) ctor
          arguments <- compileTypedArgs sc sig expressions
          pure $ if sigArity sig == 0 then Nothing else Just arguments) $
      maybe M.empty (^. funcConstructorCalls) (c ^. constructor)

-- Constructor stages share the parameter scope while STRATO controls the order
-- of initializers, parent construction, and the constructor body.
compileConstructorStage :: CCtx -> T.Text -> Ty a -> (forall ls. Scope ls a -> C (Maybe (Code (Env ls -> SM a)))) -> C Fun
compileConstructorStage ctx name result compile = inFun (cName ctx <> "." <> name) $ do
  SomeSig original <- maybe (pure (SomeSig (SigNil TUnit))) (funSig ctx) (cContract ctx ^. constructor)
  let sig = replaceReturn original result
      names = maybe [] (map (fromMaybe "" . fst) . (^. funcArgs)) (cContract ctx ^. constructor)
      sc = paramScope ctx sig names
      outputSig = replaceReturn original TRaw
  body <- compile sc
  let updatedArguments = compileSnapshot sig
      value = valueCode result (defaultOf result)
      stageAction = case (sig, body) of
        (SigNil _, Nothing) -> (CAPTURE value $ \compiled_0 ->
          pureAction (EMIT_BEGIN ([Dyn TVariadic [], Dyn result compiled_0])
          EMIT_END))
        (SigNil _, Just action) -> mapAction
          (staticFunction
            (EMIT_BEGIN (\returned -> [Dyn TVariadic [], Dyn result returned])
              EMIT_END) $ \returned ->
                (CAPTURE returned $ \compiled_returned -> EMIT_BEGIN ([Dyn TVariadic [], Dyn result compiled_returned])
                  EMIT_END)) (applyCode action emptyEnvironment)
        (SigCons{}, Nothing) -> (CAPTURE2 updatedArguments value $ \compiled_0 compiled_1 ->
          EMIT_BEGIN (mkFn outputSig $ (\env_2 -> do {updated_3 <- compiled_0 env_2;
          pure [Dyn TVariadic updated_3, Dyn result compiled_1]}))
          EMIT_END)
        (SigCons{}, Just action) -> (CAPTURE2 action updatedArguments $ \compiled_0 compiled_1 ->
          EMIT_BEGIN (mkFn outputSig $ (\env_2 -> do {returned_3 <- compiled_0 env_2;
          updated_4 <- compiled_1 env_2;
          pure [Dyn TVariadic updated_4, Dyn result returned_3]}))
          EMIT_END)
  pure $ makeFun name outputSig $ namedCode (cName ctx <> "." <> name <> "/" <> T.pack (show (sigArity outputSig))) stageAction
  where
    replaceReturn :: Sig args r -> Ty a -> Sig args a
    replaceReturn (SigNil _) r = SigNil r
    replaceReturn (SigCons t rest) r = SigCons t (replaceReturn rest r)

-- Residual actions are assembled once. Execution never traverses the compiler's
-- action list or dispatches on the statically known parameter signature.
sequenceActions :: [Code (Env ls -> SM ())] -> Code (Env ls -> SM ())
sequenceActions [] = (constantFunction (pureAction unitCode))
sequenceActions [action] = action
sequenceActions (action : actions) =
  let remaining = sequenceActions actions
   in remaining `seq` (functionThen action remaining)

compileSnapshot :: Sig args r -> Code (Env (RefTypes args) -> SM [Dyn])
compileSnapshot sig@(SigNil _) = typedSnapshot sig (constantFunction (pureAction (primitiveCode EmptyListPrimitive)))
compileSnapshot sig@(SigCons t rest) = typedSnapshot sig $
  let remaining = compileSnapshot rest
   in remaining `seq` (CAPTURE remaining $ \compiled_0 ->
     EMIT_BEGIN (\(slot_1 :& env_2) -> do {value_3 <- liftIO (readIORef slot_1);
     values_4 <- compiled_0 env_2;
     pure (Dyn t value_3 : values_4)})
     EMIT_END)

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
