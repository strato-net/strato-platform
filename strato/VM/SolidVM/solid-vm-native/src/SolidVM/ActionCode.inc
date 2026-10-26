-- A compiler-only normal form for monadic composition. The executable builder
-- consumes it before returning an action; none of these nodes are interpreted
-- during contract execution.
data ActionStep = GasStep !Integer | forall a. EffectStep (Code (M a))
  | forall a. WriteStep (Ty a) (Code StoragePath) (Code a)

data ActionEnd a = KnownResult (Code a) | ResidualAction (Code (M a))

data Form a where
  Ordinary :: Form a
  IntegerValue :: Integer -> Form Integer
  UnitValue :: Form ()
  EmptyEnvironment :: Form (Env '[])
  ValueEnvironment :: Code a -> Code (Env ls) -> Form (Env (a ': ls))
  HListValue :: Code a -> Code (HL ls) -> Form (HL (a ': ls))
  ConstantFunction :: Code b -> Form (a -> b)
  StaticFunction :: Form (a -> b) -> (Code a -> Code b) -> Form (a -> b)
  ActionFunction :: Monad m => Code (Action env m a) -> Form (env -> m a)
  PureComputation :: Code a -> Form (Action env m a)
  LiftedComputation :: Code (m a) -> Form (Action env m a)
  FunctionSequence :: [FunctionStep env] -> FunctionEnd env a -> Form (env -> M a)
  PureAction :: Code a -> Form (m a)
  ActionSequence :: [ActionStep] -> ActionEnd a -> Form (M a)

buildAction :: [ActionStep] -> ActionEnd a -> Code (M a)
buildAction = emitAction

actionParts :: Code (M a) -> ([ActionStep], ActionEnd a)
actionParts code = case codeForm code of
  PureAction value -> ([], KnownResult value)
  ActionSequence steps end -> (steps, end)
  _ -> ([], ResidualAction code)

knownAction :: Code (M a) -> Maybe (Code (M ()), Code a)
knownAction code = case actionParts code of
  (steps, KnownResult value) -> Just (buildAction steps (KnownResult unitCode), value)
  _ -> Nothing

gasOnlyAction :: Code (M a) -> Maybe (Code Integer, Code a)
gasOnlyAction code = case actionParts code of
  (steps, KnownResult value) -> do
    costs <- traverse gasCost steps
    pure (integerCode (sum costs), value)
  _ -> Nothing
  where
    gasCost (GasStep gas) = Just gas
    gasCost _ = Nothing

sequenceCodeActions :: [Code (M a)] -> Code (M [a])
sequenceCodeActions codes = case traverse knownAction codes of
  Just results -> foldr thenAction (pureAction (listCode (map snd results))) (map fst results)
  Nothing -> sequenceResidual codes

traverseApply :: [Code (a -> M b)] -> Code a -> Code (M [b])
traverseApply functions argument = sequenceCodeActions (map (`applyCode` argument) functions)

thenAction :: Code (M a) -> Code (M b) -> Code (M b)
thenAction first second = buildAction (joinSteps before after) end
  where
    (steps, firstEnd) = actionParts first
    before = case firstEnd of
      KnownResult _ -> steps
      ResidualAction code -> joinSteps steps [EffectStep code]
    (after, end) = actionParts second

beforeAction :: Integer -> Code (M a) -> Code (M a)
beforeAction gas code = buildAction (joinSteps [GasStep gas] steps) end
  where (steps, end) = actionParts code

afterAction :: Integer -> Code (M a) -> Code (M a)
afterAction gas code = case actionParts code of
  (steps, KnownResult value) -> buildAction (joinSteps steps [GasStep gas]) (KnownResult value)
  _ -> afterResidual gas code

gasAction :: Integer -> Code (M ())
gasAction gas = buildAction [GasStep gas] (KnownResult unitCode)

writeAction :: Ty a -> Code StoragePath -> Code a -> Code (M ())
writeAction ty path value = buildAction [WriteStep ty path value] (KnownResult unitCode)

joinSteps :: [ActionStep] -> [ActionStep] -> [ActionStep]
joinSteps [] right = right
joinSteps [GasStep left] (GasStep right : rest) = GasStep (left + right) : rest
joinSteps (step : rest) right = step : joinSteps rest right

applyCode :: Code (a -> b) -> Code a -> Code b
applyCode function argument = case codeForm function of
  ConstantFunction body -> body
  StaticFunction _ specialize -> specialize argument
  _ -> applyResidual function argument

composedAction :: Monad m => Code (env -> m a) -> Code (Action env m a)
composedAction code = actionProgram $ case actionForm (codeForm code) of
  Just action -> action
  Nothing -> case constantBody code of
    Just action -> actionLift action
    Nothing -> actionResidual code
  where
    actionForm :: Form (env -> m a) -> Maybe (Code (Action env m a))
    actionForm (ActionFunction action) = Just action
    actionForm (StaticFunction previous _) = actionForm previous
    actionForm (FunctionSequence steps end) = Just (functionAction steps end)
    actionForm _ = Nothing

actionLift :: Monad m => Code (m a) -> Code (Action env m a)
actionLift code = actionProgram $ case codeForm code of
  PureAction value -> actionReturn value
  ActionSequence steps (KnownResult value) | UnitValue <- codeForm value -> unitActionSteps steps
  ActionSequence steps end -> foldr lower final steps
    where
      final = case end of
        KnownResult value -> actionReturn value
        ResidualAction action -> actionLift action
      lower (GasStep gas) rest = actionThen (actionCharge gas) rest
      lower (EffectStep action) rest = actionThen (actionLift action) rest
      lower (WriteStep ty path value) rest = actionThen (actionStore ty path value) rest
  _ -> actionLiftResidual code

unitActionSteps :: [ActionStep] -> Code (Action env M ())
unitActionSteps [] = actionReturn unitCode
unitActionSteps [GasStep gas] = actionCharge gas
unitActionSteps [WriteStep ty path value] = actionStore ty path value
unitActionSteps (step : steps) = case step of
  GasStep gas -> actionThen (actionCharge gas) rest
  EffectStep action -> actionThen (actionLift action) rest
  WriteStep ty path value -> actionThen (actionStore ty path value) rest
  where rest = unitActionSteps steps

actionThen :: Code (Action env M a) -> Code (Action env M b) -> Code (Action env M b)
actionThen first second = case codeForm first of
  PureComputation _ -> second
  _ -> actionThenResidual first second

bindAction :: Code (M a) -> Code (a -> M b) -> Code (M b)
bindAction first continuation = case knownAction first of
  Just (effects, value) -> thenAction effects (applyCode continuation value)
  Nothing -> case codeForm continuation of
    ConstantFunction result -> thenAction first result
    _ -> bindResidual first continuation

mapAction :: Code (a -> b) -> Code (M a) -> Code (M b)
mapAction function action = case knownAction action of
  Just (effects, value) -> thenAction effects (pureAction (applyCode function value))
  Nothing -> mapResidual function action

applyAction :: Code (M (a -> b)) -> Code (M a) -> Code (M b)
applyAction function action = case knownAction function of
  Just (effects, value) -> thenAction effects (mapAction value action)
  Nothing -> applyActionResidual function action

localCode :: Ix ls a -> Code (Env ls) -> Code a
localCode IZ code | ValueEnvironment value _ <- codeForm code = value
localCode (IS index) code | ValueEnvironment _ rest <- codeForm code = localCode index rest
localCode index code = localResidual index code

valueFunction :: Ix ls a -> Code (Env ls -> M a)
valueFunction index = staticFunction (actionFunction (valueAction index))
  (pureAction . localCode index)

-- The same sequence normal form lifted over a runtime argument. Function
-- boundaries which introduce variables or control flow remain residual calls.
data FunctionStep env = FunctionGas !Integer | forall a. FunctionEffect (Code (env -> M a))
  | forall a. FunctionWrite (Ty a) (Code (env -> StoragePath)) (Code (env -> a))
data FunctionEnd env a = PureFunction (Code (env -> a)) | ResidualFunction (Code (env -> M a))

functionAction :: [FunctionStep env] -> FunctionEnd env a -> Code (Action env M a)
functionAction steps end = foldr lower final steps
  where
    final = case end of
      PureFunction function -> actionPure function
      ResidualFunction function -> composedAction function
    lower (FunctionGas gas) rest = actionThen (actionCharge gas) rest
    lower (FunctionEffect function) rest = actionThen (composedAction function) rest
    lower (FunctionWrite ty path value) rest = actionThen (actionWrite ty path value) rest

constantBody :: Code (a -> b) -> Maybe (Code b)
constantBody = constantForm . codeForm
  where
    constantForm :: Form (a -> b) -> Maybe (Code b)
    constantForm (ConstantFunction body) = Just body
    constantForm (StaticFunction previous _) = constantForm previous
    constantForm (ActionFunction action) = case codeForm action of
      PureComputation value -> Just (pureAction value)
      LiftedComputation value -> Just value
      _ -> Nothing
    constantForm _ = Nothing

functionParts :: Code (env -> M a) -> ([FunctionStep env], FunctionEnd env a)
functionParts code = parts (codeForm code)
  where
    parts (StaticFunction previous _) = parts previous
    parts (FunctionSequence steps end) = (steps, end)
    parts (ConstantFunction action) =
      let (steps, end) = actionParts action
          liftStep (GasStep gas) = FunctionGas gas
          liftStep (EffectStep value) = FunctionEffect (constantFunction value)
          liftStep (WriteStep ty path value) = FunctionWrite ty (constantFunction path) (constantFunction value)
       in (map liftStep steps, case end of
            KnownResult value -> PureFunction (constantFunction value)
            ResidualAction value -> ResidualFunction (constantFunction value))
    parts _ = ([], ResidualFunction code)

buildFunction :: [FunctionStep env] -> FunctionEnd env a -> Code (env -> M a)
buildFunction steps end = case (traverse staticStep steps, staticEnd end) of
  (Just actions, Just result) -> constantFunction (buildAction (foldr joinSteps [] actions) result)
  _ -> emitFunction steps end
  where
    staticStep (FunctionGas gas) = Just [GasStep gas]
    staticStep (FunctionEffect function) = do
      action <- constantBody function
      let (before, final) = actionParts action
      pure $ case final of KnownResult _ -> before; ResidualAction residual -> before ++ [EffectStep residual]
    staticStep (FunctionWrite ty path value) = do
      p <- constantBody path
      v <- constantBody value
      pure [WriteStep ty p v]
    staticEnd (PureFunction function) = KnownResult <$> constantBody function
    staticEnd (ResidualFunction function) = ResidualAction <$> constantBody function

functionPure :: Code (env -> a) -> Code (env -> M a)
functionPure = buildFunction [] . PureFunction

functionThen :: Code (env -> M a) -> Code (env -> M b) -> Code (env -> M b)
functionThen first second = staticFunction (buildFunction (joinFunctions before after) end)
  (\environment -> thenAction (applyCode first environment) (applyCode second environment))
  where
    (steps, firstEnd) = functionParts first
    before = case firstEnd of PureFunction _ -> steps; ResidualFunction residual -> steps ++ [FunctionEffect residual]
    (after, end) = functionParts second

functionBefore :: Integer -> Code (env -> M a) -> Code (env -> M a)
functionBefore gas code = staticFunction (buildFunction (joinFunctions [FunctionGas gas] steps) end)
  (\environment -> beforeAction gas (applyCode code environment))
  where (steps, end) = functionParts code

functionAfter :: Integer -> Code (env -> M a) -> Code (env -> M a)
functionAfter gas code = staticFunction residual (\environment -> afterAction gas (applyCode code environment))
  where
    residual = case functionParts code of
      (steps, PureFunction value) -> buildFunction (joinFunctions steps [FunctionGas gas]) (PureFunction value)
      _ -> actionFunction (actionAfter gas (composedAction code))

functionWrite :: Ty a -> Code (env -> StoragePath) -> Code (env -> a) -> Code (env -> M ())
functionWrite ty path value = staticFunction
  (buildFunction [FunctionWrite ty path value] (PureFunction (constantFunction unitCode)))
  (\environment -> writeAction ty (applyCode path environment) (applyCode value environment))

joinFunctions :: [FunctionStep env] -> [FunctionStep env] -> [FunctionStep env]
joinFunctions [] right = right
joinFunctions [FunctionGas left] (FunctionGas right : rest) = FunctionGas (left + right) : rest
joinFunctions (step : rest) right = step : joinFunctions rest right

hlistFunction :: Code (a -> HL ls -> HL (a ': ls))
hlistFunction = staticFunction hlistConstructor $ \a ->
  staticFunction (applyResidual hlistConstructor a) (hlistCode a)

writePrimitive :: Ty a -> Code (StoragePath -> a -> M ())
writePrimitive ty = staticFunction (writePrimitiveResidual ty) (writeFunction ty)

writeFunction :: Ty a -> Code StoragePath -> Code (a -> M ())
writeFunction ty path = staticFunction (writeFunctionResidual ty path) (writeAction ty path)

replaceCode :: Ix ls a -> Code a -> Code (Env ls) -> Code (Env ls)
replaceCode IZ value code | ValueEnvironment _ rest <- codeForm code = valueEnvironment value rest
replaceCode (IS index) value code | ValueEnvironment first rest <- codeForm code =
  valueEnvironment first (replaceCode index value rest)
replaceCode index value code = replaceResidual index value code

-- Backend-independent decisions. The two builders only emit the selected form.
staticFunction :: Code (a -> b) -> (Code a -> Code b) -> Code (a -> b)
staticFunction code specialize = case constantBody code of
  Just body -> constantFunction body
  Nothing -> withForm (StaticFunction (codeForm code) specialize) code

actionPure :: Code (env -> a) -> Code (Action env M a)
actionPure code = case constantBody code of
  Just value -> actionReturn value
  Nothing -> actionPureResidual code

actionWrite :: Ty a -> Code (env -> StoragePath) -> Code (env -> a) -> Code (Action env M ())
actionWrite ty path value = case (constantBody path, constantBody value) of
  (Just p, Just v) -> actionStore ty p v
  (Just p, Nothing) -> actionWritePath ty p value
  (Nothing, Just v) -> actionWriteValue ty path v
  (Nothing, Nothing) -> actionWriteResidual ty path value

emitAction :: [ActionStep] -> ActionEnd a -> Code (M a)
emitAction [] (KnownResult value) = pureAction value
emitAction [] (ResidualAction action) = action
emitAction steps end = withForm (ActionSequence steps end) $ case end of
  KnownResult value | UnitValue <- codeForm value -> emitUnitSteps steps
  KnownResult value -> case steps of
    [GasStep gas] -> emitGasResult gas value
    _ -> emitResultSteps steps value
  ResidualAction final -> emitResidualSteps steps final

bindCodeChain :: T.Text -> Code (M a) -> [Code (a -> M a)] -> Code (a -> M b) -> Code (M b)
bindCodeChain name initial commands final = case knownAction initial of
  Just (effects, value) -> case commands of
    [] -> thenAction effects (applyCode final value)
    command : rest -> thenAction effects (bindCodeChain name (applyCode command value) rest final)
  Nothing -> bindChainResidual name initial commands final
{-# INLINE bindCodeChain #-}

-- Typed primitive references: neither backend decides how an operation behaves.
data Primitive a where
  IdentityPrimitive :: Primitive (a -> a)
  ReturnPrimitive :: Primitive (a -> Core.Flow a)
  DynamicReturnPrimitive :: Primitive ([Core.Dyn] -> Core.Flow a)
  NotPrimitive :: Primitive (Bool -> Bool)
  EqualPrimitive :: Eq a => Primitive (a -> a -> Bool)
  LessPrimitive :: Ord a => Primitive (a -> a -> Bool)
  GreaterPrimitive :: Ord a => Primitive (a -> a -> Bool)
  LessEqualPrimitive :: Ord a => Primitive (a -> a -> Bool)
  GreaterEqualPrimitive :: Ord a => Primitive (a -> a -> Bool)
  HNilPrimitive :: Primitive (HL '[])
  NextPrimitive :: Primitive (Core.Flow r)
  BreakPrimitive :: Primitive (Core.Flow r)
  ContinuePrimitive :: Primitive (Core.Flow r)
  EmptyListPrimitive :: Primitive [a]
  FromIntegerPrimitive :: Primitive (Integer -> Decimal)
  FromListPrimitive :: Primitive ([a] -> Data.Sequence.Seq a)
  DynPrimitive :: Ty a -> Primitive (a -> Core.Dyn)
  RetDynPrimitive :: Ty a -> Primitive (a -> [Core.Dyn])
  ApplyLastPrimitive :: Primitive (M r -> HL '[] -> M r)

functionMap :: Code (a -> b) -> Code (env -> M a) -> Code (env -> M b)
functionMap function action = staticFunction
  (actionFunction (mapComputation function (composedAction action)))
  (\environment -> mapAction function (applyCode action environment))

functionApply :: Code (env -> M (a -> b)) -> Code (env -> M a) -> Code (env -> M b)
functionApply function action = staticFunction
  (actionFunction (applyComputation (composedAction function) (composedAction action)))
  (\environment -> applyAction (applyCode function environment) (applyCode action environment))

functionPair :: Code (a -> b -> c) -> Code (env -> M a) -> Code (env -> M b) -> Code (env -> M c)
functionPair function first second = functionApply (functionMap function first) second

functionTraverse :: [Code (env -> M a)] -> Code (env -> M [a])
functionTraverse functions = staticFunction (traverseFunctionResidual functions)
  (traverseApply functions)

extendValueFunction :: Code (Env (a ': ls) -> b) -> Code (Env ls -> a -> b)
extendValueFunction function | Just body <- constantBody function = constantFunction (constantFunction body)
extendValueFunction function = staticFunction residual $ \environment ->
  staticFunction (extendValueAt environment function) $ \value ->
    applyCode function (valueEnvironment value environment)
  where residual = extendValueResidual function

dropEnvironment :: Code (Env ls -> b) -> Code (Env (a ': ls) -> b)
dropEnvironment function = staticFunction residual $ \environment -> case codeForm environment of
  ValueEnvironment _ rest -> applyCode function rest
  _ -> applyResidual residual environment
  where residual = dropEnvironmentResidual function

bindEnvironment :: Code (Env ls -> M a) -> Code (Env (a ': ls) -> M b) -> Code (Env ls -> M b)
bindEnvironment initial next = staticFunction (bindEnvironmentResidual initial next) $ \environment ->
  bindAction (applyCode initial environment) (applyCode (extendValueFunction next) environment)

functionBind :: Code (env -> M a) -> Code (env -> a -> M b) -> Code (env -> M b)
functionBind first next = staticFunction (functionBindResidual first next) $ \environment ->
  bindAction (applyCode first environment) (applyCode next environment)

identityFunction :: Code (a -> a)
identityFunction = staticFunction (primitiveCode IdentityPrimitive) id
