{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
module SolidVM.Solidity.Parse.Types where

import Control.Monad
import Data.List
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Expression
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

--import SolidVM.Solidity.Parse.Lexer (identifier)

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = try arrayType <|> simpleType <|> mappingType -- <|> userType

-- | Parses builtins and user-defined names
simpleType :: SolidityParser SVMType.Type
simpleType =
  simple "bool" SVMType.Bool
    <|> simple "address payable" (SVMType.Address True)
    <|> simple "address" (SVMType.Address False)
    <|> simple "account payable" (SVMType.Account True)
    <|> simple "account" (SVMType.Account False)
    <|> simple "string" (SVMType.String $ Just True)
    <|> bytes'
    <|> simple "decimal" SVMType.Decimal
    <|> intSuffixed "uint" (SVMType.Int (Just False))
    <|> intSuffixed "int" (SVMType.Int (Just True))
    <|> simple "variadic" SVMType.Variadic
    <|> choice [saltParser, unknownLabelParser, unknownLabelMemberParser]
  where
    saltParser = try $ do
      name <- identifier
      salt <- braces $ do
        reserved "salt"
        colon
        let myReallyGoodParser = do
              myStr <- stringLiteral
              return ("\"" ++ myStr ++ "\"")
        identifier <|> myReallyGoodParser
      return $ SVMType.UnknownLabel name $ Just salt
    unknownLabelParser = try $ do
      name <- identifier
      isUserDefined <- isInUserDefinedTypes name
      if isUserDefined
        then do
          typ <- getUserDefinedType name
          return $ (SVMType.UserDefined name (userTypeHelper' typ))
        else return $ (SVMType.UnknownLabel name Nothing)
    unknownLabelMemberParser = try $ do
      name <- concat <$> sequence [identifier, dot, identifier]
      return $ SVMType.UnknownLabel name Nothing
    simple name nameType = do
      reserved name
      return nameType
    bytes' =
      -- To avoid shadowing another "bytes"
      simple "byte" (SVMType.Bytes Nothing $ Just 1)
        <|> simple "bytes" (SVMType.Bytes (Just True) Nothing)
        <|> lexeme
          ( try $ do
              let base = "bytes"
              chars <- many1 alphaNum

              when (not (base `isPrefixOf` chars)) $ fail "missing 'bytes'"

              size <-
                case reads (drop (length base) chars) of
                  [] -> return Nothing
                  [(number, "")] -> do
                    when (not $ number `elem` [1 .. 32]) $ fail "invalid bytes size"
                    return $ Just number
                  _ -> fail "invalid bytes size"

              return $ SVMType.Bytes Nothing size
          )
    intSuffixed base baseType = lexeme $
      try $ do
        chars <- many1 alphaNum

        when (not (base `isPrefixOf` chars)) $ fail "missing base"

        number <-
          case reads (drop (length base) chars) of
            [] -> return Nothing
            [(number, "")] -> do
              when (not $ number `elem` [8, 16 .. 256]) $ fail "invalid size"
              return $ Just $ number `quot` 8 -- in bytes
            _ -> fail "invalid size"

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
  where
    combine :: SVMType.Type -> [Maybe Word] -> SVMType.Type
    combine t [] = t
    combine t (l : ls) = combine (SVMType.Array t l) ls

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

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool") = SVMType.Bool
userTypeHelper' (Just "string") = SVMType.String $ Just True
userTypeHelper' (Just "int") = (SVMType.Int (Just True) Nothing)
userTypeHelper' (Just "uint") = (SVMType.Int (Just False) Nothing)
userTypeHelper' _ = SVMType.Bool --TODO fix this
