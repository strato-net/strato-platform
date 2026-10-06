{-# LANGUAGE TemplateHaskell #-}
module SolidVM.BuiltinQuotation (builtinActions) where

import Language.Haskell.TH
import Language.Haskell.TH.Syntax (liftData)

-- Derive inspection expressions from the exact builtin selection declaration.
-- Adding a builtin therefore cannot leave a second selection table behind.
builtinActions :: Q [Dec] -> Q [Dec]
builtinActions declaration = do
  declarations <- declaration
  case declarations of
    [SigD _ (AppT (AppT ArrowT input) _), ValD (VarP _) (NormalB (LamCaseE matches)) []] -> do
      rendered <- traverse render matches
      pure $ [SigD (mkName "lookupActionSource") (AppT (AppT ArrowT input) (AppT (ConT ''Maybe) (ConT ''Exp))), FunD (mkName "lookupActionSource") [Clause [] (NormalB (LamCaseE rendered)) []]]
    _ -> fail "builtin selection must be a single lambda-case declaration"
  where
    render (Match pattern (NormalB (AppE (ConE just) action)) []) | nameBase just == "Just" = do
      expression <- liftData action
      pure $ Match pattern (NormalB (AppE (ConE 'Just) expression)) []
    render (Match pattern (NormalB (ConE nothing)) []) | nameBase nothing == "Nothing" =
      pure $ Match pattern (NormalB (ConE 'Nothing)) []
    render _ = fail "builtin cases must return Just action or Nothing"
