{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Statements.StateVariableShadowing
  ( detector,
  )
where

import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, maybeToList)
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.StaticAnalysis.Types

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection {..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract {..} =
  concat $ functionHelper _storageDefs <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: M.Map SolidString VariableDecl -> Func -> [SourceAnnotation Text]
functionHelper vars Func {..} = case _funcContents of
  Nothing -> []
  Just stmts -> concat $ statementHelper vars <$> stmts

statementHelper :: M.Map SolidString VariableDecl -> Statement -> [SourceAnnotation Text]
statementHelper vars (IfStatement _ thens mElse _) =
  let ts = concat $ statementHelper vars <$> thens
      es = concat $ maybe [] (map $ statementHelper vars) mElse
   in concat [ts, es]
statementHelper vars (TryCatchStatement statements catches _) =
  let ts = concat $ statementHelper vars <$> statements
      cs = concat $ statementHelper vars <$> (concatMap (snd . snd) (M.toList catches))
   in concat [ts, cs]
statementHelper vars (SolidityTryCatchStatement _ _ successStatements catchesMap _) =
  let ts = concat $ statementHelper vars <$> successStatements
      cs = concat $ statementHelper vars <$> (concatMap (snd . snd) (M.toList catchesMap))
   in concat [ts, cs]
statementHelper vars (WhileStatement _ body _) =
  concat $ statementHelper vars <$> body
statementHelper vars (ForStatement mInit _ _ body _) =
  let is = maybe [] (simpleStatementHelper vars) mInit
      bs = concat $ statementHelper vars <$> body
   in concat [is, bs]
statementHelper _ (Block _) = []
statementHelper vars (DoWhileStatement body _ _) =
  concat $ statementHelper vars <$> body
statementHelper _ (Continue _) = []
statementHelper _ (Break _) = []
statementHelper _ (ModifierExecutor _) = []
statementHelper _ (Return _ _) = []
statementHelper _ (Throw _ _) = []
statementHelper _ (EmitStatement _ _ _) = []
statementHelper _ (RevertStatement _ _ _) = []
statementHelper vars (UncheckedStatement body _) =
  concat $ statementHelper vars <$> body
statementHelper _ (AssemblyStatement _ _) = []
statementHelper vars (SimpleStatement stmt _) = simpleStatementHelper vars stmt

simpleStatementHelper ::
  M.Map SolidString VariableDecl ->
  SimpleStatement ->
  [SourceAnnotation Text]
simpleStatementHelper _ (ExpressionStatement _) = []
simpleStatementHelper vars (VariableDefinition entries _) =
  catMaybes $ lookupVar <$> entries
  where
    lookupVar BlankEntry = Nothing
    lookupVar v = applyWarning v <$> M.lookup (vardefName v) vars
    applyWarning local state =
      let statePos = _sourceAnnotationStart $ _varContext state
          statePosStr =
            concat
              [ _sourcePositionName statePos,
                ", line ",
                show $ _sourcePositionLine statePos,
                ", column ",
                show $ _sourcePositionColumn statePos
              ]
          msg =
            T.concat
              [ "Local variable shadowing state variable. ",
                labelToText $ vardefName local,
                " shadows the variable defined at ",
                T.pack statePosStr
              ]
       in const msg <$> vardefContext local
