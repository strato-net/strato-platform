{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
module SolidVM.Solidity.Parse.Imports (solidityImport) where

import Data.List (find)
import Data.Maybe (isJust)
import Data.Source
import qualified Data.Text as T
import SolidVM.Model.CodeCollection.Import
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Statement
import Text.Parsec

solidityImport :: SolidityParser SourceUnit
solidityImport = do
  es6 <- isJust . find ((== "es6") . fst) . pragmas <$> getState
  ~(a, imp) <- withPosition $ do
    reserved "import"
    fileImport es6
  semi
  pure $ Import a imp

fileImport :: Bool -> SolidityParser FileImport
fileImport es6 = do
  i <- bracedImport <|> try qualifiedImport <|> simpleImport
  if es6
    then pure i
    else case i of
      Simple {} -> pure i
      Qualified {} -> fail "Please add `pragma es6;` to the top of the file to enable support for qualified imports."
      Braced {} -> fail "Please add `pragma es6;` to the top of the file to enable support for braced imports."

simpleImport :: SolidityParser FileImport
simpleImport = do
  ~(a, expr) <- withPosition expression
  pure $ Simple expr a

qualifiedImport :: SolidityParser FileImport
qualifiedImport = do
  ~(a, (expr, qualifier)) <- withPosition $ do
    expr <- expression
    reserved "as"
    qualifier <- T.pack <$> stringLiteral
    pure (expr, qualifier)
  pure $ Qualified expr qualifier a

bracedImport :: SolidityParser FileImport
bracedImport = do
  ~(a, (items, expr)) <- withPosition $ do
    items <- braces $ commaSep1 itemImport
    reserved "from"
    expr <- expression
    pure (items, expr)
  pure $ Braced items expr a

itemImport :: SolidityParser ItemImport
itemImport = try aliasedImport <|> namedImport

namedImport :: SolidityParser ItemImport
namedImport = do
  ~(a, path) <- withPosition $ T.pack <$> identifier
  pure $ Named path a

aliasedImport :: SolidityParser ItemImport
aliasedImport = do
  ~(a, (item, alias)) <- withPosition $ do
    item <- T.pack <$> identifier
    reserved "as"
    alias <- T.pack <$> identifier
    pure (item, alias)
  pure $ Aliased item alias a
