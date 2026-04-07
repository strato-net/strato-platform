{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TupleSections #-}

module SolidVM.Solidity.StaticAnalysis.Variables.StateVariables
  ( detector,
  )
where

import Control.Lens
import Control.Monad (unless)
import Control.Monad.State
import Data.Foldable (traverse_)
import qualified Data.Map.Strict as M
import Data.Maybe (isJust, maybeToList)
import Data.Source
import Data.Text (Text)
import Data.Traversable (for)
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.StaticAnalysis.Types

type StateVars = M.Map SolidString (Bool, Bool, VariableDecl)

type LocalVars = [M.Map SolidString (SourceAnnotation ())]

type SSS = State (StateVars, LocalVars, Contract)

detector :: CompilerDetector
detector CodeCollection {..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper c@Contract {..} =
  let stateVariables = M.map (False,False,) _storageDefs
      emptyState = (stateVariables, [], c)
      action = traverse functionHelper $ maybeToList _constructor ++ M.elems _functions
      stateVariables' = (\(a,_,_) -> a) $ execState action emptyState
      findStateAnns name (False, False, a) =
        [("Unused state variable " <> labelToText name <> ".") <$ _varContext a]
      findStateAnns name (True, False, VariableDecl {..}) | _varInitialVal == Nothing = case _varType of
        SVMType.Struct {} -> []
        SVMType.Array _ Nothing -> []
        SVMType.Mapping {} -> []
        _ -> [("Uninitialized state variable " <> labelToText name <> ". Consider initializing it to prevent incorrect behavior.") <$ _varContext]
      findStateAnns name (True, False, a) = case _varType a of
        SVMType.Struct {} -> []
        SVMType.Array _ Nothing -> []
        SVMType.Mapping {} -> []
        _ -> [("State variable " <> labelToText name <> " is never written to. Consider making it a constant.") <$ _varContext a]
      findStateAnns _ _ = []
   in M.foldMapWithKey findStateAnns stateVariables'

functionHelper :: Func -> SSS [SourceAnnotation Text]
functionHelper Func {..} = do
  contract <- gets (\(_,_,c) -> c)
  modifierAnns <- fmap concat . for _funcModifiers $ \(n, es) -> do
    argAnns <- concat <$> traverse expressionHelper es
    modAnns <- fmap concat . for (M.lookup n $ _modifiers contract) $ maybe (pure []) statementsHelper . _modifierContents
    pure $ argAnns ++ modAnns
  funcAnns <- maybe (pure []) statementsHelper _funcContents
  pure $ modifierAnns ++ funcAnns

statementsHelper :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper ss = do
  modify $ \(a,b,c) -> (a, (M.empty : b), c)
  anns <- concat <$> traverse statementHelper ss
  modify $ \(a,b,c) -> case b of
    [] -> (a,[],c)
    (_:xs) -> (a,xs,c)
  pure anns

isLocalVariable :: SolidString -> SSS Bool
isLocalVariable name = foldr lookupVar False <$> gets (\(_,s,_) -> s)
  where
    lookupVar _ True = True
    lookupVar m _ = isJust $ M.lookup name m

pushLocalVariable :: SolidString -> SourceAnnotation () -> SSS ()
pushLocalVariable name decl = modify $ \(a,b,c) -> case b of
  [] -> error "This can't happen by the laws of physics"
  (x : xs) -> (a, (M.insert name decl x) : xs, c)

pushLocalVariables :: [VarDefEntry] -> SSS ()
pushLocalVariables = traverse_ pushEntry
  where
    pushEntry BlankEntry = pure ()
    pushEntry VarDefEntry {..} = pushLocalVariable vardefName vardefContext

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) = do
  cs <- expressionHelper cond
  ts <- statementsHelper thens
  es <- maybe (pure []) statementsHelper mElse
  pure $ concat [cs, ts, es]
statementHelper (TryCatchStatement try catchMap _) = do
  ts <- statementsHelper try
  cs <- statementsHelper (concatMap (snd . snd) (M.toList catchMap))
  pure $ concat [ts, cs]
statementHelper (SolidityTryCatchStatement expr _ successStatements catchMap _) = do
  cs <- expressionHelper expr
  ts <- statementsHelper successStatements
  es <- statementsHelper (concatMap (snd . snd) (M.toList catchMap))
  pure $ concat [cs, ts, es]
statementHelper (WhileStatement cond body _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper body
  pure $ concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  cs <- maybe (pure []) expressionHelper mCond
  ps <- maybe (pure []) expressionHelper mPost
  bs <- statementsHelper body
  pure $ concat [is, cs, ps, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body cond _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper body
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
  statementsHelper body
statementHelper (AssemblyStatement _ _) = pure []
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  maybe (pure []) expressionHelper mExpr
simpleStatementHelper (ExpressionStatement expr) =
  expressionHelper expr

stateVarReadHelper :: SolidString -> SourceAnnotation () -> SSS [SourceAnnotation Text]
stateVarReadHelper name _ = do
  isLocal <- isLocalVariable name
  unless isLocal $
    id . _1 . at name . _Just . _1 .= True
  pure [] -- don't @ me

stateVarWriteHelper :: SolidString -> SourceAnnotation () -> SSS [SourceAnnotation Text]
stateVarWriteHelper name _ = do
  isLocal <- isLocalVariable name
  unless isLocal $
    id . _1 . at name . _Just . _2 .= True
  pure [] -- don't @ me

expressionHelper :: Expression -> SSS [SourceAnnotation Text]
expressionHelper (Binary y "=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "+=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "-=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "*=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "/=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "%=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "|=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y ">>>=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y ">>=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "<<=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "&=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "^=" (Variable x name) b) = do
  ann <- stateVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary _ _ a b) =
  concat <$> traverse expressionHelper [a, b]
expressionHelper (PlusPlus y (Variable x name)) =
  stateVarWriteHelper name (x <> y)
expressionHelper (PlusPlus _ e) = expressionHelper e
expressionHelper (MinusMinus y (Variable x name)) =
  stateVarWriteHelper name (x <> y)
expressionHelper (MinusMinus _ e) = expressionHelper e
expressionHelper (NewExpression _ _ mSalt) = maybe (pure []) expressionHelper mSalt
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
expressionHelper (AddressLiteral _ _) = pure []
expressionHelper (TupleExpression _ es) =
  concat <$> traverse (maybe (pure []) expressionHelper) es
expressionHelper (ArrayExpression _ es) = concat <$> traverse expressionHelper es
expressionHelper (Variable x name) =
  [] <$ stateVarReadHelper name x
expressionHelper (ObjectLiteral _ _) = pure []
expressionHelper (HexaLiteral _ _) = pure []
expressionHelper (InlineBoundsCheck _ _ _ _) = pure []
