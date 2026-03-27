{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
module BlockApps.Solidity.Parse.Imports (solidityImport) where

import BlockApps.Solidity.Parse.Lexer
import BlockApps.Solidity.Parse.ParserTypes
import qualified Data.Text as T

solidityImport :: SolidityParser SourceUnit
solidityImport = do
  reserved "import"
  path <- T.pack <$> stringLiteral
  semi
  return $ Import path
