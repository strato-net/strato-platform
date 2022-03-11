{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Statements.UninitializedLocalVariables
  ( detector
  ) where

import           CodeCollection
import qualified Data.Map.Strict as M
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Solidity.Detectors.Types
import           SolidVM.Solidity.Xabi
import           SolidVM.Solidity.Xabi.Statement

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} =
  concat $ functionHelper <$> M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case funcContents of
  Nothing -> []
  Just stmts -> concat $ statementHelper <$> stmts

statementHelper :: Statement -> [SourceAnnotation Text]
statementHelper (IfStatement _ thens mElse _) =
  let ts = concat $ statementHelper <$> thens
      es = concat $ maybe [] (map statementHelper) mElse
   in concat [ts, es]
statementHelper (WhileStatement _ body _) =
  concat $ statementHelper <$> body
statementHelper (ForStatement mInit _ _ body a) =
  let is = maybe [] (simpleStatementHelper a) mInit
      bs = concat $ statementHelper <$> body
   in concat [is, bs]
statementHelper (Block _) = []
statementHelper (DoWhileStatement body _ _) =
  concat $ statementHelper <$> body
statementHelper (Continue _) = []
statementHelper (Break _) = []
statementHelper (Return _ _) = []
statementHelper (Throw _) = []
statementHelper (EmitStatement _ _ _) = []
statementHelper (AssemblyStatement _ _) = []
statementHelper (SimpleStatement stmt a) = simpleStatementHelper a stmt

simpleStatementHelper :: SourceAnnotation ()
                      -> SimpleStatement
                      -> [SourceAnnotation Text]
simpleStatementHelper a (VariableDefinition xs Nothing) =
  let getAnn BlankEntry      x        = x
      getAnn VarDefEntry{..} Nothing  = Just vardefContext
      getAnn VarDefEntry{..} (Just w) = Just $ vardefContext <> w
   in case foldr getAnn Nothing xs of
        Nothing -> [const "Redundant statement." <$> a]
        Just ann -> [const "Uninitialized local variable." <$> ann]
simpleStatementHelper _ _ = []
