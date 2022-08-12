-- |
-- Module: Imports
-- Description: Parsers for Solidity imports
-- Maintainer: Garrett Peuse <garrett_peuse@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Alias (solidityAlias) where

import           Text.Parsec 
import           Data.Source
--import qualified Data.Text   as T

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
--import Debug.Trace

solidityAlias :: SolidityParser SourceUnit
solidityAlias = do
  ~(a, (aliasName, rest)) <- withPosition $ do
    reserved "type"
    
    aliasName <- identifier
    reserved "is"
    rest <- many1 (noneOf ";") --TODO have to not do this, have it check if it is a simple type otherwise throw an error
    semi
    pure (aliasName, rest)
  --TODO set setAlias to Parser State
  addUserDefinedType aliasName rest
  return (Alias a ""  "") 
  -- return  $ trace ( "We have successfully made it in Alias and return the Alien\n\t alias name" 
  --   ++   ( show $ aliasName )
  --   ++ "\n\t associated type" ++  (show rest)) (Alias a ""  "")