-- |
-- Module: File
-- Description: Parses anything that can appear at the top level of
--   a Solidity source file
-- Maintainer: Ryan Reich <ryan@blockapps.net>
--
-- Currently does contracts and imports.  In the future should also handle
-- pragmas.
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module File (solidityFile) where

import Data.Either

import Text.Parsec

import Prelude hiding (lookup)

import Declarations
import Lexer
import ParserTypes

-- | Parses a full Solidity file's contracts and imports
solidityFile :: SolidityParser SolidityFile
solidityFile = do
  whiteSpace
  toplevel <- many $ do
    let eitherImport = Right <$> solidityImport
        eitherContract = Left <$> solidityContract
    eitherImport <|> eitherContract
  eof
  return $ uncurry SolidityFile $ partitionEithers toplevel
 
-- | Parses any of the various kinds of import statements
solidityImport :: SolidityParser (FileName, ImportAs)
solidityImport = do
  reserved "import"
  i <- simpleImport <|> es6Import
  semi
  return i
 
-- | Parses 'import "File"' and 'import "File" as name' statements
simpleImport :: SolidityParser (FileName, ImportAs)
simpleImport = do
  importName <- soliditySourceFilename
  importAs <- option Unqualified $ do
    lexeme $ string "as"
    StarPrefix <$> identifier
  return (importName, importAs)

-- | Parses 'import {sym1 as alias, sym2} from "File"' statements
es6Import :: SolidityParser (FileName, ImportAs)
es6Import = do
  importAs <- es6ImportAs
  lexeme $ string "from"
  importName <- soliditySourceFilename
  return (importName, importAs)

-- | Parses the '{sym1 as alias, sym2}' or '*" part of an es6 style import
es6ImportAs :: SolidityParser ImportAs
es6ImportAs = 
  (do
    importAs <- es6As
    case importAs of
      ("*", "*") -> return Unqualified
      ("*", p) -> return $ StarPrefix p
      _ -> parserFail "ES6-style import without braces must import \"*\""
  ) <|>
  braces 
  (do
    importsAs <- commaSep1 es6As
    return $ Aliases importsAs
  )

-- | Parses the actual 'sym1 [as alias]' part of the es6 import
es6As :: SolidityParser (ContractName, ContractName)
es6As = do
  origName <- identifier <|> lexeme (string "*")
  newName <- option origName $ do
    lexeme $ string "as"
    identifier
  return (origName, newName)

-- | Convenience type for parsing the filename part of an import
soliditySourceFilename :: SolidityParser FileName
soliditySourceFilename = stringLiteral
