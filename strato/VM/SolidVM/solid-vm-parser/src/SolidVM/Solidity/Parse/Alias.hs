{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Garrett Peuse <garrett_peuse@blockapps.net>
module SolidVM.Solidity.Parse.Alias (solidityAlias) where

import Data.Source
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

solidityAlias :: SolidityParser SourceUnit
solidityAlias = do
  ~(a, (aliasName, rest)) <- withPosition $ do
    symbol "type"
    aliasName <- identifier
    reserved "is"
    rest <- many1 (noneOf ";") --TODO have to not do this, have it check if it is a simple type otherwise throw an error
    semi
    pure (aliasName, rest)
  --Directly make store type rather than string of type?
  addUserDefinedType aliasName rest
  return (Alias a aliasName rest)
