$(Quotation.helperDeclarations)

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
  = forall t. Var T.Text (Ty t) (Ix ls (IORef t))
  | forall t. ValueVar T.Text (Ty t) (Ix ls t) (Maybe Integer)
  | RefVar T.Text SType (Ix ls (IORef StoragePath))   -- `T storage x = ...` pointer

data Scope ls r = Scope
  { sVars :: [Var ls]
  , sRet :: Ty r
  , sNamedRet :: [T.Text]              -- named return values (locals)
  , sInner :: Maybe (Code (Env ls -> M (Flow r)))   -- body of the function when compiling a modifier
  , sC :: CCtx
  }

pushVar :: T.Text -> Ty t -> Scope ls r -> Scope (IORef t ': ls) r
pushVar n t sc@(Scope vs r nr inner c) =
  Scope (Var n t IZ : map weaken vs) r nr (fmap (\f -> typedBody (RefSlot t : scopeTypes sc) r $(Quotation.quoteAction [| \e -> case e of (_ :& env) -> runCode f env |])) inner) c

pushRef :: T.Text -> SType -> Scope ls r -> Scope (IORef StoragePath ': ls) r
pushRef n st sc@(Scope vs r nr inner c) =
  Scope (RefVar n st IZ : map weaken vs) r nr (fmap (\f -> typedBody (RefSlot (TRef st) : scopeTypes sc) r $(Quotation.quoteAction [| \e -> case e of (_ :& env) -> runCode f env |])) inner) c

weaken :: Var ls -> Var (u ': ls)
weaken (Var n t i) = Var n t (IS i)
weaken (RefVar n st i) = RefVar n st (IS i)
weaken (ValueVar n t i value) = ValueVar n t (IS i) value

varName :: Var ls -> T.Text
varName (Var n _ _) = n
varName (RefVar n _ _) = n
varName (ValueVar n _ _ _) = n

lookupVar :: Scope ls r -> T.Text -> Maybe (Var ls)
lookupVar sc n = listToMaybe [v | v <- sVars sc, varName v == n]

scopeTypes :: Scope ls r -> [EnvTy]
scopeTypes = map variableType . sVars
  where
    variableType (Var _ t _) = RefSlot t
    variableType (RefVar _ st _) = RefSlot (TRef st)
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

data CE ls = forall t. CE (Ty t) (Code (Env ls -> M t))
data LV ls = forall t. LV (Ty t) (Code (Env ls -> M t)) (Code (Env ls -> t -> M ()))

sameTy :: Ty a -> Ty b -> C (a :~: b)
sameTy a b = maybe (typeErr ("expected " <> showTy a <> ", got " <> showTy b)) pure (tyEq a b)

compileAs :: Scope ls r -> Ty t -> Expression -> C (Code (Env ls -> M t))
compileAs sc t e = typedCode (scopeTypes sc) t <$> compileAsBody sc t e

compileAsBody :: Scope ls r -> Ty t -> Expression -> C (Code (Env ls -> M t))
compileAsBody sc t e = atLine (S.extractExpression e) $ case (t, e) of
  -- a tuple/struct literal is typed by its context
  (TTuple fs, S.TupleExpression _ xs) | all isJust xs -> do k <- compileFields sc fs (catMaybes xs); pure $(Quotation.quoteAction [| chargeAfter 1 . runCode k |])
  (TStruct _ fs, S.TupleExpression _ xs) | all isJust xs -> do k <- compileFields sc fs (catMaybes xs); pure $(Quotation.quoteAction [| chargeAfter 1 . runCode k |])
  (TArr et, S.ArrayExpression _ xs) -> do
    fs <- mapM (compileAs sc et) xs
    pure ($(Quotation.quoteAction [|
          \env -> chargeAfter 1 $ Seq.fromList <$> mapM ($ env) (map runCode fs)
          |]))
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
      (TDecimal, TInt) -> pure $(Quotation.quoteAction [|
                               (fmap fromInteger . (runCode f))
                               |])
      (_, TRaw) -> pure ($(Quotation.quoteAction [|
                         \env -> (runCode f) env >>= fromDyn t . Dyn TRaw
                         |]))
      (TRaw, _) -> pure $(Quotation.quoteAction [|
                        (fmap (retDyn t') . (runCode f))
                        |])
      (TVariadic, TVariadic) -> pure f
      (TVariadic, _) -> pure $(Quotation.quoteAction [|
                             (fmap (\v -> [Dyn t' v]) . (runCode f))
                             |])
      (_, TVariadic) -> pure ($(Quotation.quoteAction [|
                              \env -> (runCode f) env >>= \ds -> fromDyn t (Dyn TVariadic ds)
                              |]))
      _ -> do Refl <- sameTy t t'; pure f

compileFields :: Scope ls r -> Fields ts -> [Expression] -> C (Code (Env ls -> M (HL ts)))
compileFields sc fs expressions = typedCode (scopeTypes sc) (TTuple fs) <$> compileFieldsBody sc fs expressions

compileFieldsBody :: Scope ls r -> Fields ts -> [Expression] -> C (Code (Env ls -> M (HL ts)))
compileFieldsBody _ FNil [] = pure ($(Quotation.quoteAction [|
                                \_ -> pure HNil
                                |]))
compileFieldsBody sc (FCons _ t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileFields sc rest xs
  pure ($(Quotation.quoteAction [|
        \env -> (:*) <$> (runCode f) env <*> (runCode k) env
        |]))
compileFieldsBody _ _ _ = typeErr "tuple arity mismatch"

compileE :: forall ls r. Scope ls r -> Expression -> C (CE ls)
compileE sc e = atLine (S.extractExpression e) $ do
  let (base, units) = peel 1 e
      charges = chargeUnits units
      peel n (S.InlineBoundsCheck _ lo hi inner) | boundsImplied sc lo hi inner = peel (n + 1) inner
      peel n expression = (expression, n)
      result :: forall t. Ty t -> Code (Env ls -> M t) -> C (CE ls)
      result t action = pure (CE t (typedCode (scopeTypes sc) t action))
  case base of
    S.Binary _ op left right | Just action <- atomicIntegerExpression sc (T.pack op) left right charges ->
      result TInt action
    S.NumberLiteral _ n unit ->
      let value = n * unitMul unit in result TInt $(Quotation.quoteAction [|
        \_ -> runCode charges >> pure value |])
    S.Variable _ n | n `notElem` ["this", "now"], Just (ValueVar _ t i _) <- lookupVar sc n ->
      case i of
        IZ -> result t $(Quotation.quoteAction [| \(value :& _) -> runCode charges >> pure value |])
        _ -> result t $(Quotation.quoteAction [| \env -> runCode charges >> pure (localValue i env) |])
    S.Variable _ n | n `notElem` ["this", "now"], Just (Var _ t i) <- lookupVar sc n, scalarLocal t ->
      result t $(Quotation.quoteAction [|
        \env -> do value <- liftIO (readIORef (ref i env)); runCode charges; pure value |])
    _ -> do
      CE t action <- compileE' sc base
      if units == 1
        then result t $(Quotation.quoteAction [| chargeAfter 1 . runCode action |])
        else result t $(Quotation.quoteAction [|
          \env -> do value <- runCode action env; runCode charges; pure value |])

chargeUnits :: Int -> Code (M ())
chargeUnits = \case
  1 -> $(Quotation.quoteAction [| chargeGas 1 |])
  2 -> $(Quotation.quoteAction [| chargeGas 1 >> chargeGas 1 |])
  3 -> $(Quotation.quoteAction [| chargeGas 1 >> chargeGas 1 >> chargeGas 1 |])
  count -> $(Quotation.quoteAction [| replicateM_ count (chargeGas 1) |])

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

atomicIntegerExpression :: Scope ls r -> T.Text -> Expression -> Expression -> Code (M ()) -> Maybe (Code (Env ls -> M Integer))
atomicIntegerExpression sc op left right charges = do
  (lhs, leftUnits) <- integerAtom sc left
  (rhs, rightUnits) <- integerAtom sc right
  let leftCharges = chargeUnits leftUnits
      rightCharges = chargeUnits rightUnits
  case (lhs, rhs) of
    (IntegerLocal, IntegerLiteral b) -> $(Quotation.quoteIntegerExpression [| op |]
      [| \(value :& _) -> runCode leftCharges >> pure value |]
      [| \_ -> runCode rightCharges >> pure b |]
      [| runCode charges |])
    (IntegerLiteral a, IntegerLocal) -> $(Quotation.quoteIntegerExpression [| op |]
      [| \_ -> runCode leftCharges >> pure a |]
      [| \(value :& _) -> runCode rightCharges >> pure value |]
      [| runCode charges |])
    (IntegerLocal, IntegerLocal) -> $(Quotation.quoteIntegerExpression [| op |]
      [| \(value :& _) -> runCode leftCharges >> pure value |]
      [| \(value :& _) -> runCode rightCharges >> pure value |]
      [| runCode charges |])
    (IntegerLiteral a, IntegerLiteral b) -> $(Quotation.quoteIntegerExpression [| op |]
      [| \_ -> runCode leftCharges >> pure a |]
      [| \_ -> runCode rightCharges >> pure b |]
      [| runCode charges |])

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
    pure $ CE (TArr et) ($(Quotation.quoteAction [|
                         \env -> Seq.fromList <$> mapM ($ env) ((runCode f) : (map runCode fs))
                         |]))
  S.ObjectLiteral{} -> typeErr "object literal needs a typed context"
  S.FunctionCall _ (S.NewExpression _ Ty.Bytes{} Nothing) [n] -> do
    lf <- compileAs sc TInt n
    pure $ CE TBytes ($(Quotation.quoteAction [|
                      \env -> (\k -> B.replicate (fromIntegral k) 0) <$> (runCode lf) env
                      |]))
  S.FunctionCall _ (S.NewExpression _ ty Nothing) [n] | isArrayTy ty -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- compileAs sc TInt n
        pure $ CE t ($(Quotation.quoteAction [|
                     \env -> (\k -> Seq.replicate (fromIntegral k) (defaultOf et)) <$> (runCode lf) env
                     |]))
      _ -> err Internal "array new"
  S.NewExpression _ ty mLen -> do
    SomeTy t <- resolveTy c ty
    case t of
      TArr et -> do
        lf <- maybe (pure ($(Quotation.quoteAction [|
                           \_ -> pure 0
                           |]))) (compileAs sc TInt) mLen
        pure $ CE t ($(Quotation.quoteAction [|
                     \env -> (\n -> Seq.replicate (fromIntegral n) (defaultOf et)) <$> (runCode lf) env
                     |]))
      TContract _ -> unsupported "contract creation (new)"
      _ -> typeErr ("new " <> showTy t)
  S.InlineBoundsCheck _ lo hi x -> do
    f <- compileAs sc TInt x
    pure $ CE TInt $ if boundsImplied sc lo hi x then f else case (lo, hi) of
      (Nothing, Nothing) -> f
      (Just lower, Nothing) -> $(Quotation.quoteAction [|
        \env -> do
          v <- runCode f env
          when (v < lower) $ revert ("underflow: " <> T.pack (show v))
          pure v |])
      (Nothing, Just upper) -> $(Quotation.quoteAction [|
        \env -> do
          v <- runCode f env
          when (v > upper) $ revert ("overflow: " <> T.pack (show v))
          pure v |])
      (Just lower, Just upper) -> $(Quotation.quoteAction [|
        \env -> do
          v <- runCode f env
          when (v < lower) $ revert ("underflow: " <> T.pack (show v))
          when (v > upper) $ revert ("overflow: " <> T.pack (show v))
          pure v |])
  S.Variable _ "this" -> pure $ CE (TContract (cName c)) ($(Quotation.quoteAction [|
                                                          \_ -> fThis <$> frame
                                                          |]))
  S.Variable _ "now" -> pure $ CE TInt ($(Quotation.quoteAction [|
                                        \_ -> rtTimestamp <$> rt
                                        |]))
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ (TRef _) _) -> do LV t g _ <- compileLV sc e; pure (CE t g)
    Just (Var _ t i) -> pure $ CE t ($(Quotation.quoteAction [|
                                     \env -> liftIO (readIORef (ref i env))
                                     |]))
    Just (ValueVar _ t i _) -> pure $ CE t ($(Quotation.quoteAction [|
      \env -> pure (localValue i env) |]))
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
    "sender" -> pure $ CE TAddr ($(Quotation.quoteAction [|
                                 \_ -> do (runtime, caller) <- ask; liftIO $ rtSender runtime caller
                                 |]))
    "sig" -> pure $ CE TStr ($(Quotation.quoteAction [|
                             \_ -> fSig <$> frame
                             |]))
    "value" -> pure $ CE TInt ($(Quotation.quoteAction [|
                               \_ -> fValue <$> frame
                               |]))
    "data" -> pure $ CE TVariadic ($(Quotation.quoteAction [|
                                   \_ -> fArgs <$> frame
                                   |]))
    _ -> unsupported ("msg." <> m)
  S.MemberAccess _ (S.Variable _ "tx") "origin" -> parentMember $ pure $ CE TAddr ($(Quotation.quoteAction [|
                                                                                   \_ -> fOrigin <$> frame
                                                                                   |]))
  S.MemberAccess _ (S.Variable _ "block") m -> parentMember $ case m of
    "number" -> pure $ CE TInt ($(Quotation.quoteAction [|
                                \_ -> rtBlockNumber <$> rt
                                |]))
    "timestamp" -> pure $ CE TInt ($(Quotation.quoteAction [|
                                   \_ -> rtTimestamp <$> rt
                                   |]))
    _ | m `elem` ["prevProposer", "prevIntendedProposer", "coinbase", "proposer"] -> pure $ CE TAddr $ $(Quotation.quoteAction [|
                                                                                                       \_ -> do
          runtime <- rt
          liftIO $ case m of
            "prevProposer" -> (\(a, _, _) -> a) <$> rtPreviousBlock runtime
            "prevIntendedProposer" -> (\(_, a, _) -> a) <$> rtPreviousBlock runtime
            _ -> rtProposer runtime
                                                                                                       |])
      | m == "prevRound" -> pure $ CE TInt $ $(Quotation.quoteAction [|
                                             \_ -> do
          runtime <- rt
          liftIO $ (\(_, _, n) -> n) <$> rtPreviousBlock runtime
                                             |])
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
    TArr _ -> pure $ CE TInt ($(Quotation.quoteAction [|
                              fmap (fromIntegral . Seq.length) . (runCode f)
                              |]))
    TStr -> pure $ CE TInt ($(Quotation.quoteAction [|
                            fmap (fromIntegral . T.length) . (runCode f)
                            |]))
    TBytes -> pure $ CE TInt ($(Quotation.quoteAction [|
                              fmap (fromIntegral . B.length) . (runCode f)
                              |]))
    _ -> err Internal "length"
  S.MemberAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.IndexAccess _ (S.FunctionCall _ (S.Variable _ "getUserCert") args) (Just ix)
    | Nothing <- findFun (cFuns c) "getUserCert" (length args) -> do
        argsF <- compileDynArgs sc args
        _ <- compileAs sc TStr ix
        pure $ CE TStr $ $(Quotation.quoteAction [|
                         \env -> do
          _ <- (runCode argsF) env
          Builtins.missingUserCert
                         |])
  S.IndexAccess _ _ _ -> do LV t g _ <- compileLV sc e; pure (CE t g)
  S.FunctionCall _ callee args -> compileCall sc callee args
  S.Unitary _ op x -> case op of
    "!" -> do f <- compileAs sc TBool x; pure $ CE TBool ($(Quotation.quoteAction [|
                                                          fmap not . (runCode f)
                                                          |]))
    "-" -> do
      CE t f <- compileE sc x
      case t of
        TDecimal -> pure $ CE TDecimal ($(Quotation.quoteAction [|
                                        fmap negate . (runCode f)
                                        |]))
        _ -> do Refl <- sameTy TInt t; pure $ CE TInt ($(Quotation.quoteAction [|
                                                       fmap negate . (runCode f)
                                                       |]))
    "++" -> incr True x 1
    "--" -> incr True x (-1)
    "~" -> do f <- compileAs sc TInt x; pure $ CE TInt ($(Quotation.quoteAction [|
                                                        fmap complement . (runCode f)
                                                        |]))
    "delete" -> do
      (_, pathF) <- compileStorage sc x
      pure $ CE TUnit $ $(Quotation.quoteAction [|
                        \env -> do
        path <- (runCode pathF) env
        (runtime, caller) <- ask
        liftIO $ rtPut runtime (fThis caller) path BDefault
                        |])
    _ -> unsupported ("unary " <> T.pack op)
  S.PlusPlus _ x -> incr False x 1
  S.MinusMinus _ x -> incr False x (-1)
  S.Ternary _ cnd a b -> do
    cf <- compileAs sc TBool cnd
    CE t af <- compileE sc a
    bf <- compileAs sc t b
    pure $ CE t ($(Quotation.quoteAction [|
                 \env -> (runCode cf) env >>= \k -> if k then (runCode af) env else (runCode bf) env
                 |]))
  S.Binary _ "=" (S.TupleExpression _ lhss) r -> do
    -- (a, b) = rhs : assign through each l-value (holes skip)
    compileTupleAssignment sc False lhss r
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TAlias t _) i) <- lookupVar sc n -> do
        valueF <- compileAs sc t r
        pure $ CE t $ $(Quotation.quoteAction [|
                      \env -> do
          value <- (runCode valueF) env
          when chargeDestination $ chargeGas 1
          liftIO $ writeIORef (ref i env) (Right value)
          pure value
                      |])
  S.Binary _ "=" (S.Variable _ n) r
    | Just (Var _ (TRef st) i) <- lookupVar sc n -> do
        (other, pathF) <- compileStorage sc r
        when (showST st /= showST other) $ typeErr "storage alias type mismatch"
        pure $ CE TUnit $ $(Quotation.quoteAction [|
                          \env -> do
          path <- (runCode pathF) env
          when chargeDestination $ chargeGas 1
          liftIO $ writeIORef (ref i env) path
                          |])
  S.Binary _ "=" l r -> compileAssignment sc False chargeDestination l r
  S.Binary _ op l r | Just bop <- T.stripSuffix "=" (T.pack op), bop `elem` ["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>"] -> do
    LV t get set <- compileLV sc l
    case (t, bop) of
      (TDecimal, _) -> do
        rf <- compileAs sc TDecimal r
        f <- decimalOp True (case compileE sc r of Right (CE TDecimal _) -> True; _ -> False) bop
        pure $ CE TDecimal ($(Quotation.quoteAction [|
                            \env -> do b <- (runCode rf) env; a <- chargeAfter 1 ((runCode get) env); void $ chargeAfter 1 ((runCode get) env); v <- (runCode f) a b; (runCode set) env v; pure v
                            |]))
      (TStr, "+") -> do
        rf <- compileAs sc TStr r
        pure $ CE TStr ($(Quotation.quoteAction [|
                        \env -> do b <- (runCode rf) env; a <- chargeAfter 1 ((runCode get) env); void $ chargeAfter 1 ((runCode get) env); chargeOp (fromIntegral (T.length a + T.length b)); (runCode set) env (a <> b); pure (a <> b)
                        |]))
      _ -> do
        Refl <- sameTy TInt t
        rf <- compileAs sc TInt r
        f <- intOp bop
        pure $ CE TInt ($(Quotation.quoteAction [|
                        \env -> do b <- (runCode rf) env; a <- chargeAfter 1 ((runCode get) env); void $ chargeAfter 1 ((runCode get) env); v <- (runCode f) a b; (runCode set) env v; pure v
                        |]))
  S.Binary _ op l r -> binop (T.pack op) l r
  where
    c = sC sc

    compileConstant :: Ty t -> Expression -> C (Code (Env ls -> M t))
    compileConstant t initial = case initial of
      S.NumberLiteral{} -> literalConstant t initial
      S.AddressLiteral{} -> literalConstant t initial
      _ -> compileAs sc t initial

    literalConstant :: Ty t -> Expression -> C (Code (Env ls -> M t))
    literalConstant t initial = do
      CE source f <- compileE' sc initial
      case (t, source) of
        (TDecimal, TInt) -> pure $(Quotation.quoteAction [|
                                 (fmap fromInteger . (runCode f))
                                 |])
        (TContract _, TAddr) -> pure f
        _ -> do Refl <- sameTy t source; pure f

    parentMember compiled = do
      CE t action <- compiled
      pure $ CE t ($(Quotation.quoteAction [|
                   charged 1 . (runCode action)
                   |]))

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
      pure $ CE TInt $ $(Quotation.quoteAction [|
                       \env -> do
        (_, get, set) <- (runCode prepare) env
        v <- get
        let next = v + d
        set next
        pure (if prefix then next else v)
                       |])

    binop :: T.Text -> Expression -> Expression -> C (CE ls)
    binop op l r
      | op `elem` ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"] = do
          CE lt lf <- compileE sc l
          case (lt, op) of
            (TDecimal, _) -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp True (isDecimal r) op
              pure $ CE TDecimal $ if op `elem` ["/", "%"]
                then $(Quotation.quoteAction [|
                  \env -> do
                    runCode rf env >>= \b -> when (b == 0) (revert "division by zero")
                    a <- runCode lf env; b <- runCode rf env; runCode f a b |])
                else $(Quotation.quoteAction [|
                  \env -> do
                    a <- runCode lf env; b <- runCode rf env; runCode f a b |])
            (TInt, _) | Right (CE TDecimal _) <- compileE sc r -> do
              rf <- compileAs sc TDecimal r
              f <- decimalOp False True op
              pure $ CE TDecimal $ if op `elem` ["/", "%"]
                then $(Quotation.quoteAction [|
                  \env -> do
                    runCode rf env >>= \b -> when (b == 0) (revert "division by zero")
                    a <- runCode lf env; b <- runCode rf env; runCode f (fromInteger a) b |])
                else $(Quotation.quoteAction [|
                  \env -> do
                    a <- runCode lf env; b <- runCode rf env; runCode f (fromInteger a) b |])
            (TStr, "+") -> do rf <- compileAs sc TStr r; pure $ CE TStr ($(Quotation.quoteAction [|
                                                                         \env -> do a <- (runCode lf) env; b <- (runCode rf) env; chargeOp (fromIntegral (T.length a + T.length b)); pure (a <> b)
                                                                         |]))
            (TBytes, "+") -> do rf <- compileAs sc TBytes r; pure $ CE TBytes ($(Quotation.quoteAction [|
                                                                               \env -> do a <- (runCode lf) env; b <- (runCode rf) env; chargeOp (fromIntegral (B.length a + B.length b)); pure (a <> b)
                                                                               |]))
            _ -> do
              Refl <- sameTy TInt lt
              rf <- compileAs sc TInt r
              f <- intOp op
              pure $ CE TInt $ if op `elem` ["/", "%"]
                then $(Quotation.quoteAction [|
                  \env -> do
                    runCode rf env >>= \b -> when (b == 0) (revert "division by zero")
                    a <- runCode lf env; b <- runCode rf env; runCode f a b |])
                else $(Quotation.quoteAction [|
                  \env -> do
                    a <- runCode lf env; b <- runCode rf env; runCode f a b |])
      | op `elem` ["==", "!="] = do
          CE lt lf <- compileE sc l
          rf <- compileAs sc lt r
          eq <- eqOn lt
          let k = if op == "==" then $(Quotation.quoteAction [| id |]) else $(Quotation.quoteAction [| not |])
          pure $ CE TBool ($(Quotation.quoteAction [|
                           \env -> do a <- (runCode lf) env; b <- (runCode rf) env; pure (runCode k (runCode eq a b))
                           |]))
      | op `elem` ["<", ">", "<=", ">="] = do
          if isDecimal l || isDecimal r then do
            lf <- compileAs sc TDecimal l
            rf <- compileAs sc TDecimal r
            let comparison = comparisonOp op
            pure $ CE TBool ($(Quotation.quoteAction [|
                             \env -> runCode comparison <$> runCode lf env <*> runCode rf env
                             |]))
          else do
            lf <- compileAs sc TInt l
            rf <- compileAs sc TInt r
            let comparison = comparisonOp op
            pure $ CE TBool ($(Quotation.quoteAction [|
                             \env -> runCode comparison <$> runCode lf env <*> runCode rf env
                             |]))
      | op == "&&" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool ($(Quotation.quoteAction [|
                           \env -> (runCode lf) env >>= \a -> if a then (runCode rf) env else pure False
                           |]))
      | op == "||" = do
          lf <- compileAs sc TBool l; rf <- compileAs sc TBool r
          pure $ CE TBool ($(Quotation.quoteAction [|
                           \env -> (runCode lf) env >>= \a -> if a then pure True else (runCode rf) env
                           |]))
      | otherwise = unsupported ("operator " <> op)

    isDecimal x = case compileE sc x of Right (CE TDecimal _) -> True; _ -> False

    eqOn :: Ty t -> C (Code (t -> t -> Bool))
    eqOn = \case
      TDecimal -> pure $(Quotation.quoteAction [| (==) |]); TInt -> pure $(Quotation.quoteAction [| (==) |]); TBool -> pure $(Quotation.quoteAction [| (==) |]); TAddr -> pure $(Quotation.quoteAction [| (==) |]); TStr -> pure $(Quotation.quoteAction [| (==) |]); TBytes -> pure $(Quotation.quoteAction [| (==) |])
      TEnum _ _ -> pure $(Quotation.quoteAction [| (==) |]); TContract _ -> pure $(Quotation.quoteAction [| (==) |])
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

comparisonOp :: Ord a => T.Text -> Code (a -> a -> Bool)
comparisonOp = \case
  "<" -> $(Quotation.quoteAction [| (<) |])
  ">" -> $(Quotation.quoteAction [| (>) |])
  "<=" -> $(Quotation.quoteAction [| (<=) |])
  _ -> $(Quotation.quoteAction [| (>=) |])

decimalOp :: Bool -> Bool -> T.Text -> C (Code (Decimal -> Decimal -> M Decimal))
decimalOp leftDecimal rightDecimal op = do
  operation <- decimalOp' op
  let size = if op == "/" && leftDecimal && rightDecimal
        then $(Quotation.quoteAction [| \a b -> max (byteWidth a) (byteWidth b) |])
        else integerOpSize op
  pure $ $(Quotation.quoteAction [|
         \a b -> do
    let places = fromIntegral (max (decimalPlaces a) (decimalPlaces b))
        bytes = runCode size (decimalMantissa a) (decimalMantissa b)
    chargeOp (places + bytes)
    runCode operation a b
         |])

decimalOp' :: T.Text -> C (Code (Decimal -> Decimal -> M Decimal))
decimalOp' op = case op of
  "+" -> pure $(Quotation.quoteAction [| rounded (+) |])
  "-" -> pure $(Quotation.quoteAction [| rounded (-) |])
  "*" -> pure $(Quotation.quoteAction [| rounded (*) |])
  "/" -> pure $ $(Quotation.quoteAction [|
                \a b -> if b == 0 then revert "division by zero" else rounded (/) a b
                |])
  _ -> unsupported ("decimal operator " <> op)

data SomeTuple ls = forall ts. SomeTuple (Fields ts) (Code (Env ls -> M (HL ts)))

tupleOf :: [CE ls] -> C (SomeTuple ls)
tupleOf [] = pure (SomeTuple FNil ($(Quotation.quoteAction [|
                                   \_ -> pure HNil
                                   |])))
tupleOf (CE t f : rest) = do
  SomeTuple fs k <- tupleOf rest
  pure (SomeTuple (FCons "" t fs) ($(Quotation.quoteAction [|
                                   \env -> (:*) <$> (runCode f) env <*> (runCode k) env
                                   |])))

compileTupleAssignment :: forall ls r. Scope ls r -> Bool -> [Maybe Expression] -> Expression -> C (CE ls)
compileTupleAssignment sc destinationFirst lhss rhs = do
  CE t valueF <- compileE sc rhs
  case t of
    TStruct _ fs -> assignment fs valueF
    TTuple fs -> assignment fs valueF
    _ -> typeErr ("destructuring a non-tuple " <> showTy t)
  where
    assignment :: Fields ts -> (Code (Env ls -> M (HL ts))) -> C (CE ls)
    assignment fs valueF = do
      prepare <- tupleSetters sc fs lhss
      pure $ CE TUnit $ $(Quotation.quoteAction [|
                        \env -> do
        let destination = chargeAfter 1 ((runCode prepare) env)
        (set, values) <- if destinationFirst
          then (,) <$> destination <*> (runCode valueF) env
          else do values <- (runCode valueF) env; set <- destination; pure (set, values)
        set values
                        |])

tupleSetters :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Code (Env ls -> M (HL ts -> M ())))
tupleSetters sc fs entries = typedTupleSetters (scopeTypes sc) fs <$> tupleSettersBody sc fs entries

tupleSettersBody :: Scope ls r -> Fields ts -> [Maybe Expression] -> C (Code (Env ls -> M (HL ts -> M ())))
tupleSettersBody _ FNil [] = pure ($(Quotation.quoteAction [|
                               \_ -> pure (\_ -> pure ())
                               |]))
tupleSettersBody sc (FCons _ t rest) (mx : xs) = do
  prepare <- case mx of
    Nothing -> pure ($(Quotation.quoteAction [|
                     \_ -> pure (\_ -> pure ())
                     |]))
    Just x -> do
      Destination lt location <- compileDestination sc True x
      Refl <- sameTy lt t
      pure ($(Quotation.quoteAction [|
            \env -> do (_, _, set) <- (runCode location) env; pure set
            |]))
  remaining <- tupleSetters sc rest xs
  pure $ $(Quotation.quoteAction [|
         \env -> do
    set <- (runCode prepare) env
    next <- (runCode remaining) env
    pure (\hl -> case hl of (v :* vs) -> set v >> next vs)
         |])
tupleSettersBody _ _ _ = typeErr "destructuring arity mismatch"

integerOpSize :: T.Text -> Code (Integer -> Integer -> Integer)
integerOpSize = \case
  "+" -> $(Quotation.quoteIntegerSize "+")
  "-" -> $(Quotation.quoteIntegerSize "-")
  "*" -> $(Quotation.quoteIntegerSize "*")
  "/" -> $(Quotation.quoteIntegerSize "/")
  "%" -> $(Quotation.quoteIntegerSize "%")
  "**" -> $(Quotation.quoteIntegerSize "**")
  "<<" -> $(Quotation.quoteIntegerSize "<<")
  ">>" -> $(Quotation.quoteIntegerSize ">>")
  _ -> $(Quotation.quoteIntegerSize "")

intOp :: T.Text -> C (Code (Integer -> Integer -> M Integer))
intOp = \case
  "+" -> pure $(Quotation.quoteIntegerPrimitive "+")
  "-" -> pure $(Quotation.quoteIntegerPrimitive "-")
  "*" -> pure $(Quotation.quoteIntegerPrimitive "*")
  "/" -> pure ($(Quotation.quoteIntegerAction "/" [|
               \a b -> if b == 0 then revert "division by zero" else pure (a `div` b)
               |]))
  "%" -> pure ($(Quotation.quoteIntegerAction "%" [|
               \a b -> if b == 0 then revert "modulo by zero" else pure (a `rem` b)
               |]))
  "**" -> pure ($(Quotation.quoteIntegerAction "**" [|
                \a b -> if b < 0 then revert "negative exponent" else pure (a ^ b)
                |]))
  "|" -> pure ($(Quotation.quoteIntegerAction "|" [|
               \a b -> pure (a .|. b)
               |]))
  "&" -> pure ($(Quotation.quoteIntegerAction "&" [|
               \a b -> pure (a .&. b)
               |]))
  "^" -> pure ($(Quotation.quoteIntegerAction "^" [|
               \a b -> pure (xor a b)
               |]))
  "<<" -> pure ($(Quotation.quoteIntegerAction "<<" [|
                \a b -> pure (shiftL a (fromIntegral b))
                |]))
  ">>" -> pure ($(Quotation.quoteIntegerAction ">>" [|
                \a b -> pure (shiftR a (fromIntegral b))
                |]))
  op -> unsupported ("operator " <> op)

unitMul :: Maybe S.NumberUnit -> Integer
unitMul = \case
  Nothing -> 1; Just S.Wei -> 1; Just S.Szabo -> 10 ^ (12 :: Int); Just S.Finney -> 10 ^ (15 :: Int); Just S.Ether -> 10 ^ (18 :: Int)

-- ---------------------------------------------------------------- l-values

data ALV ls = forall t. ALV (Ty t) (Code (Env ls -> M (Maybe StoragePath))) (Code (Env ls -> M t)) (Code (Env ls -> t -> M ()))

compileAliasLV :: Scope ls r -> Expression -> C (ALV ls)
compileAliasLV sc e = do
  ALV t path get set <- compileAliasLVBody sc e
  pure (ALV t (typedPath (scopeTypes sc) path) (typedCode (scopeTypes sc) t get) (typedSetter (scopeTypes sc) t set))

compileAliasLVBody :: Scope ls r -> Expression -> C (ALV ls)
compileAliasLVBody sc expression = case expression of
  S.Variable _ name | Just (Var _ (TAlias t _) i) <- lookupVar sc name ->
    pure $ ALV t
      ($(Quotation.quoteAction [|
       \env -> either Just (const Nothing) <$> liftIO (readIORef (ref i env))
       |]))
      ($(Quotation.quoteAction [|
       \env -> liftIO (readIORef (ref i env)) >>= either (readVal t) pure
       |]))
      ($(Quotation.quoteAction [|
       \env value -> liftIO $ writeIORef (ref i env) (Right value)
       |]))
  S.MemberAccess _ parent field -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    case t of
      TStruct _ fields -> do
        SomeIx ft i <- fieldIx fields field
        pure $ ALV ft
          ($(Quotation.quoteAction [|
           \env -> fmap (`snocP` Field (TE.encodeUtf8 field)) <$> (runCode pathOf) env
           |]))
          ($(Quotation.quoteAction [|
           \env -> hget i <$> (runCode get) env
           |]))
          ($(Quotation.quoteAction [|
           \env value -> (runCode get) env >>= (runCode set) env . hset i value
           |]))
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    ALV t pathOf get set <- compileAliasLV sc parent
    indexF <- compileAs sc TInt index
    case t of
      TArr et -> pure $ ALV et
        ($(Quotation.quoteAction [|
         \env -> (runCode pathOf) env >>= \case
          Nothing -> pure Nothing
          Just path -> do
            i <- (runCode indexF) env
            pure $ Just $ snocP path (Index (BC.pack (show i)))
         |]))
        ($(Quotation.quoteAction [|
         \env -> do
          values <- (runCode get) env
          i <- (runCode indexF) env
          maybe (revert "alias array index out of bounds") pure (Seq.lookup (fromIntegral i) values)
         |]))
        ($(Quotation.quoteAction [|
         \env value -> do
          values <- (runCode get) env
          i <- (runCode indexF) env
          when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "alias array index out of bounds"
          (runCode set) env (Seq.update (fromIntegral i) value values)
         |]))
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileLV :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLV sc e = do
  LV t get set <- compileLVBody sc e
  pure (LV t (typedCode (scopeTypes sc) t get) (typedSetter (scopeTypes sc) t set))

compileLVBody :: forall ls r. Scope ls r -> Expression -> C (LV ls)
compileLVBody sc e | Right (ALV originalTy pathOf _ set) <- compileAliasLV sc e = do
  Destination t prepare <- compileAliasDestination sc False e
  Refl <- sameTy originalTy t
  pure $ LV t
    ($(Quotation.quoteAction [|
     \env -> do (_, get, _) <- (runCode prepare) env; get
     |]))
    ($(Quotation.quoteAction [|
     \env value -> (runCode pathOf) env >>= maybe ((runCode set) env value) (\path -> writeVal t path value)
     |]))
compileLVBody sc e = atLine (S.extractExpression e) $ case e of
  S.InlineBoundsCheck _ lo hi x -> do
    LV t get set <- compileLV sc x
    Refl <- sameTy TInt t
    pure $ LV TInt $(Quotation.quoteAction [| chargeAfter 1 . runCode get |]) $ $(Quotation.quoteAction [|
                                           \env v -> do
      when (maybe False (v <) lo) $ revert ("underflow: " <> T.pack (show v))
      when (maybe False (v >) hi) $ revert ("overflow: " <> T.pack (show v))
      (runCode set) env v
                                           |])
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notRef t ->
    pure $ LV t ($(Quotation.quoteAction [|
                 \env -> liftIO (readIORef (ref i env))
                 |])) ($(Quotation.quoteAction [|
                                                          \env v -> liftIO (writeIORef (ref i env) v)
                                                          |]))
  -- field of a struct *value* (memory): read-modify-write the whole parent
  S.MemberAccess _ p f | Right (LV pt get set) <- valueLV p, TStruct _ fs <- pt -> do
    SomeIx t ix <- fieldIx fs f
    pure $ LV t ($(Quotation.quoteAction [|
                 \env -> hget ix <$> (runCode get) env
                 |])) ($(Quotation.quoteAction [|
                                               \env v -> (runCode get) env >>= (runCode set) env . hset ix v
                                               |]))
  -- element of an array / bytes *value*
  S.IndexAccess _ p (Just ix) | Right (LV pt get set) <- valueLV p, isIndexable pt -> do
    kf <- compileAs sc TInt ix
    case pt of
      TArr et -> do
        pure $ LV et ($(Quotation.quoteAction [|
                      \env -> do xs <- (runCode get) env; i <- (runCode kf) env; checkIndex (Seq.length xs) i; pure (Seq.index xs (fromIntegral i))
                      |]))
                    ($(Quotation.quoteAction [|
                     \env v -> do xs <- (runCode get) env; i <- (runCode kf) env; checkIndex (Seq.length xs) i; (runCode set) env (Seq.update (fromIntegral i) v xs)
                     |]))
      TBytes -> do
        pure $ LV TInt ($(Quotation.quoteAction [|
                        \env -> do bs <- (runCode get) env; i <- (runCode kf) env; checkIndex (B.length bs) i; pure (fromIntegral (B.index bs (fromIntegral i)))
                        |]))
                      ($(Quotation.quoteAction [|
                       \env v -> do bs <- (runCode get) env; i <- (runCode kf) env; checkIndex (B.length bs) i
                                    let (a, b) = B.splitAt (fromIntegral i) bs
                                    (runCode set) env (a <> B.singleton (fromIntegral v) <> B.drop 1 b)
                       |]))
      _ -> err Internal "indexable"
  _ -> do
    (st, pathOf) <- compileStorage' sc e
    case st of
      SScalar (SomeTy t) -> pure $ LV t ($(Quotation.quoteAction [|
                                         \env -> (runCode pathOf) env >>= readSlot t
                                         |])) ($(Quotation.quoteAction [|
                                                                             \env v -> (runCode pathOf) env >>= \p -> writeSlot t p v
                                                                             |]))
      SMap{} -> typeErr "mapping used as a value"
      _ -> do
        SomeTy t <- stypeTy st
        pure $ LV t ($(Quotation.quoteAction [|
                     \env -> (runCode pathOf) env >>= readVal t
                     |])) ($(Quotation.quoteAction [|
                                                        \env v -> (runCode pathOf) env >>= \p -> writeVal t p v
                                                        |]))
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
          _ -> do CE t g <- compileE sc x; pure (LV t g ($(Quotation.quoteAction [|
                                                         \_ _ -> diverge "assignment to a temporary"
                                                         |])))
    chargedParent x = do
      LV t get set <- compileLV sc x
      pure $ LV t ($(Quotation.quoteAction [|
                   chargeAfter 1 . (runCode get)
                   |])) set
    isStorageRooted :: Expression -> Bool
    isStorageRooted = \case
      S.Variable _ n -> case lookupVar sc n of
        Just (Var _ (TRef _) _) -> True
        Just (Var{}) -> False
        Just (ValueVar{}) -> False
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

compileStorage :: Scope ls r -> Expression -> C (SType, Code (Env ls -> M StoragePath))
compileStorage sc expression = do
  (st, action) <- compileStorage' sc expression
  pure (st, case expression of
    S.FunctionCall{} -> action
    _ -> $(Quotation.quoteAction [| chargeAfter 1 . runCode action |]))

compileStorage' :: Scope ls r -> Expression -> C (SType, Code (Env ls -> M StoragePath))
compileStorage' sc = \case
  S.InlineBoundsCheck _ _ _ expression -> compileStorage sc expression
  S.Variable _ n -> case lookupVar sc n of
    Just (Var _ (TAlias _ st) i) -> pure (st, $(Quotation.quoteAction [|
                                              \env -> liftIO (readIORef (ref i env)) >>= either pure (const (diverge "memory value used as storage pointer"))
                                              |]))
    Just (RefVar _ st i) -> pure (st, $(Quotation.quoteAction [|
                                      \env -> liftIO (readIORef (ref i env))
                                      |]))
    Just (Var _ (TRef st) i) -> pure (st, $(Quotation.quoteAction [|
                                          \env -> liftIO (readIORef (ref i env))
                                          |]))
    Just (ValueVar{}) -> typeErr ("local value " <> n <> " used where a storage location is required")
    Just (Var{}) -> typeErr ("local value " <> n <> " used where a storage location is required")
    Nothing -> case M.lookup n (cStorage (sC sc)) of
      Just st -> pure (st, $(Quotation.quoteAction [|
                           \_ -> pure (StoragePath [Field (TE.encodeUtf8 n)])
                           |]))
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
        pure (v, $(Quotation.quoteAction [|
                 \env -> do _ <- (runCode pp) env; ps <- (runCode pp) env; key <- (runCode kf) env; pure (snocP ps (encodeKey k key))
                 |]))
      SArray el -> do
        kf <- compileAs sc TInt ix
        pure (el, $(Quotation.quoteAction [|
                  \env -> do
          _ <- (runCode pp) env; ps <- (runCode pp) env; i <- (runCode kf) env
          pure (snocP ps (Index (BC.pack (show i))))
                  |]))
      _ -> typeErr "index into a non-mapping"
  S.IndexAccess _ _ Nothing -> typeErr "empty index"
  S.MemberAccess _ p f -> do
    (st, pp) <- compileStorage sc p
    case st of
      SStruct _ fs | Just ft <- lookup f fs -> pure (ft, $(Quotation.quoteAction [|
                                                         \env -> (`snocP` Field (TE.encodeUtf8 f)) <$> (runCode pp) env
                                                         |]))
                   | otherwise -> unknown ("struct field " <> f)
      SArray _ | f == "length" -> pure (SScalar (SomeTy TInt), $(Quotation.quoteAction [|
                                                               \env -> (`snocP` Field "length") <$> (runCode pp) env
                                                               |]))
      _ -> typeErr ("member " <> f <> " of a non-struct storage value")
  e -> unsupported ("storage reference " <> T.take 60 (T.pack (show (() <$ e))))

-- Resolve the destination before writing, so gas is charged at lookup rather
-- than during a setter that may otherwise re-evaluate an index or parent.
data Destination ls = forall t. Destination (Ty t) (Code (Env ls -> M (Maybe StoragePath, M t, t -> M ())))

compileDestination :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestination sc metered e = do
  Destination t action <- compileDestinationBody sc metered e
  pure (Destination t (typedDestination (scopeTypes sc) t action))

compileDestinationBody :: forall ls r. Scope ls r -> Bool -> Expression -> C (Destination ls)
compileDestinationBody sc metered expression = case expression of
  S.InlineBoundsCheck _ lo hi inner -> do
    Destination t prepare <- compileDestination sc True inner
    Refl <- sameTy TInt t
    pure $ Destination TInt $ $(Quotation.quoteAction [|
                              \env -> do
      location@(_, get, _) <- (runCode prepare) env
      value <- get
      when (maybe False (value <) lo) $ revert ("underflow: " <> T.pack (show value))
      when (maybe False (value >) hi) $ revert ("overflow: " <> T.pack (show value))
      when metered $ chargeGas 1
      pure location
                              |])
  S.Variable _ n | Just (Var _ t i) <- lookupVar sc n, notReference t ->
    pure $ Destination t $ $(Quotation.quoteAction [|
                           \env -> do
      when metered $ chargeGas 1
      pure((Nothing, liftIO (readIORef (ref i env)), liftIO . writeIORef (ref i env)))
                           |])
  _ | Right _ <- compileAliasLV sc expression -> compileAliasDestination sc metered expression
  _ | Right (st, pathOf) <- compileStorage' sc expression -> do
    SomeTy t <- stypeTy st
    pure $ Destination t $ $(Quotation.quoteAction [|
                           \env -> do
      path <- (runCode pathOf) env
      when metered $ chargeGas 1
      pure (Just path, readVal t path, writeVal t path)
                           |])
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileDestination sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ $(Quotation.quoteAction [|
                               \env -> do
          (_, get, set) <- (runCode prepare) env
          when metered $ chargeGas 1
          pure((Nothing, hget i <$> get, \value -> get >>= set . hset i value))
                               |])
      _ -> typeErr "destination member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileDestination sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ $(Quotation.quoteAction [|
                                       \env -> do
        (_, get, set) <- (runCode prepare) env
        i <- (runCode indexF) env
        values <- get
        when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "index out of bounds"
        when metered $ chargeGas 1
        pure((Nothing, maybe (revert "index out of bounds") pure . Seq.lookup (fromIntegral i) =<< get,
          \value -> get >>= set . Seq.update (fromIntegral i) value))
                                       |])
      TBytes -> pure $ Destination TInt $ $(Quotation.quoteAction [|
                                          \env -> do
        (_, get, set) <- (runCode prepare) env
        i <- (runCode indexF) env
        bytes <- get
        when (i < 0 || i >= fromIntegral (B.length bytes)) $ revert "index out of bounds"
        when metered $ chargeGas 1
        pure((Nothing, fromIntegral . (`B.index` fromIntegral i) <$> get,
          \value -> do
            bytes' <- get
            let (before, after) = B.splitAt (fromIntegral i) bytes'
            set (before <> B.singleton (fromIntegral value) <> B.drop 1 after)))
                                          |])
      _ -> typeErr "destination index into a non-array"
  _ -> do
    LV t get set <- compileLV sc expression
    pure $ Destination t $ $(Quotation.quoteAction [|
                           \env -> do
      when metered $ chargeGas 1
      pure (Nothing, (runCode get) env, (runCode set) env)
                           |])
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
    pure $ Destination t $ $(Quotation.quoteAction [|
                           \env -> do
      value <- liftIO $ readIORef (ref i env)
      when metered $ chargeGas 1
      pure $ case value of
        Left path -> (Just path, readVal t path, writeVal t path)
        Right current -> (Nothing, pure current, liftIO . writeIORef (ref i env) . Right)
                           |])
  S.MemberAccess _ parent field -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    case pt of
      TStruct _ fs -> do
        SomeIx t i <- fieldIx fs field
        pure $ Destination t $ $(Quotation.quoteAction [|
                               \env -> do
          (parentPath, get, set) <- (runCode prepare) env
          when metered $ chargeGas 1
          pure $ case parentPath of
            Just path -> let child = snocP path (Field (TE.encodeUtf8 field))
              in (Just child, readVal t child, writeVal t child)
            Nothing -> (Nothing, hget i <$> get, \value -> get >>= set . hset i value)
                               |])
      _ -> typeErr "alias member of a non-struct"
  S.IndexAccess _ parent (Just index) -> do
    Destination pt prepare <- compileAliasDestination sc True parent
    indexF <- compileAs sc TInt index
    case pt of
      TArr t -> pure $ Destination t $ $(Quotation.quoteAction [|
                                       \env -> do
        initial@(parentPath, _, _) <- (runCode prepare) env
        (path, get, set) <- maybe (pure initial) (const ((runCode prepare) env)) parentPath
        i <- (runCode indexF) env
        location <- case path of
          Just storage -> let child = snocP storage (Index (BC.pack (show i)))
            in pure (Just child, readVal t child, writeVal t child)
          Nothing -> do
            values <- get
            when (i < 0 || i >= fromIntegral (Seq.length values)) $ revert "alias array index out of bounds"
            pure((Nothing, maybe (revert "alias array index out of bounds") pure . Seq.lookup (fromIntegral i) =<< get,
              \value -> get >>= set . Seq.update (fromIntegral i) value))
        when metered $ chargeGas 1
        pure location
                                       |])
      _ -> typeErr "alias index into a non-array"
  _ -> typeErr "not an aggregate alias"

compileAssignment :: Scope ls r -> Bool -> Bool -> Expression -> Expression -> C (CE ls)
compileAssignment sc destinationFirst metered l r
  | S.Variable _ name <- l
  , not scalarSource
  , Just (Var _ t i) <- lookupVar sc name
  , plainLocal t = do
      valueF <- compileAs sc t r
      let evaluateValue = if not metered then valueF
            else if destinationFirst
              then $(Quotation.quoteAction [| charged 1 . runCode valueF |])
              else $(Quotation.quoteAction [| chargeAfter 1 . runCode valueF |])
      pure $ CE t $ typedCode (scopeTypes sc) t $(Quotation.quoteAction [|
        \env -> do
          value <- runCode evaluateValue env
          liftIO $ writeIORef (ref i env) value
          pure value |])
  | S.Variable{} <- l
  , not scalarSource
  , Right (SScalar (SomeTy t), pathOf) <- compileStorage' sc l = do
      valueF <- compileAs sc t r
      let pathF = if metered
            then $(Quotation.quoteAction [| chargeAfter 1 . runCode pathOf |])
            else pathOf
          write = case (t, compileE sc r) of
            (TContract _, Right (CE TAddr _)) -> $(Quotation.quoteAction [| writeSlot TAddr |])
            _ -> $(Quotation.quoteAction [| writeVal t |])
      pure $ CE t $ typedCode (scopeTypes sc) t $ if destinationFirst
        then $(Quotation.quoteAction [|
          \env -> do
            path <- runCode pathF env
            value <- runCode valueF env
            runCode write path value
            pure value |])
        else $(Quotation.quoteAction [|
          \env -> do
            value <- runCode valueF env
            path <- runCode pathF env
            runCode write path value
            pure value |])
  | otherwise = compileGeneralAssignment sc destinationFirst metered l r
  where
    scalarSource = case compileStorage sc r of Right (SScalar{}, _) -> True; _ -> False
    plainLocal :: Ty t -> Bool
    plainLocal = \case TRef{} -> False; TAlias{} -> False; _ -> True

compileGeneralAssignment :: Scope ls r -> Bool -> Bool -> Expression -> Expression -> C (CE ls)
compileGeneralAssignment sc destinationFirst metered l r = do
  let indexedMemory = case l of
        S.IndexAccess _ _ _ -> case compileStorage sc l of Left _ -> True; _ -> False
        _ -> False
  Destination t prepare <- compileDestination sc (metered && not indexedMemory) l
  extraParent <- case l of
    S.IndexAccess _ parent _ | not indexedMemory -> do
      (_, parentF) <- compileStorage sc parent
      pure $(Quotation.quoteAction [|
           (void . (runCode parentF))
           |])
    _ -> pure ($(Quotation.quoteAction [|
               \_ -> pure ()
               |]))
  case compileStorage sc r of
    Right (SScalar (SomeTy sourceTy), sourceF) -> do
      _ <- compileAs sc t r
      pure $ CE t $ $(Quotation.quoteAction [|
                    \env -> do
        let source = do
              path <- (runCode sourceF) env
              (runtime, caller) <- ask
              basic <- liftIO $ rtGet runtime (fThis caller) path
              value <- either diverge pure (fromBasic sourceTy basic) >>= fromDyn t . Dyn sourceTy
              pure (path, basic, value)
        (location, (path, basic, value)) <- if destinationFirst
          then (,) <$> (runCode prepare) env <*> source
          else do src <- source; (runCode extraParent) env; dst <- (runCode prepare) env; pure (dst, src)
        case location of
          (Just destination, _, _) -> do
            (runtime, caller) <- ask
            liftIO $ case basic of
              BDefault -> rtCopyStorage runtime destination path
              _ -> rtPut runtime (fThis caller) destination basic
          (_, _, set) -> set value
        pure value
                    |])
    _ -> do
      valueF <- compileAs sc t r
      let addressValue :: Bool
          addressValue = case (t, compileE sc r) of
            (TContract _, Right (CE TAddr _)) -> True
            _ -> False
      pure $ CE t $ $(Quotation.quoteAction [|
                    \env -> do
        (location, value) <- if destinationFirst
          then (,) <$> (runCode prepare) env <*> (runCode valueF) env
          else do value <- (runCode valueF) env; (runCode extraParent) env; location <- (runCode prepare) env; pure (location, value)
        case (location, addressValue) of
          ((Just path, _, _), True) -> case t of
            TContract _ -> writeSlot TAddr path value
            _ -> diverge "contract assignment witness"
          ((_, _, set), _) -> set value
        pure value
                    |])

-- ---------------------------------------------------------------- calls

compileCall :: forall ls r. Scope ls r -> Expression -> [Expression] -> C (CE ls)
compileCall sc callee args = case callee of
  S.Variable _ "require" -> requireLike "require"
  S.Variable _ "assert" -> requireLike "assert"
  S.Variable _ "revert" -> case args of
    [] -> pure $ CE TUnit ($(Quotation.quoteAction [|
                           \_ -> revert ""
                           |]))
    [m] -> do mf <- compileAs sc TStr m; pure $ CE TUnit ($(Quotation.quoteAction [|
                                                          \env -> (runCode mf) env >>= revert
                                                          |]))
    _ -> typeErr "revert takes at most one argument"
  S.Variable _ "keccak256" -> case args of
    [x] | Right (CE TBytes f) <- compileE sc x -> pure $ CE TBytes ($(Quotation.quoteAction [|
                                                                    fmap (keccak256ToByteString . hash) . (runCode f)
                                                                    |]))
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
              pure $ CE (TEnum n names) $ $(Quotation.quoteAction [|
                                          \env -> do v <- (runCode f) env
                                                     when (v < 0 || v >= fromIntegral (length names)) $ revert ("enum out of range: " <> T.pack (show v))
                                                     pure (enumValue v)
                                          |])
    _ -> typeErr "enum conversion takes one argument"
  S.Variable _ n | Just _ <- lookupStruct c n -> do
    SomeTy t <- resolveName c n
    case t of
      TStruct _ fs -> do f <- compileFields sc fs args; pure (CE t f)
      _ -> err Internal "struct type"
  S.Variable _ n | M.member n (cCC c ^. contracts) -> case args of
    [x] -> do CE t f <- compileE sc x
              case t of
                TAddr -> pure (CE (TContract n) ($(Quotation.quoteAction [|
                                                 chargeAfter 500 . (runCode f)
                                                 |])))
                TContract _ -> pure (CE (TContract n) ($(Quotation.quoteAction [|
                                                       chargeAfter 500 . (runCode f)
                                                       |])))
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
          [] -> pure ($(Quotation.quoteAction [|
                      \_ -> pure (defaultOf et)
                      |]))
          [x] -> compileAs sc et x
          _ -> typeErr "push takes at most one argument"
        pure $ CE TInt $ $(Quotation.quoteAction [|
                         \env -> do
          v <- (runCode vf) env; _ <- (runCode pp) env; ps <- (runCode pp) env
          n <- readSlot TInt (snocP ps (Field "length"))
          writeSlot TInt (snocP ps (Field "length")) (n + 1)
          writeVal et (snocP ps (Index (BC.pack (show n)))) v
          pure (n + 1)
                         |])
    Right _ -> typeErr "push on a non-array"
    Left _ -> do
      -- a local array is a Seq: push is a typed snoc, returns the new length
      LV tt get set <- compileLV sc target
      case tt of
        TArr et -> do
          vf <- case args of
            [] -> pure ($(Quotation.quoteAction [|
                        \_ -> pure (defaultOf et)
                        |]))
            [x] -> compileAs sc et x
            _ -> typeErr "push takes at most one argument"
          pure $ CE TInt $ $(Quotation.quoteAction [|
                           \env -> do v <- (runCode vf) env; chargeGas 1; xs <- chargeAfter 1 ((runCode get) env); (runCode set) env (xs Seq.|> v); pure (fromIntegral (Seq.length xs + 1))
                           |])
        _ -> typeErr ("push on " <> showTy tt)
  S.MemberAccess _ target m -> do
    CE tt tf <- compileE sc target
    case tt of
      TContract cn | Nothing <- usingLib tt m -> externalCall cn tf m
      TAddr | m == "balance" -> unsupported "address.balance"
      TDecimal | m == "truncate", [places] <- args -> do
        placesF <- compileAs sc TInt places
        pure $ CE TDecimal ($(Quotation.quoteAction [|
                            \env -> do n <- (runCode placesF) env; value <- (runCode tf) env; pure $ roundTo' truncate (fromInteger n) value
                            |]))
      _ -> case usingLib tt m of
        Just (lib, fe) -> do
          -- `using L for T`: x.f(args) == L.f(x, args)
          SomeSig sig <- (\(FunEntry es _) -> es) fe
          case sig of
            SigCons t0 rest -> do
              Refl <- sameTy t0 tt
              let FunEntry _ efun = fe
              CE rt' k <- applyCall sc rest ($(Quotation.quoteAction [|
                                             \env -> do x <- (runCode tf) env; chargeGas 1; pure (link sig efun x)
                                             |])) args
              pure (CE rt' k)
            SigNil _ -> typeErr ("library function " <> lib <> "." <> m <> " takes no arguments")
        Nothing -> unsupported ("method " <> m <> " on " <> showTy tt)
  S.NewExpression _ ty mSalt -> do
    saltF <- traverse (\salt -> do CE st sf <- compileE sc salt; pure ($(Quotation.quoteAction [|
                                                                       \env -> Dyn st <$> (runCode sf) env
                                                                       |]))) mSalt
    SomeTy t <- resolveTy c ty
    case t of
      TContract n -> do
        target <- maybe (unknown ("contract " <> n)) pure (M.lookup n (cCC c ^. contracts))
        SomeSig sig <- maybe (pure (SomeSig (SigNil TUnit))) (funSig (mkCtx (cCC c) target)) (target ^. constructor)
        argsF <- typedArgs sig args
        pure $ CE t $ $(Quotation.quoteAction [|
                      \env -> do
          state@(runtime, caller) <- ask
          liftIO $ rtCreate runtime caller n ((\sf -> runReaderT (runCode sf env) state) <$> saltF) (runReaderT ((runCode argsF) env) state)
                      |])
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
      applyCall sc sig ($(Quotation.quoteAction [|
                        \_ -> do
        when hasParent $ chargeGas 1 >> chargeGas 1
        pure (linkWithCharge (not getter) sig efun)
                        |])) args

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
      [x] -> do f <- compileAs sc TBool x; pure $ CE TUnit ($(Quotation.quoteAction [|
                                                            \env -> (runCode f) env >>= \b -> unless b (revert nm)
                                                            |]))
      [x, m] -> do f <- compileAs sc TBool x; mf <- compileAs sc TStr m
                   pure $ CE TUnit ($(Quotation.quoteAction [|
                                    \env -> do b <- (runCode f) env; message <- (runCode mf) env; unless b (revert message)
                                    |]))
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
        TAddr -> pure $ CE TStr ($(Quotation.quoteAction [|
                                 fmap (T.pack . show) . (runCode f)
                                 |]))
        TInt -> pure $ CE TStr ($(Quotation.quoteAction [|
                                fmap (T.pack . show) . (runCode f)
                                |]))
        TBool -> pure $ CE TStr ($(Quotation.quoteAction [|
                                 fmap (\v -> if v then "true" else "false") . (runCode f)
                                 |]))
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
          ("address", TInt) -> pure (CE TAddr ($(Quotation.quoteAction [|
                                               fmap (Address . fromIntegral) . (runCode f)
                                               |])))
          ("int", TInt) -> pure (CE TInt f)
          ("int", TEnum _ _) -> pure (CE TInt ($(Quotation.quoteAction [|
                                               fmap enumNumber . (runCode f)
                                               |])))
          ("int", TAddr) -> pure (CE TInt ($(Quotation.quoteAction [|
                                           fmap (\(Address a) -> fromIntegral a) . (runCode f)
                                           |])))
          ("int", TBytes) -> pure (CE TInt ($(Quotation.quoteAction [|
                                            fmap (B.foldl' (\acc w -> acc * 256 + fromIntegral w) 0) . (runCode f)
                                            |])))
          ("bytes", TInt) -> pure (CE TBytes ($(Quotation.quoteAction [|
                                              fmap intToBytes32 . (runCode f)
                                              |])))
          ("bytes", TStr) -> pure (CE TBytes ($(Quotation.quoteAction [|
                                              fmap TE.encodeUtf8 . (runCode f)
                                              |])))
          ("bytes", TBytes) -> pure (CE TBytes f)
          ("bool", TBool) -> pure (CE TBool f)
          -- explicit conversion out of the dynamic world: checked once at runtime
          (_, TVariadic) -> do
            SomeTy target <- castTy k
            pure $ CE target $ $(Quotation.quoteAction [|
                               \env -> (runCode f) env >>= \case
              [d] -> fromDyn target d
              ds -> diverge ("converting " <> T.pack (show (length ds)) <> " dynamic values to " <> showTy target)
                               |])
          (_, TRaw) -> do
            SomeTy target <- castTy k
            pure $ CE target ($(Quotation.quoteAction [|
                              \env -> (runCode f) env >>= fromDyn target . Dyn TRaw
                              |]))
          _ -> typeErr ("cannot convert " <> showTy t <> " to " <> k)
      _ -> typeErr "conversion takes one argument"

    castTy :: T.Text -> C SomeTy
    castTy = \case
      "address" -> pure (SomeTy TAddr); "int" -> pure (SomeTy TInt); "bool" -> pure (SomeTy TBool)
      "decimal" -> pure (SomeTy TDecimal); "string" -> pure (SomeTy TStr); "bytes" -> pure (SomeTy TBytes); k -> unknown ("type " <> k)

    deriveCall target = do
      addressF <- compileAs sc TAddr target
      argsF <- dynArgs args
      pure $ CE TAddr $ $(Quotation.quoteAction [|
                        \env -> do
        ds <- (runCode argsF) env
        address <- (runCode addressF) env
        Builtins.derive address ds
                        |])

    builtinCall :: Ty t -> T.Text -> C (CE ls)
    builtinCall t name = do
      selected <- maybe (unknown ("builtin " <> name)) pure (Builtins.lookupAction name)
      let action = builtinCode name selected
          abiMember = case callee of S.MemberAccess _ (S.Variable _ "abi") _ -> True; _ -> False
      f <- dynArgs args
      pure $ CE t $ $(Quotation.quoteAction [|
                    \env -> do
        ds <- (runCode f) env
        when abiMember $ chargeGas 1 >> chargeGas 1
        runCode action ds >>= fromDyn t
                    |])

    lowLevel :: CallKind -> Expression -> C (CE ls)
    lowLevel kind target = do
      CE tt tf <- compileE sc target
      addrOf <- (case tt of
        TAddr -> pure tf
        TContract _ -> pure tf
        _ -> typeErr (".call on " <> showTy tt)) :: C (Code (Env ls -> M Address))
      (nameE, rest) <- case args of
        (x : xs) -> pure (x, xs)
        [] -> typeErr ".call needs a function name"
      CE nameTy nameF <- compileE sc nameE
      argsF <- dynArgs rest
      case nameTy of
        TStr -> pure $ CE TRaw $ $(Quotation.quoteAction [|
                                 \env -> do
          n <- (runCode nameF) env; ds <- (runCode argsF) env; a <- (runCode addrOf) env
          (r, f) <- ask
          liftIO (rtCall r kind f a n ds (Just (SomeTy TRaw)))
                                 |])
        _ -> pure $ CE TRaw $ $(Quotation.quoteAction [|
                              \env -> do
          n <- (runCode nameF) env; ds <- (runCode argsF) env; _ <- (runCode addrOf) env
          Builtins.invalidLowLevel (Dyn nameTy n : ds)
                              |])

    externalCall :: T.Text -> (Code (Env ls -> M Address)) -> T.Text -> C (CE ls)
    externalCall cn addrOf m = do
      target <- maybe (unknown ("contract " <> cn)) pure (M.lookup cn (cCC c ^. contracts))
      esig <- maybe (unknown ("function " <> cn <> "." <> key m)) pure (findSig (cSigs (mkCtx (cCC c) target)) m (length args))
      SomeSig sig <- esig
      argsF <- typedArgs sig args
      let r = sigRet sig
      pure $ CE r $ $(Quotation.quoteAction [|
                    \env -> do
        ds <- (runCode argsF) env; _ <- (runCode addrOf) env; a <- (runCode addrOf) env
        (rt', f) <- ask
        out <- liftIO (rtCall rt' Call f a m ds (Just (SomeTy r)))
        case r of
          TUnit -> pure ()
          TRaw -> pure out
          TVariadic -> pure out
          _ -> case out of
            [d] -> fromDyn r d
            _ -> fromDyn r (Dyn TVariadic out)
                    |])

    typedArgs :: Sig args r' -> [Expression] -> C (Code (Env ls -> M [Dyn]))
    typedArgs = compileTypedArgs sc

    dynArgs = compileDynArgs sc

compileTypedArgs :: Scope ls r -> Sig args r' -> [Expression] -> C (Code (Env ls -> M [Dyn]))
compileTypedArgs _ (SigNil _) [] = pure ($(Quotation.quoteAction [|
                                         \_ -> pure []
                                         |]))
compileTypedArgs sc (SigCons TVariadic (SigNil _)) xs | not (singleVariadic xs) = compileDynArgs sc xs
  where
    singleVariadic [x] = case compileE sc x of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
compileTypedArgs sc (SigCons t rest) (x : xs) = do
  f <- compileAs sc t x
  k <- compileTypedArgs sc rest xs
  pure ($(Quotation.quoteAction [|
        \env -> (:) <$> (Dyn t <$> (runCode f) env) <*> (runCode k) env
        |]))
compileTypedArgs _ _ _ = typeErr "argument count mismatch"

compileDynArgs :: Scope ls r -> [Expression] -> C (Code (Env ls -> M [Dyn]))
compileDynArgs sc [x] = do
  CE t f <- compileE sc x
  pure $ case t of
    TVariadic -> f
    TRaw -> $(Quotation.quoteAction [| \env -> runCode f env >>= \values -> pure $ case values of
      [Dyn TVariadic remaining] -> remaining
      _ -> [Dyn TRaw values] |])
    _ -> $(Quotation.quoteAction [| \env -> (: []) . Dyn t <$> runCode f env |])
compileDynArgs sc xs = do
  fs <- forM xs $ \x -> do CE t f <- compileE sc x; pure ($(Quotation.quoteAction [|
                                                          \env -> Dyn t <$> (runCode f) env
                                                          |]))
  pure $ $(Quotation.quoteAction [|
         \env -> mapM ($ env) (map runCode fs) >>= \values -> pure $ case reverse values of
    Dyn TVariadic remaining : rest -> reverse rest ++ remaining
    Dyn TRaw [Dyn TVariadic remaining] : rest -> reverse rest ++ remaining
    _ -> values
         |])

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
applyCall :: Scope ls r -> Sig args r' -> (Code (Env ls -> M (Fn args r'))) -> [Expression] -> C (CE ls)
applyCall sc sig mf expressions = do
  arguments <- callArguments sc sig expressions
  pure $ CE (sigRet sig) $ $(Quotation.quoteAction [|
                           \env -> do
    values <- (runCode arguments) env
    f <- (runCode mf) env
    apply sig f values
                           |])
callArguments :: Scope ls r -> Sig args r' -> [Expression] -> C (Code (Env ls -> M (HL args)))
callArguments _ (SigNil _) [] = pure ($(Quotation.quoteAction [|
                                      \_ -> pure HNil
                                      |]))
callArguments sc (SigCons TVariadic (SigNil _)) expressions
  | not (singleVariadic expressions) = do
      -- a trailing `variadic` parameter absorbs the remaining arguments
      arguments <- compileDynArgs sc expressions
      pure $ $(Quotation.quoteAction [|
             \env -> (:* HNil) <$> (runCode arguments) env
             |])
  where
    singleVariadic [expression] = case compileE sc expression of Right (CE TVariadic _) -> True; _ -> False
    singleVariadic _ = False
callArguments sc (SigCons t rest) (expression : expressions) = do
  value <- compileAs sc t expression
  remaining <- callArguments sc rest expressions
  pure $ $(Quotation.quoteAction [|
         \env -> (:*) <$> (runCode value) env <*> (runCode remaining) env
         |])
callArguments _ _ _ = typeErr "argument count mismatch"

-- Link a call site to the callee once; the signature was already checked against the AST,
-- so the mismatch branch is unreachable.  A callee that failed to compile throws when called.
link :: Sig args r -> C Fun -> Fn args r
link sig = linkWithCharge True sig

linkWithCharge :: Bool -> Sig args r -> C Fun -> Fn args r
linkWithCharge metered sig = \case
  Right (Fun n sig' f) | Just Refl <- sigEq sig sig' -> typedReturns sig (internalFrame n sig (if metered then chargeFunction sig (runCode f) else runCode f))
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
  let ordinary = do
        inner <- case (r, names) of
          -- a single named return value is a local initialised to its default
          (_, [rn]) | [_] <- f ^. funcVals -> do
            k <- withModifiers (pushVar rn r sc0) { sNamedRet = [rn] } (f ^. funcModifiers) body
            pure $ $(Quotation.quoteAction [|
                   \env -> do
              rr <- liftIO (newIORef (defaultOf r))
              (runCode k) (rr :& env) >>= \case
                Next -> Ret <$> liftIO (readIORef rr)
                flow -> pure flow
                   |])
          -- several named return values: locals, gathered by a bare `return`
          (TTuple fs, _ : _ : _) | length names == fieldsLen fs -> namedReturns sc0 fs names (f ^. funcModifiers) body
          _ -> withModifiers sc0 (f ^. funcModifiers) body
        let straightLine = null (f ^. funcModifiers) && null names && all simpleStatement body
            action = case sig of
              SigNil TUnit | straightLine -> $(Quotation.quoteAction [| void (runCode inner ENil) |])
              _ -> case r of
                TUnit | straightLine -> $(Quotation.quoteAction [| mkFn sig (\env -> void (runCode inner env)) |])
                _ -> $(Quotation.quoteAction [|
                  mkFn sig $ \env -> runCode inner env >>= \case
                    Ret v -> pure v
                    RetDynamic ds -> liftIO $ throwIO $ ForwardReturn ds
                    _ -> pure (defaultOf r) |])
            simpleStatement S.SimpleStatement{} = True
            simpleStatement _ = False
        pure action
  action <- case sig of
    SigNil TUnit | null (f ^. funcModifiers), null names,
      Just compiled <- compileLinearInteger c body -> pure compiled
    _ -> ordinary
  pure $ Fun name sig $ namedFunction (cName c <> "." <> name <> "/" <> T.pack (show (sigArity sig))) f action

-- Push each named return value as a local; `return;` reads them back as a tuple.
namedReturns :: forall ls ts. Scope ls (HL ts) -> Fields ts -> [T.Text] -> [(T.Text, [Expression])] -> [Statement] -> C (Code (Env ls -> M (Flow (HL ts))))
namedReturns sc0 fs0 names mods body = go sc0 fs0 names
  where
    go :: forall ls' us. Scope ls' (HL ts) -> Fields us -> [T.Text] -> C (Code (Env ls' -> M (Flow (HL ts))))
    go sc FNil [] = do
      k <- withModifiers sc { sNamedRet = names } mods body
      gather <- gatherNamed sc fs0 names
      pure $ $(Quotation.quoteAction [|
             \env -> (runCode k) env >>= \case
        Next -> Ret <$> (runCode gather) env
        flow -> pure flow
             |])
    go sc (FCons _ t rest) (n : ns) = do
      k <- go (pushVar n t sc) rest ns
      pure $ $(Quotation.quoteAction [|
             \env -> do rr <- liftIO (newIORef (defaultOf t)); (runCode k) (rr :& env)
             |])
    go _ _ _ = typeErr "named return arity"

-- Read the named return locals back into the tuple (used by a bare `return`).
gatherNamed :: Scope ls r -> Fields ts -> [T.Text] -> C (Code (Env ls -> M (HL ts)))
gatherNamed _ FNil [] = pure ($(Quotation.quoteAction [|
                              \_ -> pure HNil
                              |]))
gatherNamed sc (FCons _ t rest) (n : ns) = do
  case lookupVar sc n of
    Just (Var _ vt i) -> do
      Refl <- sameTy t vt
      k <- gatherNamed sc rest ns
      pure ($(Quotation.quoteAction [|
            \env -> (:*) <$> liftIO (readIORef (ref i env)) <*> (runCode k) env
            |]))
    _ -> unknown ("named return " <> n)
gatherNamed _ _ _ = typeErr "named return arity"

-- Modifiers apply left to right, the first being outermost.
withModifiers :: Scope ls r -> [(T.Text, [Expression])] -> [Statement] -> C (Code (Env ls -> M (Flow r)))
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
        CE _ call <- applyCall sc sig $(Quotation.quoteAction [| \_ -> pure $ link sig (Right fun) |]) margs
        pure $ $(Quotation.quoteAction [|
               \env -> (runCode call) env >> (runCode inner) env
               |])
    Nothing -> withModifier sc mn margs inner

withModifier :: forall ls r. Scope ls r -> T.Text -> [Expression] -> (Code (Env ls -> M (Flow r))) -> C (Code (Env ls -> M (Flow r)))
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
        { sInner = Just (typedBody (RefSlot (TMaybe TVariadic) : RefSlot (TMaybe r) : scopeTypes sc) r $(Quotation.quoteAction [| \e -> case e of (_ :& _ :& env) -> runCode inner env |])) }
  k <- withParams @_ @_ @(Flow r) sc1 params $ \sc2 -> do
    bodyK <- compileBlock sc2 mbody
    retSlot <- maybe (err Internal "lost $ret") pure (lookupVar sc2 "$ret")
    case retSlot of
      Var _ (TMaybe rt') ix -> do
        Refl <- sameTy r rt'
        case lookupVar sc2 "$rawRet" of
          Just (Var _ (TMaybe TVariadic) rawIx) -> pure $ $(Quotation.quoteAction [|
            \env -> runCode bodyK env >>= \case
              Ret v -> pure (Ret v)
              RetDynamic ds -> pure (RetDynamic ds)
              _ -> liftIO (readIORef (ref rawIx env)) >>= \case
                Just ds -> pure (RetDynamic ds)
                Nothing -> liftIO (readIORef (ref ix env)) >>= \case
                  Just v -> pure (Ret v)
                  Nothing -> pure Next |])
          _ -> pure $(Quotation.quoteAction [| \_ -> diverge "lost modifier dynamic return slot" |])
      _ -> err Internal "$ret has the wrong type"
  pure $ $(Quotation.quoteAction [|
         \env -> do
    slot <- liftIO (newIORef Nothing)
    rawSlot <- liftIO (newIORef Nothing)
    runCode k (rawSlot :& slot :& env)
         |])

-- Push a list of typed parameters (evaluated in the enclosing scope) and continue.
withParams :: forall ls r a. Scope ls r -> [(T.Text, SomeTy, Expression)] -> (forall ls'. Scope ls' r -> C (Code (Env ls' -> M a))) -> C (Code (Env ls -> M a))
withParams sc [] k = k sc
withParams sc ((n, SomeTy t, e) : ps) k = do
  ve <- compileAs sc t e
  rest <- withParams (pushVar n t sc) ps k
  pure $ $(Quotation.quoteAction [|
         \env -> do v <- (runCode ve) env; rr <- liftIO (newIORef v); (runCode rest) (rr :& env)
         |])

-- ---------------------------------------------------------------- statements

-- Straight-line scalar locals need values, not mutable references. Nested writes
-- and control flow retain the general local representation.
scalarLocal :: Ty t -> Bool
scalarLocal = \case
  TInt -> True; TDecimal -> True; TBool -> True; TAddr -> True
  TStr -> True; TBytes -> True; TEnum{} -> True; TContract{} -> True
  _ -> False

valueLocalTail :: Scope ls r -> T.Text -> [Statement] -> Bool
valueLocalTail sc name = all safeStatement
  where
    safeStatement (S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" lhs rhs)) _) =
      readOnly lhs && readOnly rhs && case lhs of
        S.Variable _ n | n == name -> case compileStorage sc rhs of Right _ -> False; _ -> True
        _ -> not (localDestination lhs)
    safeStatement (S.SimpleStatement (S.ExpressionStatement e) _) = readOnly e
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
compileLinearInteger :: CCtx -> [Statement] -> Maybe (Code (M ()))
compileLinearInteger c (S.SimpleStatement (S.VariableDefinition [S.VarDefEntry (Just ty) loc name _] (Just initial)) _ : rest) = do
  guard (loc /= Just S.Storage && name `notElem` ["this", "now"])
  guard $ case resolveTy c ty of Right (SomeTy TInt) -> True; _ -> False
  (IntegerLiteral value, units) <- integerAtom (Scope [] TUnit [] Nothing c) initial
  let charges = chargeUnits units
      initializer = $(Quotation.quoteAction [| chargeGas 1 >> runCode charges >> pure value |])
      sc = Scope [ValueVar name TInt IZ (Just value)] TUnit [] Nothing c
  case fusedIntegerSequence sc name value units rest of
    Just action -> Just action
    Nothing -> do
      (steps, final) <- commands sc rest
      pure (bindCodeChain name initializer steps final)
  where
    commands :: Scope '[Integer] () -> [Statement] -> Maybe ([Code (Integer -> M Integer)], Code (Integer -> M ()))
    commands _ [] = Just ([], $(Quotation.quoteAction [| \_ -> pure () |]))
    commands sc (S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ target) rhs)) _ : remaining)
      | target == name = do
          command <- linearIntegerExpression sc rhs (chargeUnits 2)
          let nextScope = sc { sVars = [ValueVar name TInt IZ (knownInteger sc rhs)] }
          (steps, final) <- commands nextScope remaining
          pure (command : steps, final)
      | Just (SScalar (SomeTy TInt)) <- M.lookup target (cStorage c) = do
          write <- linearIntegerWrite sc target rhs
          case remaining of
            [] -> Just ([], write)
            _ -> do
              (steps, final) <- commands sc remaining
              let command = $(Quotation.quoteAction [| \x -> runCode write x >> pure x |])
              pure (command : steps, final)
    commands _ _ = Nothing
compileLinearInteger _ _ = Nothing

linearIntegerExpression :: Scope '[Integer] () -> Expression -> Code (M ()) -> Maybe (Code (Integer -> M Integer))
linearIntegerExpression sc expression before = case integerAtom sc expression of
  Just (IntegerLiteral value, units) ->
    let charges = chargeUnits units in Just $(Quotation.quoteAction [|
      \_ -> runCode before >> runCode charges >> pure value |])
  Just (IntegerLocal, units) ->
    let charges = chargeUnits units in Just $(Quotation.quoteAction [|
      \x -> runCode before >> runCode charges >> pure x |])
  Nothing -> do
    (op, lhs, leftUnits, rhs, rightUnits, units) <- integerBinaryAtoms sc expression
    let leftCharges = chargeUnits leftUnits
        rightCharges = chargeUnits rightUnits
        charges = chargeUnits units
    case (lhs, rhs) of
      (IntegerLocal, IntegerLiteral b) -> $(Quotation.quoteIntegerExpression [| op |]
        [| \x -> runCode before >> runCode leftCharges >> pure x |]
        [| \_ -> runCode rightCharges >> pure b |]
        [| runCode charges |])
      (IntegerLiteral a, IntegerLocal) -> $(Quotation.quoteIntegerExpression [| op |]
        [| \_ -> runCode before >> runCode leftCharges >> pure a |]
        [| \x -> runCode rightCharges >> pure x |]
        [| runCode charges |])
      (IntegerLocal, IntegerLocal) -> $(Quotation.quoteIntegerExpression [| op |]
        [| \x -> runCode before >> runCode leftCharges >> pure x |]
        [| \x -> runCode rightCharges >> pure x |]
        [| runCode charges |])
      (IntegerLiteral a, IntegerLiteral b) -> $(Quotation.quoteIntegerExpression [| op |]
        [| \_ -> runCode before >> runCode leftCharges >> pure a |]
        [| \_ -> runCode rightCharges >> pure b |]
        [| runCode charges |])

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
fusedIntegerSequence :: Scope '[Integer] () -> T.Text -> Integer -> Int -> [Statement] -> Maybe (Code (M ()))
fusedIntegerSequence sc name value initialUnits
  [S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ assigned) expression)) _,
   S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ target) source)) _] = do
  guard (assigned == name && target /= name)
  guard $ case M.lookup target (cStorage (sC sc)) of Just (SScalar (SomeTy TInt)) -> True; _ -> False
  let nextScope = sc { sVars = [ValueVar name TInt IZ (knownInteger sc expression)] }
  (IntegerLocal, storeUnits) <- integerAtom nextScope source
  (op, lhs, leftUnits, rhs, rightUnits, units) <- integerBinaryAtoms sc expression
  case (lhs, rhs) of
    (IntegerLocal, IntegerLiteral b) -> $(Quotation.quoteIntegerSequence [| op |]
      [| chargeGas 1 >> replicateM_ initialUnits (chargeGas 1) >> pure value |]
      [| \x -> chargeGas 1 >> chargeGas 1 >> replicateM_ leftUnits (chargeGas 1) >> pure x |]
      [| \_ -> replicateM_ rightUnits (chargeGas 1) >> pure b |]
      [| replicateM_ units (chargeGas 1) |]
      [| \x -> do
        chargeGas 1
        chargeGas 1
        replicateM_ storeUnits (chargeGas 1)
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) x |])
    (IntegerLiteral a, IntegerLocal) -> $(Quotation.quoteIntegerSequence [| op |]
      [| chargeGas 1 >> replicateM_ initialUnits (chargeGas 1) >> pure value |]
      [| \_ -> chargeGas 1 >> chargeGas 1 >> replicateM_ leftUnits (chargeGas 1) >> pure a |]
      [| \x -> replicateM_ rightUnits (chargeGas 1) >> pure x |]
      [| replicateM_ units (chargeGas 1) |]
      [| \x -> do
        chargeGas 1
        chargeGas 1
        replicateM_ storeUnits (chargeGas 1)
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) x |])
    (IntegerLocal, IntegerLocal) -> $(Quotation.quoteIntegerSequence [| op |]
      [| chargeGas 1 >> replicateM_ initialUnits (chargeGas 1) >> pure value |]
      [| \x -> chargeGas 1 >> chargeGas 1 >> replicateM_ leftUnits (chargeGas 1) >> pure x |]
      [| \x -> replicateM_ rightUnits (chargeGas 1) >> pure x |]
      [| replicateM_ units (chargeGas 1) |]
      [| \x -> do
        chargeGas 1
        chargeGas 1
        replicateM_ storeUnits (chargeGas 1)
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) x |])
    (IntegerLiteral a, IntegerLiteral b) -> $(Quotation.quoteIntegerSequence [| op |]
      [| chargeGas 1 >> replicateM_ initialUnits (chargeGas 1) >> pure value |]
      [| \_ -> chargeGas 1 >> chargeGas 1 >> replicateM_ leftUnits (chargeGas 1) >> pure a |]
      [| \_ -> replicateM_ rightUnits (chargeGas 1) >> pure b |]
      [| replicateM_ units (chargeGas 1) |]
      [| \x -> do
        chargeGas 1
        chargeGas 1
        replicateM_ storeUnits (chargeGas 1)
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) x |])
fusedIntegerSequence _ _ _ _ _ = Nothing

linearIntegerWrite :: Scope '[Integer] () -> T.Text -> Expression -> Maybe (Code (Integer -> M ()))
linearIntegerWrite sc target rhs = do
  (source, units) <- integerAtom sc rhs
  let charges = chargeUnits units
  case source of
    IntegerLocal -> Just $(Quotation.quoteAction [|
      \x -> do
        chargeGas 1
        chargeGas 1
        runCode charges
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) x |])
    IntegerLiteral value -> Just $(Quotation.quoteAction [|
      \_ -> do
        chargeGas 1
        chargeGas 1
        runCode charges
        writeVal TInt (StoragePath [Field (TE.encodeUtf8 target)]) value |])

compileBlock :: Scope ls r -> [Statement] -> C (Code (Env ls -> M (Flow r)))
compileBlock sc body = typedBody (scopeTypes sc) (sRet sc) <$> compileBlockBody sc body

compileBlockBody :: Scope ls r -> [Statement] -> C (Code (Env ls -> M (Flow r)))
compileBlockBody _ [] = pure ($(Quotation.quoteAction [|
                          \_ -> pure Next
                          |]))
compileBlockBody sc statements@(_ : _) = compileBlockStatements sc statements

compileBlockStatements :: Scope ls r -> [Statement] -> C (Code (Env ls -> M (Flow r)))
compileBlockStatements _ [] = pure ($(Quotation.quoteAction [|
                                    \_ -> pure Next
                                    |]))
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
            pure $ $(Quotation.quoteBlockAction [|
                   \env -> do p <- (runCode pathOf) env; rr <- liftIO (newIORef (Left p)); (runCode k) (rr :& env)
                   |])
          _ -> do
            k <- compileBlock (pushVar n (TRef st) sc) rest
            pure $ $(Quotation.quoteBlockAction [|
                   \env -> do p <- (runCode pathOf) env; rr <- liftIO (newIORef p); (runCode k) (rr :& env)
                   |])
      else do
        SomeTy t <- resolveTy (sC sc) ty
        initF <- maybe (pure ($(Quotation.quoteAction [|
                              \_ -> pure (defaultOf t)
                              |]))) (compileAs sc t) mInit
        if scalarLocal t && valueLocalTail sc n rest
          then do
            let known = mInit >>= knownInteger sc
                sc' = Scope (ValueVar n t IZ known : map weaken (sVars sc)) (sRet sc) (sNamedRet sc)
                  (fmap (\f -> $(Quotation.quoteAction [| \e -> case e of (_ :& env) -> runCode f env |])) (sInner sc)) (sC sc)
            k <- compileBlock sc' rest
            pure $(Quotation.quoteBlockAction [|
              \env -> do value <- runCode initF env; runCode k (value :& env) |])
          else do
            k <- compileBlock (pushVar n t sc) rest
            pure $ $(Quotation.quoteBlockAction [|
                   \env -> do v <- (runCode initF) env; rr <- liftIO (newIORef v); (runCode k) (rr :& env)
                   |])
  S.SimpleStatement (S.VariableDefinition [S.VarDefEntry Nothing _ _ _] _) a -> atLine a (unsupported "untyped `var` declaration")
  S.SimpleStatement (S.VariableDefinition entries (Just initE)) a -> atLine a $ do
    -- (T1 a, T2 b) = rhs
    CE rt' rf <- compileE sc initE
    case rt' of
      TStruct _ fs -> do
        k <- destructure sc fs entries rest
        pure $ $(Quotation.quoteBlockAction [|
               \env -> (runCode rf) env >>= (runCode k) env
               |])
      TTuple fs -> do
        k <- destructure sc fs entries rest
        pure $ $(Quotation.quoteBlockAction [|
               \env -> (runCode rf) env >>= (runCode k) env
               |])
      TRaw -> do
        k <- destructureRaw sc entries rest
        pure $ $(Quotation.quoteBlockAction [|
               \env -> (runCode rf) env >>= (runCode k) env
               |])
      _ -> typeErr ("destructuring a non-tuple " <> showTy rt')
  S.SimpleStatement (S.VariableDefinition _ Nothing) a -> atLine a (typeErr "tuple declaration without an initialiser")
  S.SimpleStatement (S.ExpressionStatement (S.Binary _ "=" (S.Variable _ name) rhs)) a
    | Just (ValueVar _ t i _) <- lookupVar sc name -> atLine a $ do
        valueF <- compileAs sc t rhs
        let sc' = sc { sVars = updateKnown (sVars sc) }
            updateKnown (ValueVar n vt ix _ : vs) | n == name = ValueVar n vt ix (knownInteger sc rhs) : vs
            updateKnown (v : vs) = v : updateKnown vs
            updateKnown [] = []
        k <- compileBlock sc' rest
        case i of
          IZ -> pure $(Quotation.quoteBlockAction [|
            \env@(_ :& outer) -> do
              value <- charged 1 (runCode valueF env)
              runCode k (value :& outer) |])
          _ -> pure $(Quotation.quoteBlockAction [|
            \env -> do
              value <- charged 1 (runCode valueF env)
              runCode k (replaceValue i value env) |])
  S.SimpleStatement (S.ExpressionStatement e) a -> atLine a $ do
    CE _ action <- compileStatementExpression sc e
    case rest of
      [] -> pure $(Quotation.quoteBlockAction [| \env -> Next <$ runCode action env |])
      _ -> do
        k <- compileBlock sc rest
        pure $(Quotation.quoteBlockAction [| \env -> runCode action env >> runCode k env |])
  _ -> do
    sf <- compileStmt sc s
    k <- compileBlock sc rest
    pure $ $(Quotation.quoteBlockAction [|
           \env -> (runCode sf) env >>= \case
      Next -> (runCode k) env
      fl -> pure fl
           |])

implicitStorageAlias :: Scope ls r -> Maybe Expression -> Bool
implicitStorageAlias sc (Just expression) = case compileStorage sc expression of
  Right (SStruct{}, _) -> True
  Right (SArray{}, _) -> True
  Right (SMap{}, _) -> True
  _ -> False
implicitStorageAlias _ Nothing = False

-- Declare each tuple component as a typed local (blank entries are skipped), then continue.
destructure :: Scope ls r -> Fields ts -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> HL ts -> M (Flow r)))
destructure sc fs entries rest = typedDestructure (scopeTypes sc) fs (sRet sc) <$> destructureBody sc fs entries rest

destructureBody :: Scope ls r -> Fields ts -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> HL ts -> M (Flow r)))
destructureBody sc FNil [] rest = do k <- compileBlock sc rest; pure ($(Quotation.quoteAction [|
                                                                  \env _ -> (runCode k) env
                                                                  |]))
destructureBody sc (FCons _ t fs) (en : ens) rest = case en of
  S.BlankEntry -> do
    k <- destructure sc fs ens rest
    pure ($(Quotation.quoteAction [|
          \env hl -> case hl of (_ :* vs) -> (runCode k) env vs
          |]))
  S.VarDefEntry mty _ n _ -> do
    forM_ mty $ \ty -> do SomeTy dt <- resolveTy (sC sc) ty; void (sameTy dt t)
    k <- destructure (pushVar n t sc) fs ens rest
    pure ($(Quotation.quoteAction [|
          \env hl -> case hl of (v :* vs) -> do rr <- liftIO (newIORef v); (runCode k) (rr :& env) vs
          |]))
destructureBody _ _ _ _ = typeErr "destructuring arity mismatch"

-- Low-level results acquire their types at the destructuring boundary.
destructureRaw :: Scope ls r -> [VarDefEntry] -> [Statement] -> C (Code (Env ls -> [Dyn] -> M (Flow r)))
destructureRaw sc [] rest = do
  k <- compileBlock sc rest
  pure $ $(Quotation.quoteAction [|
         \env ds -> if null ds then (runCode k) env else revert "destructuring arity mismatch"
         |])
destructureRaw sc (S.BlankEntry : entries) rest = do
  k <- destructureRaw sc entries rest
  pure $ $(Quotation.quoteAction [|
         \env ds -> case ds of
    _ : values -> (runCode k) env values
    [] -> revert "destructuring arity mismatch"
         |])
destructureRaw sc (S.VarDefEntry (Just ty) _ name _ : entries) rest = do
  SomeTy t <- resolveTy (sC sc) ty
  k <- destructureRaw (pushVar name t sc) entries rest
  pure $ $(Quotation.quoteAction [|
         \env ds -> case ds of
    d : values -> do
      value <- fromDyn t d
      slot <- liftIO $ newIORef value
      (runCode k) (slot :& env) values
    [] -> revert "destructuring arity mismatch"
         |])
destructureRaw _ _ _ = unsupported "untyped raw result declaration"

compileStatementExpression :: Scope ls r -> Expression -> C (CE ls)
compileStatementExpression sc e = case e of
  S.Binary _ "=" l r -> case l of
    S.TupleExpression _ lhss -> compileTupleAssignment sc True lhss r
    S.Variable _ n | Just (Var _ (TRef _) _) <- lookupVar sc n -> do
      CE t action <- compileExpression sc False e
      pure (CE t ($(Quotation.quoteAction [|
                  charged 1 . (runCode action)
                  |])))
    S.Variable _ n | Just (Var _ (TAlias _ _) _) <- lookupVar sc n -> do
      CE t action <- compileExpression sc False e
      pure (CE t ($(Quotation.quoteAction [|
                  charged 1 . (runCode action)
                  |])))
    S.IndexAccess{} -> compileAssignment sc False True l r
    _ -> compileAssignment sc True True l r
  _ -> compileE sc e

compileStmt :: forall ls r. Scope ls r -> Statement -> C (Code (Env ls -> M (Flow r)))
compileStmt sc statement = typedBody (scopeTypes sc) (sRet sc) <$> compileStmtBody sc statement

compileStmtBody :: forall ls r. Scope ls r -> Statement -> C (Code (Env ls -> M (Flow r)))
compileStmtBody sc s = atLine (S.extractStatement s) $ case s of
  S.SimpleStatement (S.ExpressionStatement e) _ -> do
    CE _ f <- compileStatementExpression sc e
    pure $(Quotation.quoteAction [| \env -> Next <$ runCode f env |])
  S.SimpleStatement{} -> err Internal "declaration outside compileBlock"
  S.IfStatement cnd th mel _ -> do
    cf <- compileAs sc TBool cnd
    tf <- compileBlock sc th
    ef <- maybe (pure ($(Quotation.quoteAction [|
                       \_ -> pure Next
                       |]))) (compileBlock sc) mel
    pure $ $(Quotation.quoteAction [|
           \env -> (runCode cf) env >>= \b -> if b then (runCode tf) env else (runCode ef) env
           |])
  S.WhileStatement cnd body _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure $(Quotation.quoteAction [| loop (runCode cf) (runCode bf) (\_ -> pure ()) |])
  S.DoWhileStatement body cnd _ -> do
    cf <- compileAs sc TBool cnd
    bf <- compileBlock sc body
    pure $ $(Quotation.quoteAction [|
           \env -> let
      go = do
        result <- (runCode bf) env
        chargeGas 1
        case result of
          Brk -> pure Next
          Cnt -> go
          Next -> (runCode cf) env >>= \condition -> if condition then go else pure Next
          flow -> pure flow
      in go
           |])
  S.ForStatement mInit mCond mStep body a -> case mInit of
    Just (S.VariableDefinition [S.VarDefEntry (Just ty) _ n _] mInitE) -> atLine a $ do
      SomeTy t <- resolveTy (sC sc) ty
      initF <- maybe (pure ($(Quotation.quoteAction [|
                            \_ -> pure (defaultOf t)
                            |]))) (compileAs sc t) mInitE
      k <- forBody (pushVar n t sc)
      pure $ $(Quotation.quoteAction [|
             \env -> do v <- (runCode initF) env; rr <- liftIO (newIORef v); (runCode k) (rr :& env)
             |])
    Just (S.ExpressionStatement e) -> do
      CE _ f <- compileE sc e
      k <- forBody sc
      pure $ $(Quotation.quoteAction [|
             \env -> (runCode f) env >> (runCode k) env
             |])
    Nothing -> forBody sc
    Just _ -> unsupported "for-loop initialiser"
    where
      forBody :: forall ls'. Scope ls' r -> C (Code (Env ls' -> M (Flow r)))
      forBody sc' = do
        cf <- maybe (pure ($(Quotation.quoteAction [|
                           \_ -> charged 1 (pure True)
                           |]))) (compileAs sc' TBool) mCond
        stepF <- maybe (pure ($(Quotation.quoteAction [|
                              \_ -> chargeGas 1
                              |]))) (\e -> do CE _ f <- compileE sc' e; pure $(Quotation.quoteAction [|
                                                                             (void . (runCode f))
                                                                             |])) mStep
        bf <- compileBlock sc' body
        pure $(Quotation.quoteAction [| loop (runCode cf) (\env -> do result <- runCode bf env; runCode stepF env; pure result) (\_ -> pure ()) |])
  S.Block _ -> pure ($(Quotation.quoteAction [|
                     \_ -> pure Next
                     |]))
  S.Continue _ -> pure ($(Quotation.quoteAction [|
                        \_ -> pure Cnt
                        |]))
  S.Break _ -> pure ($(Quotation.quoteAction [|
                     \_ -> pure Brk
                     |]))
  S.Return Nothing _ -> case (sRet sc, sNamedRet sc) of
    (TUnit, _) -> pure ($(Quotation.quoteAction [|
                        \_ -> pure (Ret ())
                        |]))
    (r, [rn]) | Just (Var _ t i) <- lookupVar sc rn -> do
      Refl <- sameTy r t
      pure $ $(Quotation.quoteAction [|
             \env -> Ret <$> liftIO (readIORef (ref i env))
             |])
    (TTuple fs, names@(_ : _ : _)) -> do
      g <- gatherNamed sc fs names
      pure $ $(Quotation.quoteAction [|
             \env -> Ret <$> (runCode g) env
             |])
    (r, _) -> typeErr ("return without a value in a function returning " <> showTy r)
  S.Return (Just e) _ -> do
    case compileE sc e of
      Right (CE TRaw f) | isJust (tyEq (sRet sc) TRaw) || isJust (sInner sc) ->
        pure $ $(Quotation.quoteAction [|
               \env -> RetDynamic <$> (runCode f) env
               |])
      Right (CE TVariadic f) | isJust (sInner sc), isNothing (tyEq (sRet sc) TVariadic) ->
        pure $ $(Quotation.quoteAction [|
               \env -> (runCode f) env >>= \case
          ds@[Dyn TUnit ()] -> pure $ RetDynamic ds
          ds -> pure $ RetDynamic [Dyn TVariadic ds]
               |])
      _ -> do
        f <- compileAs sc (sRet sc) e
        pure $ $(Quotation.quoteAction [|
               \env -> Ret <$> (runCode f) env
               |])
  S.Throw _ _ -> pure ($(Quotation.quoteAction [|
                       \_ -> revert "throw"
                       |]))
  S.EmitStatement en args _ -> do
    ev <- maybe (unknown ("event " <> en)) pure (M.lookup en (cContract (sC sc) ^. events))
    let logs = ev ^. eventLogs
    when (length logs /= length args) $ typeErr ("event " <> en <> " argument count mismatch")
    fs <- forM (zip logs args) $ \(lg, (mn, e)) -> do
      when (maybe False (/= (lg ^. eventLogName)) mn) $ typeErr ("event argument name mismatch: " <> fromMaybe "" mn)
      SomeTy t <- resolveTy (sC sc) (indexedTypeType (lg ^. eventLogType))
      f <- compileAs sc t e
      let label = lg ^. eventLogName
      pure ($(Quotation.quoteAction [|
            \env -> (label,) . Dyn t <$> (runCode f) env
            |]))
    let cn = cName (sC sc)
    pure $ $(Quotation.quoteAction [|
           \env -> do
      vs <- mapM ($ env) (map runCode fs)
      (r, fr) <- ask
      liftIO (rtEmit r fr cn en vs)
      pure Next
           |])
  S.AssemblyStatement{} -> unsupported "inline assembly"
  S.RevertStatement mName args _ -> case (mName, args) of
    (Nothing, []) -> pure ($(Quotation.quoteAction [|
                           \_ -> revert ""
                           |]))
    (Nothing, [m]) -> do f <- compileAs sc TStr m; pure ($(Quotation.quoteAction [|
                                                         \env -> (runCode f) env >>= revert
                                                         |]))
    (Just n, _) -> do
      fs <- forM args $ \e -> do CE t f <- compileE sc e; pure ($(Quotation.quoteAction [|
                                                                \env -> Dyn t <$> (runCode f) env
                                                                |]))
      pure $ $(Quotation.quoteAction [|
             \env -> do vs <- mapM ($ env) (map runCode fs); revert (n <> "(" <> T.intercalate "," (map showDyn vs) <> ")")
             |])
    _ -> typeErr "revert takes at most one argument"
  S.UncheckedStatement body _ -> compileBlock sc body
  S.SolidityTryCatchStatement expression returnsDecl success handlers _ -> do
    CE t f <- compileE sc expression
    sf <- case returnsDecl of
      Nothing -> do k <- compileBlock sc success; pure ($(Quotation.quoteAction [|
                                                        \env _ -> (runCode k) env
                                                        |]))
      Just [(name, ty)] -> do
        SomeTy dt <- resolveTy (sC sc) ty
        Refl <- sameTy dt t
        k <- compileBlock (pushVar name t sc) success
        pure ($(Quotation.quoteAction [|
              \env value -> do rr <- liftIO (newIORef value); (runCode k) (rr :& env)
              |]))
      Just declarations -> case t of
        TTuple fs -> destructure sc fs [S.VarDefEntry (Just ty) Nothing name (S.extractStatement s) | (name, ty) <- declarations] success
        _ -> typeErr "try return declaration mismatch"
    hf <- case M.lookup "Nill" handlers of
      Just (Nothing, body) | M.size handlers == 1 -> compileBlock sc body
      _ -> unsupported "typed catch clauses"
    pure $ $(Quotation.quoteAction [|
           \env -> do
      value <- catchContractFailure (Right <$> (runCode f) env) (pure (Left ()))
      either (const ((runCode hf) env)) ((runCode sf) env) value
           |])
  S.TryCatchStatement body handlers _ -> do
    bf <- compileBlock sc body
    hf <- case M.toList handlers of
      [("", (Nothing, hs))] -> compileBlock sc hs
      [("", (Just _, _))] -> unsupported "catch with parameters"
      _ -> unsupported ("typed catch clauses " <> T.pack (show (M.keys handlers)))
    pure $ $(Quotation.quoteAction [|
           \env -> catchContractFailure ((runCode bf) env) ((runCode hf) env)
           |])
  S.ModifierExecutor _ -> case sInner sc of
    Just inner -> do
      let saveReturn = setRet sc
          saveRawReturn = setRawRet sc
      pure $ $(Quotation.quoteAction [|
                             \env -> (runCode inner) env >>= \case
          Ret v -> do
            -- stash in the innermost $ret slot and keep running the modifier
            runCode saveReturn env v
            pure Next
          RetDynamic ds -> do
            runCode saveRawReturn env (Just ds)
            pure Next
          fl -> pure fl
                         |])
    Nothing -> typeErr "`_` outside a modifier"
fieldsLen :: Fields ts -> Int
fieldsLen FNil = 0
fieldsLen (FCons _ _ rest) = 1 + fieldsLen rest

-- Write the function's return value into the modifier's hidden `$ret` slot.
setRet :: Scope ls r -> Code (Env ls -> r -> M ())
setRet sc = case lookupVar sc "$ret" of
  Just (Var _ (TMaybe t) i) | Just Refl <- tyEq t (sRet sc) ->
    let saveRawReturn = setRawRet sc in $(Quotation.quoteAction [| \env v -> do
      liftIO (writeIORef (ref i env) (Just v))
      runCode saveRawReturn env Nothing |])
  _ -> $(Quotation.quoteAction [| \_ _ -> diverge "internal: $ret slot missing" |])

setRawRet :: Scope ls r -> Code (Env ls -> Maybe [Dyn] -> M ())
setRawRet sc = case lookupVar sc "$rawRet" of
  Just (Var _ (TMaybe TVariadic) i) -> $(Quotation.quoteAction [| \env ds -> liftIO $ writeIORef (ref i env) ds |])
  _ -> $(Quotation.quoteAction [| \_ _ -> diverge "lost modifier dynamic return slot" |])

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

data Getter = forall args r. Getter (Sig args r) (Code (StoragePath -> Env (RefTypes args) -> M r))

getterEntry :: CCtx -> T.Text -> SType -> FunEntry
getterEntry c n st = FunEntry (fst <$> g) (snd <$> g)
  where
    g = inFun (cName c <> "." <> n) $ do
      Getter sig body <- build st
      pure (SomeSig sig, Fun n sig (namedCode (cName c <> "." <> n <> "/" <> T.pack (show (sigArity sig))) $(Quotation.quoteAction [|
                                    mkFn sig ((runCode body) (StoragePath [Field (TE.encodeUtf8 n)]))
                                    |])))
    build :: SType -> C Getter
    build (SMap (SomeTy k) v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons k sig) (typedGetter (SigCons k sig) $(Quotation.quoteAction [|
                                     \p env -> case env of (r :& env') -> do key <- liftIO (readIORef r); (runCode body) (snocP p (encodeKey k key)) env'
                                     |]))
    build (SArray v) = do
      Getter sig body <- build v
      pure $ Getter (SigCons TInt sig) (typedGetter (SigCons TInt sig) $(Quotation.quoteAction [|
                                        \p env -> case env of (r :& env') -> do i <- liftIO (readIORef r); (runCode body) (snocP p (Index (BC.pack (show i)))) env'
                                        |]))
    build (SStruct name fields) = do
      SomeTy ty <- stypeTy (SStruct name [(field, fieldTy) | (field, fieldTy) <- fields, scalarField fieldTy])
      case ty of
        TStruct _ fs -> do
          let t = TTuple fs
          pure $ Getter (SigNil t) (typedGetter (SigNil t) $(Quotation.quoteAction [|
                                    \p env -> case env of ENil -> readVal t p
                                    |]))
        _ -> err Internal "struct getter type"
    build leaf = do
      SomeTy t <- stypeTy leaf
      pure $ Getter (SigNil t) (typedGetter (SigNil t) $(Quotation.quoteAction [|
                                \p env -> case env of ENil -> readVal t p
                                |]))
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
        pure $(Quotation.quoteAction [|
             (void . (runCode action))
             |])
      pure $ $(Quotation.quoteAction [|
             \env -> mapM_ ($ env) (map runCode actions)
             |])
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
compileConstructorStage :: CCtx -> T.Text -> Ty a -> (forall ls. Scope ls a -> C (Code (Env ls -> M a))) -> C Fun
compileConstructorStage ctx name result compile = inFun (cName ctx <> "." <> name) $ do
  SomeSig original <- maybe (pure (SomeSig (SigNil TUnit))) (funSig ctx) (cContract ctx ^. constructor)
  let sig = replaceReturn original result
      names = maybe [] (map (fromMaybe "" . fst) . (^. funcArgs)) (cContract ctx ^. constructor)
      sc = paramScope ctx sig names
      outputSig = replaceReturn original TRaw
  action <- compile sc
  pure $ Fun name outputSig $ namedCode (cName ctx <> "." <> name <> "/" <> T.pack (show (sigArity outputSig))) $ $(Quotation.quoteAction [|
                              mkFn outputSig $ \env -> do
    value <- runCode action env
    updated <- snapshot sig env
    pure [Dyn TVariadic updated, Dyn result value]
                              |])
  where
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
