{-# LANGUAGE TemplateHaskell, ScopedTypeVariables, LambdaCase #-}
module SolidVM.SourceTemplate (describe) where

import Language.Haskell.TH hiding (Code)
import Language.Haskell.TH.Syntax (liftData)
import Data.Data (Data, cast, gmapQ)
import Data.List (nub, isPrefixOf)
import SolidVM.SourceCode (Code(..), Form(Ordinary), ToSource(..), substitute, transform)

-- Capture substitution only: the shared compiler has already chosen the code.
-- CAPTURE gives this backend a Code value where execution has its raw payload.
describe :: Q Exp -> Q Exp
describe quotation = do
  expression <- quotation
  let bound = collect (\case VarP name -> [name]; AsP name _ -> [name]; _ -> []) expression
        ++ collect (\case FunD name _ -> [name]; _ -> []) expression
      free = filter (`notElem` bound) $ nub $ collect (\case
        VarE name | nameModule name == Nothing -> [name]
        _ -> []) expression
      payload = transform (\case
        VarE name | name `elem` free, "compiled_" `isPrefixOf` nameBase name -> AppE (VarE 'runCode) (VarE name)
        other -> other) expression
  captures <- listE [tupE [liftData name, [| toSource $(varE name) |]] | name <- free]
  syntax <- liftData expression
  [| Code $(pure payload) (substitute $(pure captures) $(pure syntax)) Nothing Nothing Ordinary |]

collect :: forall t a b. (Data t, Data a) => (t -> [b]) -> a -> [b]
collect f value = maybe [] f (cast value) ++ concat (gmapQ (collect f) value)
