{-# LANGUAGE OverloadedStrings #-}

-- | Regression test for audit finding 43: the constant-folding pass in
-- 'SolidVM.Solidity.StaticAnalysis.Optimizer' previously called
-- Haskell's 'mod' (and 'div') on @NumberLiteral _ x_, NumberLiteral _ 0@
-- pairs unconditionally, which raises 'DivideByZero' inside the
-- compiler. The fix leaves the expression unchanged so the runtime
-- raises a contract-level error instead.
module OptimizerAuditFixSpec (spec) where

import Control.Exception (evaluate)
import Data.Default (def)
import SolidVM.Model.CodeCollection.Statement
  ( ExpressionF (..)
  )
import SolidVM.Solidity.StaticAnalysis.Optimizer (varDeclHelper)
import qualified SolidVM.Model.CodeCollection.VariableDecl as VD
import qualified SolidVM.Model.Type as SVMType
import Test.Hspec

----------------------------------------------------------------------
-- helpers

mkLit :: a -> Integer -> ExpressionF a
mkLit ann i = NumberLiteral ann i Nothing

mkVarDecl :: a -> SVMType.Type -> ExpressionF a -> VD.VariableDeclF a
mkVarDecl ann t expr =
  VD.VariableDecl
    { VD._varType = t,
      VD._varVisibility = Nothing,
      VD._varInitialVal = Just expr,
      VD._varContext = ann,
      VD._isImmutable = False
    }

----------------------------------------------------------------------
-- spec

spec :: Spec
spec = do
  describe "Audit finding 43: Optimizer constant-folding modulo-by-zero" $ do
    let ann = def
        intType = SVMType.Int Nothing Nothing

    it "folds 6 % 4 to a NumberLiteral 2 (legacy fold path)" $ do
      let lhs = mkLit ann 6
          rhs = mkLit ann 4
          expr = Binary ann "%" lhs rhs
          vd = mkVarDecl ann intType expr
          out = varDeclHelper def Nothing vd
      case VD._varInitialVal out of
        Just (NumberLiteral _ 2 _) -> pure ()
        other ->
          expectationFailure $
            "expected 6 % 4 to fold to NumberLiteral 2; got " ++ show other

    it "leaves 5 % 0 intact instead of crashing the compiler with DivideByZero" $ do
      let lhs = mkLit ann 5
          rhs = mkLit ann 0
          expr = Binary ann "%" lhs rhs
          vd = mkVarDecl ann intType expr
      -- Pre-fix this line raised an unhandled ArithException via
      -- Haskell's 'mod'. 'evaluate' forces enough of the result to
      -- trip that — and confirms the typed exception no longer fires.
      out <- evaluate (varDeclHelper def Nothing vd)
      case VD._varInitialVal out of
        Just (Binary _ "%" (NumberLiteral _ 5 _) (NumberLiteral _ 0 _)) ->
          pure ()
        other ->
          expectationFailure $
            "expected 5 % 0 to be left intact; got " ++ show other

    it "folds 9 / 3 to a NumberLiteral 3 (sanity for the / sibling)" $ do
      let lhs = mkLit ann 9
          rhs = mkLit ann 3
          expr = Binary ann "/" lhs rhs
          vd = mkVarDecl ann intType expr
          out = varDeclHelper def Nothing vd
      case VD._varInitialVal out of
        Just (NumberLiteral _ 3 _) -> pure ()
        other ->
          expectationFailure $
            "expected 9 / 3 to fold to NumberLiteral 3; got " ++ show other

    it "leaves 7 / 0 intact instead of crashing the compiler" $ do
      let lhs = mkLit ann 7
          rhs = mkLit ann 0
          expr = Binary ann "/" lhs rhs
          vd = mkVarDecl ann intType expr
      out <- evaluate (varDeclHelper def Nothing vd)
      case VD._varInitialVal out of
        Just (Binary _ "/" (NumberLiteral _ 7 _) (NumberLiteral _ 0 _)) ->
          pure ()
        other ->
          expectationFailure $
            "expected 7 / 0 to be left intact; got " ++ show other
