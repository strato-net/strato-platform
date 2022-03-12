{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Functions.Unimplemented.Continue
  ( detector
  ) where

import qualified Data.Map.Strict as M
import           Data.Maybe      (maybeToList)
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.Detectors.Types
import           SolidVM.Solidity.Xabi
import           SolidVM.Solidity.Xabi.Statement

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case funcContents of
  Nothing -> []
  Just stmts -> concat $ statementHelper <$> stmts

statementHelper :: Statement -> [SourceAnnotation Text]
statementHelper (IfStatement _ thens mElse _) = concat $ (statementHelper <$> thens) ++ (maybe [] (map statementHelper) mElse)
statementHelper (WhileStatement _ body _) = concat $ statementHelper <$> body
statementHelper (ForStatement _ _ _ body _) = concat $ statementHelper <$> body
statementHelper (Block _) = []
statementHelper (DoWhileStatement body _ _) = concat $ statementHelper <$> body
statementHelper (Continue a) = [const "Unimplemented: Continue" <$> a]
statementHelper (Break a) = [const "Unimplemented: Break" <$> a]
statementHelper (Return _ _) = []
statementHelper (Throw _) = []
statementHelper (EmitStatement _ _ _) = []
statementHelper (AssemblyStatement _ _) = []
statementHelper (SimpleStatement _ _) = []
