{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
module SolidVM.Solidity.Parse.Imports (solidityImport) where

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
  ~(a, imp) <- withPosition $ do
    reserved "import"
    fileImport
  semi
  pure $ Import a imp

fileImport :: SolidityParser FileImport
fileImport = bracedImport <|> try qualifiedImport <|> simpleImport

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
