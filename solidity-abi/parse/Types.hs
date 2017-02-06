{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module Types where

import Data.Maybe
import Text.Parsec

import Expression
import Lexer
import ParserTypes

simpleTypeExpression :: SolidityParser SolidityBasicType
simpleTypeExpression = try arrayType <|> simpleType <|> mappingType

simpleType :: SolidityParser SolidityBasicType
simpleType =
  simple "bool" Boolean <|>
  simple "address" Address <|>
  simple "string" String <|>
  bytes' <|>
  intSuffixed "uint" UnsignedInt <|>
  intSuffixed "int"  SignedInt   <|>
  (fmap Typedef $ choice [
    identifier,
    concat <$> sequence [identifier, dot, identifier]
    ])
  where
    simple name nameType = do
      reserved name
      return nameType
    bytes' = -- To avoid shadowing another "bytes"
      simple "byte" (FixedBytes 1) <|>
      simple "bytes" DynamicBytes <|>
      (lexeme $ try $ do
        string "bytes"
        let sizesS = reverse $ map show [1::Int .. 32]
        size <- read <$> (choice $ map (try . string) sizesS)
        return $ FixedBytes size)
    intSuffixed base baseType = lexeme $ try $ do
      string base
      let sizesS = reverse $ map show [8::Int, 16 .. 256]
      sizeM <- optionMaybe $ choice $ map (try . string) sizesS
      let size = read $ fromMaybe (head sizesS) sizeM
      return $ baseType (size `quot` 8) -- in bytes

arrayType :: SolidityParser SolidityBasicType
arrayType = do
  baseElemType <- simpleType <|> mappingType
  sizeList <- many1 $ brackets $ optionMaybe intExpr
  return $ makeArrayType baseElemType sizeList
  where
    makeArrayType = foldl (\t -> maybe (DynamicArray t) (FixedArray t))

mappingType :: SolidityParser SolidityBasicType
mappingType = do
  reserved "mapping"
  (mapDomT, mapCodT) <- parens $ do
    d <- simpleTypeExpression
    reservedOp "=>"
    c <- simpleTypeExpression
    return (d, c)
  return $ Mapping mapDomT mapCodT
