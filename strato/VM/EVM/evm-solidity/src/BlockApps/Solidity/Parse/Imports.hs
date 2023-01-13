-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Imports (solidityImport) where

import qualified Data.Text as T
import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes

solidityImport :: SolidityParser SourceUnit
solidityImport = do
  reserved "import"
  path <- T.pack <$> stringLiteral
  semi
  return $ Import path

