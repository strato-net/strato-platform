{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.StaticAnalysis.Functions.Unimplemented.Continue
  ( detector
  ) where

import qualified Data.Map.Strict as M
import           Data.Maybe      (maybeToList)
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.StaticAnalysis.Types

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case _funcContents of
  Nothing -> []
  Just stmts -> concat $ statementHelper <$> stmts

statementHelper :: Statement -> [SourceAnnotation Text]
statementHelper (IfStatement _ thens mElse _) = concat $ (statementHelper <$> thens) ++ (maybe [] (map statementHelper) mElse)
statementHelper (TryCatchStatement tryBlock catches _) = concat $ (statementHelper <$> tryBlock) ++ (statementHelper <$> (concatMap (snd . snd) (M.toList catches)))
statementHelper (SolidityTryCatchStatement _ _ successStatements catchMap _) = concat $ (statementHelper <$> successStatements) ++ (statementHelper <$> (concatMap (snd . snd) (M.toList catchMap)))
statementHelper (WhileStatement _ body _) = concat $ statementHelper <$> body
statementHelper (ForStatement _ _ _ body _) = concat $ statementHelper <$> body
statementHelper (Block _) = []
statementHelper (DoWhileStatement body _ _) = concat $ statementHelper <$> body
statementHelper (Continue _) = []
statementHelper (ModifierExecutor _) = []
statementHelper (Break _) = []
statementHelper (Return _ _) = []
statementHelper (Throw _ _) = []
statementHelper (EmitStatement _ _ _) = []
statementHelper (RevertStatement _ _ _) = []
statementHelper (UncheckedStatement body _) = concat $ statementHelper <$> body
statementHelper (AssemblyStatement _ _) = []
statementHelper (SimpleStatement _ _) = []
