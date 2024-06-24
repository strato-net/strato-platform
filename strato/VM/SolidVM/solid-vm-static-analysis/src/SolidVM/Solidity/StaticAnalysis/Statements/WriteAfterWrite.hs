{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Statements.WriteAfterWrite
  ( detector,
  )
where

import Control.Monad (forM)
import Control.Monad.State
import Data.Foldable (for_)
import qualified Data.Map.Strict as M
import Data.Maybe (maybeToList)
import Data.Source
import Data.Text (Text)
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.StaticAnalysis.Types

type SSS = State (M.Map SolidString (SourceAnnotation ()))

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]

detector :: CompilerDetector
detector CodeCollection {..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract {..} = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func {..} = case _funcContents of
  Nothing -> []
  Just stmts -> statementsHelper stmts

statementsHelper :: [Statement] -> [SourceAnnotation Text]
statementsHelper = concat . flip evalState M.empty . traverse statementHelper

statementsHelper' :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper' = fmap concat . traverse statementHelper

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) = do
  cs <- expressionHelper cond
  s <- get
  ts <- statementsHelper' thens
  sThen <- get
  put s
  es <- maybe (pure []) statementsHelper' mElse
  sElse <- get
  put $ M.intersection s $ M.intersection sThen sElse
  pure $ concat [cs, ts, es]
statementHelper (WhileStatement cond body _) = do
  cs <- expressionHelper cond
  s <- get
  bs <- statementsHelper' body
  sWhile <- get
  put $ M.intersection s sWhile
  pure $ concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  cs <- maybe (pure []) expressionHelper mCond
  ps <- maybe (pure []) expressionHelper mPost
  s <- get
  bs <- statementsHelper' body
  sFor <- get
  put $ M.intersection s sFor
  pure $ concat [is, cs, ps, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body cond _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  put M.empty
  pure $ concat [bs, cs]
statementHelper (TryCatchStatement body catches _) = do
  s <- get
  bs <- statementsHelper' body
  sTry <- get
  put $ M.intersection s sTry
  css <- forM (M.toList catches) $ \(_, (_, cas)) -> do
    sCatch <- get
    put $ M.intersection s sCatch
    statementsHelper' cas
  pure $ concat [bs, (concat css)]
statementHelper (SolidityTryCatchStatement expr _ successStatements catchMap _) = do
  s <- get
  e <- expressionHelper expr
  sTry <- get
  put $ M.intersection s sTry
  ss <- statementsHelper' successStatements
  sCatch <- get
  put $ M.intersection s sCatch
  css <- forM (M.toList catchMap) $ \(_, (_, cas)) -> do
    sCatch' <- get
    put $ M.intersection s sCatch'
    statementsHelper' cas
  pure $ concat [e, ss, (concat css)]
statementHelper (Continue _) = pure []
statementHelper (ModifierExecutor _) = pure []
statementHelper (Break _) = pure []
statementHelper (Return mExpr _) =
  maybe (pure []) expressionHelper mExpr
statementHelper (Throw e _) =
  expressionHelper e
statementHelper (EmitStatement _ vals _) =
  concat <$> traverse (expressionHelper . snd) vals
statementHelper (RevertStatement _ (OrderedArgs vals) _) =
  concat <$> traverse expressionHelper vals
statementHelper (RevertStatement _ (NamedArgs vals) _) =
  concat <$> traverse (expressionHelper . snd) vals
statementHelper (UncheckedStatement body _) =
  statementsHelper' body
statementHelper (AssemblyStatement _ _) = pure []
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition vs mExpr) = case mExpr of
  Nothing -> pure []
  Just expr -> do
    anns <- expressionHelper expr
    for_ vs $ \case VarDefEntry {..} -> modify $ M.insert vardefName vardefContext; _ -> pure () -- second case should be impossible?
    pure anns
simpleStatementHelper (ExpressionStatement expr) =
  expressionHelper expr

expressionHelper :: Expression -> SSS [SourceAnnotation Text]
expressionHelper (Binary y "=" (Variable x name) b) = do
  s <- get
  let ann = case M.lookup name s of
        Just a -> [const "Redundant write." <$> a]
        Nothing -> []
  modify $ M.insert name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "+=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "-=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "*=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "/=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "%=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "|=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "&=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "^=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y ">>>=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y ">>=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary y "<<=" (Variable x name) b) = do
  modify $ M.insert name (x <> y)
  expressionHelper b
expressionHelper (Binary _ _ a b) =
  concat <$> traverse expressionHelper [a, b]
expressionHelper (PlusPlus _ (Variable x name)) = do
  modify $ M.insert name x
  pure []
expressionHelper (PlusPlus _ e) = expressionHelper e
expressionHelper (MinusMinus _ (Variable x name)) = do
  modify $ M.insert name x
  pure []
expressionHelper (MinusMinus _ e) = expressionHelper e
expressionHelper (NewExpression _ _) = pure []
expressionHelper (IndexAccess _ a b) = do
  as <- expressionHelper a
  bs <- maybe (pure []) expressionHelper b
  pure $ concat [as, bs]
expressionHelper (MemberAccess _ e _) = expressionHelper e
expressionHelper (FunctionCall _ e args) = do
  as <- expressionHelper e
  bs <- case args of
    OrderedArgs es -> concat <$> traverse expressionHelper es
    NamedArgs nes -> concat <$> traverse expressionHelper (snd <$> nes)
  put M.empty
  pure $ concat [as, bs]
expressionHelper (Unitary _ _ a) = expressionHelper a
expressionHelper (Ternary _ a b c) = concat <$> traverse expressionHelper [a, b, c]
expressionHelper (BoolLiteral _ _) = pure []
expressionHelper (NumberLiteral _ _ _) = pure []
expressionHelper (DecimalLiteral _ _) = pure []
expressionHelper (StringLiteral _ _) = pure []
expressionHelper (AccountLiteral _ _) = pure []
expressionHelper (HexaLiteral _ _) = pure []
expressionHelper (TupleExpression _ es) =
  concat <$> traverse (maybe (pure []) expressionHelper) es
expressionHelper (ArrayExpression _ es) = concat <$> traverse expressionHelper es
expressionHelper (Variable _ name) = do
  modify $ M.delete name
  pure []
expressionHelper (ObjectLiteral _ _) = pure []
