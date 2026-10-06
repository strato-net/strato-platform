{-# LANGUAGE TemplateHaskell, ScopedTypeVariables, CPP, DataKinds, GADTs, TypeOperators, LambdaCase, OverloadedStrings #-}
-- Quotations have two concrete build-time interpretations. Execution erases
-- all inspection machinery; inspection substitutes the captured expressions.
module SolidVM.Quotation (execute, inspect, helperDeclarations) where

import Language.Haskell.TH hiding (Code)
import Language.Haskell.TH.Syntax (liftData)
import Data.Data (Data, cast, gmapQ)
import Data.List (nub)
import Control.Monad (when)
import Control.Monad.Reader (liftIO)
import Data.Decimal
import Data.IORef
import qualified Data.Text as T
import SolidVM.Core
import SolidVM.SourceCode (Code(..), ToSource(..), substitute, transform)

execute :: Q Exp -> Q Exp
execute quotation = transform erase <$> (quotation >>= localHelpers)
  where
    erase (AppE (AppE (VarE mapper) (VarE n)) e) | nameBase mapper == "map" && nameBase n == "runCode" = e
    erase (AppE (VarE n) e) | nameBase n == "runCode" = e
    erase e = e

inspect :: Q Exp -> Q Exp
inspect quotation = do
  expression <- quotation >>= localHelpers
  let bound = collect (\x -> case x of VarP n -> [n]; AsP n _ -> [n]; _ -> []) expression
        ++ collect (\x -> case x of FunD n _ -> [n]; _ -> []) expression
      mentioned = collect (\x -> case x of VarE n | nameModule n == Nothing -> [n]; _ -> []) expression
      free = filter (`notElem` bound) (nub mentioned)
  captures <- listE [tupE [liftData n, [| toSource $(varE n) |]] | n <- free]
  [| Code $(pure expression) (substitute $(pure captures) $(liftData expression)) Nothing Nothing |]

collect :: forall t a. (Data t, Data a) => (t -> [Name]) -> a -> [Name]
collect f x = maybe [] f (cast x) ++ concat (gmapQ (collect f) x)

-- The definitions used by both emitted source and executable actions. Giving
-- each action a local binding restores the helpers' original optimization scope.
helperDeclarations :: Q [Dec]
helperDeclarations = [d|
#include "HelperActions.inc"
  |]

localHelpers :: Exp -> Q Exp
localHelpers expression = do
  declarations <- helperDeclarations
  let names = [n | FunD n _ <- declarations]
      referenced = collect (\e -> case e of
        VarE n | nameModule n `elem` [Just "SolidVM.Compile", Just "SolidVM.Source"] -> [n]
        _ -> []) expression
      used = filter (\n -> any ((== nameBase n) . nameBase) referenced) names
      belongs (FunD n _) = n `elem` used
      belongs (SigD n _) = n `elem` used
      belongs _ = False
      replace (VarE n)
        | n `elem` referenced
        , [local] <- filter ((== nameBase n) . nameBase) used = VarE local
      replace e = e
  pure $ if null used then expression else LetE (filter belongs declarations) (transform replace expression)
