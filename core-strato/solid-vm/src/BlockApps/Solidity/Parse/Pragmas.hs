-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Pragmas (solidityPragma) where

import           Text.Parsec

import           BlockApps.Solidity.Parse.Declarations
import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes


solidityPragma :: SolidityParser SourceUnit
solidityPragma = do
  reserved "pragma"
  pragmaName <- identifier
  rest <- many1 (noneOf ";")
  semi
  return $ Pragma pragmaName rest
