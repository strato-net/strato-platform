{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
module BlockApps.Solidity.Parse.Pragmas (solidityPragma) where

import BlockApps.Solidity.Parse.Lexer
import BlockApps.Solidity.Parse.ParserTypes
import Text.Parsec

solidityPragma :: SolidityParser SourceUnit
solidityPragma = do
  reserved "pragma"
  pragmaName <- identifier
  rest <- many1 (noneOf ";")
  semi
  return $ Pragma pragmaName rest
