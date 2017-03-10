{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module Parser (
  parse,
  Identifier, ContractName, SourceCode,
  SolidityFile, SolidityValue,
  SolidityContract(..), SolidityObjDef(..),
  SolidityTypeDef(..), SolidityTuple(..),
  SolidityBasicType(..), SolidityNewType(..)
  ) where

import Text.Parsec hiding (parse)
import Text.Parsec.Pos

import Declarations
import Lexer
import ParserTypes

parse :: (SourceName -> String) -> SourceName -> String
          -> Either ParseError SolidityFile
parse importReader sName sCode =
  runParser (solidityFile importReader) "" sName sCode

solidityFile :: (SourceName -> String) -> SolidityParser SolidityFile
solidityFile importReader = do
  whiteSpace
  files <- many (solidityImport importReader <|> fmap return solidityContract)
  eof
  return $ concat files

solidityImport :: (SourceName -> String) -> SolidityParser SolidityFile
solidityImport importReader =
  let saveFile = do
        curFile <- getInput
        curPos <- getPosition
        return (curFile, curPos)
      newFile name = do
        setPosition $ initialPos name
        setInput $ importReader name
        solidityFile importReader
      restoreFile (fileIn, filePos) = do
        setPosition filePos
        setInput fileIn
  in do
    reserved "import"
    importName <- soliditySourceFilename
    semi
    thisFile <- saveFile
    importFile <- newFile importName
    restoreFile thisFile
    return importFile
  
soliditySourceFilename :: SolidityParser SourceName
soliditySourceFilename = stringLiteral
