{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Solidity.StaticAnalysis.Statements.Unchecked
  ( detector,
  )
where

import qualified Data.Map.Strict as M
import Data.Maybe (maybeToList)
import Data.Source
import Data.Text (Text)
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.StaticAnalysis.Types

detector :: CompilerDetector
detector cc =
  concatMap (statementsHelper . _funcContents) (M.elems $ _flFuncs cc)
    ++ concatMap contractHelper (M.elems $ _contracts cc)

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper c =
  concatMap (statementsHelper . _funcContents) (maybeToList (_constructor c) ++ M.elems (_functions c))
    ++ concatMap (statementsHelper . _modifierContents) (M.elems $ _modifiers c)

statementsHelper :: Maybe [Statement] -> [SourceAnnotation Text]
statementsHelper = maybe [] (concatMap statementHelper)

statementHelper :: Statement -> [SourceAnnotation Text]
statementHelper (UncheckedStatement body pos) =
  ("unchecked has no effect in SolidVM; unsigned underflow still throws." <$ pos)
    : concatMap statementHelper body
statementHelper (IfStatement _ thens mElse _) =
  concatMap statementHelper thens ++ statementsHelper mElse
statementHelper (WhileStatement _ body _) = concatMap statementHelper body
statementHelper (ForStatement _ _ _ body _) = concatMap statementHelper body
statementHelper (DoWhileStatement body _ _) = concatMap statementHelper body
statementHelper (TryCatchStatement body catches _) =
  concatMap statementHelper body ++ concatMap (concatMap statementHelper . snd) (M.elems catches)
statementHelper (SolidityTryCatchStatement _ _ body catches _) =
  concatMap statementHelper body ++ concatMap (concatMap statementHelper . snd) (M.elems catches)
statementHelper _ = []
