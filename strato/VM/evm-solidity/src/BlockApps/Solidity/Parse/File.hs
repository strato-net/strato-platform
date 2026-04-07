-- |
-- Module: File
-- Description: Parses anything that can appear at the top level of
--   a Solidity source file
-- Maintainer: Ryan Reich <ryan@blockapps.net>
--
-- Currently does contracts and pragmas.  In the future should also handle
-- imports.
module BlockApps.Solidity.Parse.File (solidityFile) where

import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Parse.Imports
import BlockApps.Solidity.Parse.Lexer
import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Parse.Pragmas
import Text.Parsec
import Prelude hiding (lookup)

solidityFile :: SolidityParser File
solidityFile = do
  whiteSpace
  units <- many (solidityPragma <|> solidityImport <|> solidityContract)
  eof
  return . File $ units
