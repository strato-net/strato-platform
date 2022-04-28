-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Types where

import           Control.Monad
import           Data.List

import           Text.Parsec

import           SolidVM.Solidity.Parse.Expression
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes

import qualified SolidVM.Model.Type         as SVMType

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = try arrayType <|> simpleType <|> mappingType

-- | Parses builtins and user-defined names
simpleType :: SolidityParser SVMType.Type
simpleType =
  simple "bool" SVMType.Bool <|>
  simple "address" SVMType.Address <|>
  simple "account payable" SVMType.AccountPayable <|>
  simple "address payable" SVMType.AddressPayable <|>
  simple "account" SVMType.Account <|>
  simple "string" (SVMType.String $ Just True) <|>
  bytes' <|>
  intSuffixed "uint"  (SVMType.Int (Just False)) <|>
  intSuffixed "int"  (SVMType.Int (Just True)) <|>
  SVMType.Label <$>
    choice [
      identifier,
      concat <$> sequence [identifier, dot, identifier]
    ]
  where
    simple name nameType = do
      reserved name
      return nameType
    bytes' = -- To avoid shadowing another "bytes"
      simple "byte" (SVMType.Bytes Nothing $ Just 1) <|>
      simple "bytes" (SVMType.Bytes (Just True) Nothing) <|>
      lexeme (try $ do
         let base = "bytes"
         chars <- many1 alphaNum
         
         when (not (base `isPrefixOf` chars)) $ fail "missing 'bytes'"

         size <-
            case reads (drop (length base) chars) of
              [] -> return Nothing
              [(number, "")] -> do
                when (not $ number `elem` [1..32]) $ fail "invalid bytes size"
                return $ Just number
              _ ->  fail "invalid bytes size"

         return $ SVMType.Bytes Nothing size
      )
    intSuffixed base baseType = lexeme $ try $ do
      chars <- many1 alphaNum

      when (not (base `isPrefixOf` chars)) $ fail "missing base"

      number <-
            case reads (drop (length base) chars) of
              [] -> return Nothing
              [(number, "")] -> do
                when (not $ number `elem` [8, 16 .. 256]) $ fail "invalid size"
                return $ Just $ number `quot` 8 -- in bytes
              _ ->  fail "invalid size"

      return $ baseType number

-- | Parses array types, allowing arithmetic expressions to specify the
-- array length so long as they only reference explicit numbers.  Note that
-- for nested arrays, we have 'T[n][m] = (T[n])[m]' rather than '(T[m])[n]'
-- as in C.
arrayType :: SolidityParser SVMType.Type
arrayType = do
  baseElemType <- simpleType <|> mappingType
  sizeList <- many1 $ brackets $ optionMaybe intExpr
  return $ combine baseElemType sizeList
    where combine :: SVMType.Type -> [Maybe Word] -> SVMType.Type
          combine t [] = t
          combine t (l:ls) = combine (SVMType.Array t l) ls

-- | Parses mapping types, ignoring possible restrictions on what the
-- domain and codomain can be.
mappingType :: SolidityParser SVMType.Type
mappingType = do
  reserved "mapping"
  (mapDomT, mapCodT) <- parens $ do
    d <- simpleTypeExpression
    reservedOp "=>"
    c <- simpleTypeExpression
    return (d, c)
  return $ SVMType.Mapping (Just True) mapDomT mapCodT
