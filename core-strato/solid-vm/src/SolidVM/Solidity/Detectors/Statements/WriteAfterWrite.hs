{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Statements.WriteAfterWrite
  ( detector
  ) where

import           CodeCollection
import           Control.Monad.State
import qualified Data.Map.Strict as M
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Solidity.Xabi
import           SolidVM.Solidity.Xabi.Statement

type SSS = State (M.Map String (SourceAnnotation ()))

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper <$> M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case funcContents of
  Nothing -> []
  Just stmts -> statementsHelper stmts

statementsHelper :: [Statement] -> [SourceAnnotation Text]
statementsHelper = concat . flip evalState M.empty . traverse statementHelper

statementsHelper' :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper' ss = concat . evalState (traverse statementHelper ss) <$> get

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) = do
  cs <- expressionHelper cond
  let ts = statementsHelper thens
      es = maybe [] statementsHelper mElse
  put M.empty
  pure $ concat [cs, ts, es]
statementHelper (WhileStatement cond body _) = do
  cs <- expressionHelper cond
  let bs = statementsHelper body
  put M.empty
  pure $ concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  cs <- maybe (pure []) expressionHelper mCond
  ps <- maybe (pure []) expressionHelper mPost
  let bs = statementsHelper body
  put M.empty
  pure $ concat [is, cs, ps, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body cond _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  put M.empty
  pure $ concat [bs, cs]
statementHelper (Continue _) = pure []
statementHelper (Break _) = pure []
statementHelper (Return mExpr _) =
  maybe (pure []) expressionHelper mExpr
statementHelper (Throw _) = pure []
statementHelper (EmitStatement _ vals _) =
  concat <$> traverse (expressionHelper . snd) vals
statementHelper (AssemblyStatement _ _) = pure []
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition _ mExpr) =
  maybe (pure []) expressionHelper mExpr
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
expressionHelper (StringLiteral _ _) = pure []
expressionHelper (TupleExpression _ es) =
  concat <$> traverse (maybe (pure []) expressionHelper) es
expressionHelper (ArrayExpression _ es) = concat <$> traverse expressionHelper es
expressionHelper (Variable _ name) = do
  modify $ M.delete name
  pure []