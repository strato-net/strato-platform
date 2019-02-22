-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Pragmas (solidityPragma) where

import           Text.Parsec

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes


solidityPragma :: SolidityParser SourceUnit
solidityPragma = do
  reserved "pragma"
  pragmaName <- identifier
  rest <- many1 (noneOf ";")
  semi
  return $ Pragma pragmaName rest
