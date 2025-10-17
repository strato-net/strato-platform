{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions
  ( detector,
  )
where

import Control.Monad.Reader
import Control.Monad.Trans.State
import Data.Foldable (traverse_)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, isJust)
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.StaticAnalysis.Types

data R = R
  { mutability :: Maybe StateMutability,
    stateVars :: M.Map SolidString VariableDecl,
    codeCollection :: CodeCollection,
    contract :: Contract
  }

type SSS = StateT [M.Map SolidString (SourceAnnotation ())] (Reader R)

detector :: CompilerDetector
detector cc@CodeCollection {..} = concat $ contractHelper cc <$> M.elems _contracts

contractHelper :: CodeCollection -> Contract -> [SourceAnnotation Text]
contractHelper cc c@Contract {..} =
  let constr = maybe M.empty (M.singleton "constructor") _constructor
      funcsAndConstr = constr <> _functions
   in functionHelper cc c _storageDefs =<< M.elems funcsAndConstr

functionHelper :: CodeCollection -> Contract -> M.Map SolidString VariableDecl -> Func -> [SourceAnnotation Text]
functionHelper cc c stateVariables Func {..} = case _funcContents of
  Nothing -> []
  Just stmts ->
    let r = R _funcStateMutability stateVariables cc c
        argNames = catMaybes $ fst <$> _funcArgs
        valNames = catMaybes $ fst <$> _funcVals
        names = M.fromList $ zip (argNames ++ valNames) (repeat _funcContext)
     in runReader (statementsHelper names stmts) r

statementsHelper ::
  (M.Map SolidString (SourceAnnotation ())) ->
  [Statement] ->
  Reader R [SourceAnnotation Text]
statementsHelper args ss = concat <$> evalStateT (traverse statementHelper ss) [args]

statementsHelper' :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper' ss = do
  modify (M.empty :)
  anns <- concat <$> traverse statementHelper ss
  modify $ \case
    [] -> []
    (_:xs) -> xs
  pure anns

isLocalVariable :: SolidString -> SSS Bool
isLocalVariable name = foldr lookupVar False <$> get
  where
    lookupVar _ True = True
    lookupVar m _ = isJust $ M.lookup name m

pushLocalVariable :: SolidString -> SourceAnnotation () -> SSS ()
pushLocalVariable name decl = modify $ \case
  [] -> error "This can't happen by the laws of physics"
  (x : xs) -> (M.insert name decl x) : xs

pushLocalVariables :: [VarDefEntry] -> SSS ()
pushLocalVariables = traverse_ pushEntry
  where
    pushEntry BlankEntry = pure ()
    pushEntry VarDefEntry {..} = pushLocalVariable vardefName vardefContext

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) = do
  cs <- expressionHelper cond
  ts <- statementsHelper' thens
  es <- maybe (pure []) statementsHelper' mElse
  pure $ concat [cs, ts, es]
statementHelper (TryCatchStatement try catchMap _) = do
  ts <- statementsHelper' try
  cs <- statementsHelper' (concatMap (snd . snd) (M.toList catchMap))
  pure $ concat [ts, cs]
statementHelper (SolidityTryCatchStatement expr _ successStatements catchMap _) = do
  cs <- expressionHelper expr
  ts <- statementsHelper' successStatements
  es <- statementsHelper' (concatMap (snd . snd) (M.toList catchMap))
  pure $ concat [cs, ts, es]
statementHelper (WhileStatement cond body _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  pure $ concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  cs <- maybe (pure []) expressionHelper mCond
  ps <- maybe (pure []) expressionHelper mPost
  bs <- statementsHelper' body
  pure $ concat [is, cs, ps, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body cond _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  pure $ concat [bs, cs]
statementHelper (Continue _) = pure []
statementHelper (ModifierExecutor _) = pure []
statementHelper (Break _) = pure []
statementHelper (Return mExpr _) =
  maybe (pure []) expressionHelper mExpr
statementHelper (Throw e _) =
  expressionHelper e
statementHelper (EmitStatement _ vals _) =
  concat <$> traverse (expressionHelper . snd) vals
statementHelper (RevertStatement _ vals _) =
  concat <$> traverse expressionHelper vals
statementHelper (UncheckedStatement body _) =
  statementsHelper' body
statementHelper (AssemblyStatement _ x) =
  asks mutability >>= \case
    Nothing -> pure []
    Just Payable -> pure []
    mut ->
      let msg =
            T.pack $
              concat
                [ show mut,
                  " function using assembly code."
                ]
       in pure [msg <$ x]
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  maybe (pure []) expressionHelper mExpr
simpleStatementHelper (ExpressionStatement expr) =
  expressionHelper expr

localVarReadHelper :: SolidString -> SourceAnnotation () -> SSS [SourceAnnotation Text]
localVarReadHelper name x = do
  isLocal <- isLocalVariable name
  if isLocal
    then pure []
    else do
      ~R {..} <- ask
      case M.lookup name stateVars of
        Nothing -> pure [] -- handled by the typechecker
        Just _ -> case mutability of
          Just Pure ->
            let msg =
                  T.concat
                    [ "Pure function reading state variable ",
                      labelToText name
                    ]
             in pure [msg <$ x]
          _ -> pure []

localVarWriteHelper :: SolidString -> SourceAnnotation () -> SSS [SourceAnnotation Text]
localVarWriteHelper name x = do
  isLocal <- isLocalVariable name
  if isLocal
    then pure []
    else do
      ~R {..} <- ask
      case M.lookup name stateVars of
        Nothing -> pure [] -- handled by the typechecker
        Just _ -> case mutability of
          Nothing -> pure []
          Just Payable -> pure []
          Just mut ->
            let msg =
                  T.concat
                    [ T.pack $ show mut,
                      " function mutating state variable ",
                      labelToText name
                    ]
             in pure [msg <$ x]

expressionHelper :: Expression -> SSS [SourceAnnotation Text]
expressionHelper (Binary y "=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "+=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "-=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "*=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "/=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "%=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "|=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y ">>>=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y ">>=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "<<=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "&=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "^=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary _ _ a b) =
  concat <$> traverse expressionHelper [a, b]
expressionHelper (PlusPlus y (Variable x name)) =
  localVarWriteHelper name (x <> y)
expressionHelper (PlusPlus _ e) = expressionHelper e
expressionHelper (MinusMinus y (Variable x name)) =
  localVarWriteHelper name (x <> y)
expressionHelper (MinusMinus _ e) = expressionHelper e
expressionHelper (NewExpression _ _) = pure []
expressionHelper (IndexAccess _ a b) = do
  as <- expressionHelper a
  bs <- maybe (pure []) expressionHelper b
  pure $ concat [as, bs]
expressionHelper (MemberAccess _ e _) = expressionHelper e
expressionHelper (FunctionCall _ e args) = do
  as <- case e of
    Variable _ _ -> pure []
    _ -> expressionHelper e
  bs <- concat <$> traverse expressionHelper args
  pure $ concat [as, bs]
expressionHelper (Unitary _ _ a) = expressionHelper a
expressionHelper (Ternary _ a b c) = concat <$> traverse expressionHelper [a, b, c]
expressionHelper (BoolLiteral _ _) = pure []
expressionHelper (NumberLiteral _ _ _) = pure []
expressionHelper (DecimalLiteral _ _) = pure []
expressionHelper (StringLiteral _ _) = pure []
expressionHelper (AccountLiteral _ _) = pure []
expressionHelper (TupleExpression _ es) =
  concat <$> traverse (maybe (pure []) expressionHelper) es
expressionHelper (ArrayExpression _ es) = concat <$> traverse expressionHelper es
expressionHelper (Variable x name) =
  localVarReadHelper name x
expressionHelper (ObjectLiteral _ _) = pure []
expressionHelper (HexaLiteral _ _) = pure []
expressionHelper (InlineBoundsCheck _ _ _ _) = pure []
