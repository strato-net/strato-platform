-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Imports (solidityImport) where

import           Data.Source
import qualified Data.Text   as T

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes

solidityImport :: SolidityParser SourceUnit
solidityImport = do
  ~(a, path) <- withPosition $ do
    reserved "import"
    T.pack <$> stringLiteral
  semi
  return $ Import a path
