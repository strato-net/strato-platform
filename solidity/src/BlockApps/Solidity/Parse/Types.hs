-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Types where

import Data.Maybe
import Text.Parsec

import BlockApps.Solidity.Parse.Expression
import BlockApps.Solidity.Parse.Lexer
import BlockApps.Solidity.Parse.ParserTypes

import qualified BlockApps.Solidity.Xabi.Type as Xabitype

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser Xabitype.Type
simpleTypeExpression = do
  try arrayType <|> simpleType <|> mappingType

-- | Parses builtins and user-defined names
simpleType :: SolidityParser Xabitype.Type
simpleType =
  simple "bool" Xabitype.Bool <|>
  simple "address" Xabitype.Address <|>
  simple "string" (Xabitype.String $ Just True) <|>
  bytes' <|>
  intSuffixed "uint"  (Xabitype.Int (Just False) . Just) <|>
  intSuffixed "int"  (Xabitype.Int (Just True) . Just) <|>
  Xabitype.Label <$>
    choice [
      identifier,
      concat <$> sequence [identifier, dot, identifier]
    ]
  where
    simple name nameType = do
      reserved name
      return nameType
    bytes' = -- To avoid shadowing another "bytes"
      simple "byte" (Xabitype.Bytes Nothing $ Just 1) <|>
      simple "bytes" (Xabitype.Bytes (Just True) Nothing) <|>
      lexeme (try $ do
        string "bytes"
        let sizesS = reverse $ map show [1::Int .. 32]
        size <- read <$> choice (map (try . string) sizesS)
        return $ Xabitype.Bytes Nothing $ Just size
      ) 
    intSuffixed base baseType = lexeme $ try $ do
      string base
      let sizesS = reverse $ map show [8::Int, 16 .. 256]
      sizeM <- optionMaybe $ choice $ map (try . string) sizesS
      let size = read $ fromMaybe (head sizesS) sizeM
      return $ baseType (size `quot` 8) -- in bytes 

-- | Parses array types, allowing arithmetic expressions to specify the
-- array length so long as they only reference explicit numbers.  Note that
-- for nested arrays, we have 'T[n][m] = (T[n])[m]' rather than '(T[m])[n]'
-- as in C.
arrayType :: SolidityParser Xabitype.Type
arrayType = do
  baseElemType <- simpleType <|> mappingType
  sizeList <- many1 $ brackets $ optionMaybe intExpr
  return $ makeArrayType baseElemType (sizeList::[Maybe Integer])
  where
    makeArrayType = foldl (\t -> maybe (Xabitype.Array (Just True) Nothing t) ((flip (Xabitype.Array Nothing)) t . Just . fromIntegral))

-- | Parses mapping types, ignoring possible restrictions on what the
-- domain and codomain can be.
mappingType :: SolidityParser Xabitype.Type
mappingType = do
  reserved "mapping"
  (mapDomT, mapCodT) <- parens $ do
    d <- simpleTypeExpression
    reservedOp "=>"
    c <- simpleTypeExpression
    return (d, c)
  return $ Xabitype.Mapping (Just True) mapDomT mapCodT

