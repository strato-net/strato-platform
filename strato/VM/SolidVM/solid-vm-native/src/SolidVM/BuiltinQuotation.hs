{-# LANGUAGE TemplateHaskell #-}
module SolidVM.BuiltinQuotation (builtinActions) where

import Language.Haskell.TH
import Language.Haskell.TH.Syntax (liftData)

-- Derive inspection expressions from the exact builtin selection declaration.
-- Adding a builtin therefore cannot leave a second selection table behind.
builtinActions :: Q Exp -> Q Exp
builtinActions declaration = do
  expression <- declaration
  case expression of
    LamCaseE matches -> LamCaseE <$> traverse render matches
    _ -> fail "builtin selection must be a lambda-case expression"
  where
    render (Match pattern (NormalB (AppE (ConE just) action)) []) | nameBase just == "Just" = do
      expression <- liftData action
      pure $ Match pattern (NormalB (AppE (ConE 'Just) expression)) []
    render (Match pattern (NormalB (ConE nothing)) []) | nameBase nothing == "Nothing" =
      pure $ Match pattern (NormalB (ConE 'Nothing)) []
    render _ = fail "builtin cases must return Just action or Nothing"
