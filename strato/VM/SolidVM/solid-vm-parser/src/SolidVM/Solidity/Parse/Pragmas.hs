-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Pragmas (solidityPragma) where

import           Data.Source
import           Text.Parsec

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes

solidityPragma :: SolidityParser SourceUnit
solidityPragma = do
  ~(a, (pragmaName, rest)) <- withPosition $ do
    reserved "pragma"
    -- this is the word immediately following the pragma keyword (typically it is 'solidvm')
    pragmaName <- identifier
    -- The follow is anything else after the pragmaName.
    rest <- many1 (noneOf ";")
    --allow for saving the pragma version so it can be used elsewhere
    setPragmaVersion rest
    semi
    pure (pragmaName, rest)
  return $ Pragma a pragmaName rest