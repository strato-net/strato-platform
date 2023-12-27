{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
module SolidVM.Solidity.Parse.Pragmas (solidityPragma) where

import Control.Monad (when)
import Data.Source
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

solidityPragma :: SolidityParser SourceUnit
solidityPragma = do
  ~(a, (pragmaName, rest)) <- withPosition $ do
    reserved "pragma"
    -- this is the word immediately following the pragma keyword (typically it is 'solidvm')
    pragmaName <- identifier
    -- The follow is anything else after the pragmaName.
    rest <- many (noneOf ";")
    -- Modify the state of the parser to change the pragma version if a new version is found
    when (pragmaName == "solidvm") $ modifyState (\s -> s {pragmaVersion = rest})
    addPragma pragmaName rest
    semi
    pure (pragmaName, rest)
  return $ Pragma a pragmaName rest
