{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Statements.MultipleDeclarations
  ( detector,
  )
where

import Control.Monad.State
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Source
import Data.Text (Text)
import Data.Traversable
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.StaticAnalysis.Types

type SSS = State (M.Map SolidString (SourceAnnotation ()))

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection {..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract {..} = storageDefsAnns ++ funcsAnns
  where
    storageDefsAnns = variableDeclsHelper $ M.assocs _storageDefs
    funcsAnns = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func {..} = case _funcContents of
  Nothing -> []
  Just stmts -> statementsHelper stmts

variableDeclsHelper :: [(SolidString, VariableDecl)] -> [SourceAnnotation Text]
variableDeclsHelper vds = concat . flip evalState M.empty . traverse variableDeclHelper $ vds

-- Nothing ~ [], Just a ~ [a]
variableDeclHelper :: (SolidString, VariableDecl) -> SSS [SourceAnnotation Text]
variableDeclHelper (name, VariableDecl {..}) = do
  s <- get
  case M.lookup name s of
    Just _ -> pure ["Multiple declaration." <$ _varContext]
    Nothing -> do
      modify $ M.insert name _varContext
      pure []

statementsHelper :: [Statement] -> [SourceAnnotation Text]
statementsHelper ss = concat . flip evalState M.empty . traverse statementHelper $ ss

statementsHelper' :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper' = fmap concat . traverse statementHelper

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement _ thens mElse _) = do
  s <- get
  ts <- statementsHelper' thens
  sThen <- get
  put s
  es <- maybe (pure []) statementsHelper' mElse
  sElse <- get
  put $ M.intersection s $ M.intersection sThen sElse
  pure $ concat [ts, es]
statementHelper (WhileStatement _ body _) = do
  s <- get
  bs <- statementsHelper' body
  sWhile <- get
  put $ M.intersection s sWhile
  pure $ concat [bs]
statementHelper (ForStatement mInit _ _ body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  s <- get
  bs <- statementsHelper' body
  sFor <- get
  put $ M.intersection s sFor
  pure $ concat [is, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body _ _) = do
  bs <- statementsHelper' body
  put M.empty
  pure $ concat [bs]
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
statementHelper (SolidityTryCatchStatement _ _ successStatements catchMap _) = do
  s <- get
  sTry <- get
  put $ M.intersection s sTry
  ss <- statementsHelper' successStatements
  sCatch <- get
  put $ M.intersection s sCatch
  css <- forM (M.toList catchMap) $ \(_, (_, cas)) -> do
    sCatch' <- get
    put $ M.intersection s sCatch'
    statementsHelper' cas
  pure $ concat [ss, (concat css)]
statementHelper (Continue _) = pure []
statementHelper (ModifierExecutor _) = pure []
statementHelper (Break _) = pure []
statementHelper (Return _ _) = pure []
statementHelper (Throw _ _) = pure []
statementHelper (EmitStatement _ _ _) = pure []
statementHelper (RevertStatement _ (OrderedArgs _) _) = pure []
statementHelper (RevertStatement _ (NamedArgs _) _) = pure []
statementHelper (UncheckedStatement body _) =
  statementsHelper' body
statementHelper (AssemblyStatement _ _) = pure []
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition vs mExpr) = case mExpr of
  Nothing -> pure []
  Just _ -> concat <$> for vs varDefEntryHelper
simpleStatementHelper (ExpressionStatement _) = pure []

varDefEntryHelper :: VarDefEntry -> SSS [SourceAnnotation Text]
varDefEntryHelper BlankEntry = pure []
varDefEntryHelper VarDefEntry {..} = do
  s <- get
  case M.lookup vardefName s of
    Just _ -> pure ["Multiple declaration." <$ vardefContext]
    Nothing -> do
      modify $ M.insert vardefName vardefContext
      pure []
