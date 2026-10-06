{-# LANGUAGE TemplateHaskell, ScopedTypeVariables, CPP, DataKinds, GADTs, TypeOperators, LambdaCase, OverloadedStrings #-}
-- Quotations have two concrete build-time interpretations. Execution erases
-- all inspection machinery; inspection substitutes the captured expressions.
module SolidVM.Quotation (execute, inspect, helperDeclarations, integerSize, integerAction, integerPrimitive, integerExpression, blockAction) where

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

-- Combine primitive sizing and arithmetic before GHC compiles either backend.
-- These expressions become one executable lambda and one matching source lambda.
integerSize :: String -> Q Exp
integerSize op = case op of
  "+" -> [| \a b -> 1 + max (byteWidth a) (byteWidth b) |]
  "-" -> [| \a b -> 1 + max (byteWidth a) (byteWidth b) |]
  "*" -> [| \a b -> byteWidth a + byteWidth b |]
  "/" -> [| \a _ -> byteWidth a |]
  "%" -> [| \_ b -> byteWidth b |]
  "**" -> [| \a b -> byteWidth a * b |]
  "<<" -> [| \a b -> byteWidth a + b |]
  ">>" -> [| \a _ -> byteWidth a |]
  _ -> [| \a b -> max (byteWidth a) (byteWidth b) |]

integerAction :: String -> Q Exp -> Q Exp
integerAction op quotation = do
  expression <- quotation
  sizing <- integerSize op
  case (expression, sizing) of
    (LamE [VarP a, VarP b] body, LamE [left, right] size) -> do
      let bindings = [(n, v) | (VarP n, v) <- [(left, a), (right, b)]]
          rename (VarE n) = VarE (maybe n id (lookup n bindings))
          rename e = e
      charge <- [| chargeOp $(pure (transform rename size)) |]
      pure (LamE [VarP a, VarP b] (InfixE (Just charge) (VarE '(>>)) (Just body)))
    _ -> fail "integer arithmetic quotation must have two value arguments"

integerPrimitive :: String -> Q Exp
integerPrimitive "+" = [| \a b -> pure (a + b) |]
integerPrimitive "-" = [| \a b -> pure (a - b) |]
integerPrimitive "*" = [| \a b -> pure (a * b) |]
integerPrimitive _ = fail "unsupported fused integer operation"

-- Fuse atomic reads and arithmetic in both backends at GHC build time.
integerExpression :: (Q Exp -> Q Exp) -> Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp
integerExpression backend operator left right after = do
  op <- operator
  lhs <- left
  rhs <- right
  finalCharge <- after
  local <- newName $ case lhs of LamE [VarP n] _ -> nameBase n; _ -> "local"
  (leftCharges, leftValue) <- applyRead local lhs >>= splitValue
  (rightCharges, rightValue) <- applyRead local rhs >>= splitValue
  alternatives <- mapM (\symbol -> do
    primitive <- integerAction symbol (integerPrimitive symbol)
    arithmetic <- case primitive of
      LamE [VarP x, VarP y] body -> pure $ rename [(x, leftValue), (y, rightValue)] body
      _ -> fail "integer primitive must have two value arguments"
    (operationCharges, value) <- splitValue arithmetic
    let body = DoE Nothing $ leftCharges ++ rightCharges ++ operationCharges ++
          [NoBindS finalCharge, NoBindS (AppE (VarE 'pure) value)]
        slotPattern = case (lhs, rhs) of
          (LamE [VarP _] _, _) -> VarP local
          (_, LamE [VarP _] _) -> VarP local
          _ -> ConP '(:&) [] [VarP local, WildP]
        environmentPattern
          | headRead lhs || headRead rhs = slotPattern
          | otherwise = WildP
        expression = LamE [environmentPattern] body
    emitted <- backend (pure expression)
    pure $ Match (LitP (StringL symbol)) (NormalB (AppE (ConE 'Just) emitted)) []) ["+", "-", "*"]
  pure $ CaseE op (alternatives ++ [Match WildP (NormalB (ConE 'Nothing)) []])
  where
    rename values = transform $ \e -> case e of
      VarE n -> maybe e id (lookup n values)
      _ -> e
    headSlot (VarP n) = Just n
    headSlot (ParensP p) = headSlot p
    headSlot (InfixP (VarP n) constructor WildP) | constructor == '(:&) = Just n
    headSlot (ConP constructor [] [VarP n, WildP]) | constructor == '(:&) = Just n
    headSlot _ = Nothing
    headRead (LamE [p] _) = case headSlot p of Just _ -> True; _ -> False
    headRead _ = False
    applyRead local (LamE [p] body) | Just n <- headSlot p = pure (rename [(n, VarE local)] body)
    applyRead _ (LamE [WildP] body) = pure body
    applyRead _ _ = fail "atomic integer read must be a literal or the first local slot"
    splitValue (InfixE (Just before) (VarE thenName) (Just value)) | thenName == '(>>) = do
      (statements, result) <- splitValue value
      pure (NoBindS before : statements, result)
    splitValue (AppE (VarE pureName) value) | pureName == 'pure = pure ([], value)
    splitValue _ = fail "atomic integer expression must contain charges followed by a pure value"

blockAction :: Q Exp -> Q Exp
blockAction quotation = do
  expression <- quotation
  charge <- [| chargeGas 1 |]
  case expression of
    LamE parameters body -> pure $ LamE parameters $ DoE Nothing $
      NoBindS charge : case body of DoE Nothing statements -> statements; _ -> [NoBindS body]
    _ -> fail "block quotation must be an environment lambda"
