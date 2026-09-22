{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
module SolidVM.Solidity.Parse.Types where

import Control.Monad
import Data.Int (Int32)
import Data.List
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Expression
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

--import SolidVM.Solidity.Parse.Lexer (identifier)

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names). Array dimensions may be
-- arithmetic expressions so long as they only reference explicit numbers.
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = do
  -- The dimensions are taken all-or-nothing: a rejected one leaves them all
  -- unread, as backtracking over the whole array type did, and 'quiet' keeps
  -- it out of the error, as that backtracking did.
  baseElemType <- simpleType <|> mappingType
  sizeList <- quiet (try (many1 $ brackets $ optionMaybe intExpr)) <|> return []
  return $ combine baseElemType sizeList

-- | Parses builtins and user-defined names. The leading word selects the one
-- alternative of 'anySimpleType' that can accept it (the keyword ones need
-- exactly that word, the suffixed ones that prefix); 'orElse' keeps the error
-- message identical when none does.
simpleType :: SolidityParser SVMType.Type
simpleType = do
  w <- peekWord
  case w of
    Nothing -> anySimpleType
    Just word -> byWord word `orElse` anySimpleType
  where
    byWord word
      | word == "bool" = simple "bool" SVMType.Bool
      | word == "address" = simple "address payable" (SVMType.Address True) <|> simple "address" (SVMType.Address False)
      | word == "string" = simple "string" (SVMType.String $ Just True)
      | word == "byte" = simple "byte" (SVMType.Bytes Nothing $ Just 1)
      | "bytes" `isPrefixOf` word = bytes' <|> unknownLabel
      | word == "decimal" = simple "decimal" SVMType.Decimal
      | "uint" `isPrefixOf` word = intSuffixed "uint" (SVMType.Int (Just False)) <|> unknownLabel
      | "int" `isPrefixOf` word = intSuffixed "int" (SVMType.Int (Just True)) <|> unknownLabel
      | word == "variadic" = simple "variadic" SVMType.Variadic
      | otherwise = unknownLabel
    -- @unknownLabelMemberParser <|> unknownLabelParser@ with the first
    -- identifier read once; 'quiet' keeps the absent dot out of the error.
    unknownLabel = do
      name <- identifier
      member <- optionMaybe $ quiet $ try $ dot *> identifier
      case member of
        Just m -> return $ SVMType.UnknownLabel (name ++ "." ++ m)
        Nothing -> do
          isUserDefined <- isInUserDefinedTypes name
          if isUserDefined
            then do
              typ <- getUserDefinedType name
              return $ (SVMType.UserDefined name (userTypeHelper' typ))
            else return $ (SVMType.UnknownLabel name)

anySimpleType :: SolidityParser SVMType.Type
anySimpleType =
  simple "bool" SVMType.Bool
    <|> simple "address payable" (SVMType.Address True)
    <|> simple "address" (SVMType.Address False)
    <|> simple "string" (SVMType.String $ Just True)
    <|> bytes'
    <|> simple "decimal" SVMType.Decimal
    <|> intSuffixed "uint" (SVMType.Int (Just False))
    <|> intSuffixed "int" (SVMType.Int (Just True))
    <|> simple "variadic" SVMType.Variadic
    <|> unknownLabelMemberParser
    <|> unknownLabelParser
  where
    unknownLabelParser = try $ do
      name <- identifier
      isUserDefined <- isInUserDefinedTypes name
      if isUserDefined
        then do
          typ <- getUserDefinedType name
          return $ (SVMType.UserDefined name (userTypeHelper' typ))
        else return $ (SVMType.UnknownLabel name)
    unknownLabelMemberParser = try $ do
      name <- concat <$> sequence [identifier, dot, identifier]
      return $ SVMType.UnknownLabel name

simple :: String -> SVMType.Type -> SolidityParser SVMType.Type
simple name nameType = do
  reserved name
  return nameType

bytes' :: SolidityParser SVMType.Type
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

intSuffixed :: String -> (Maybe Int32 -> SVMType.Type) -> SolidityParser SVMType.Type
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

-- | Builds an array type from its element type and dimensions. Note that
-- for nested arrays, we have 'T[n][m] = (T[n])[m]' rather than '(T[m])[n]'
-- as in C.
combine :: SVMType.Type -> [Maybe Word] -> SVMType.Type
combine t [] = t
combine t (l : ls) = combine (SVMType.Array t l) ls

-- | Parses mapping types, ignoring possible restrictions on what the
-- domain and codomain can be.
mappingType :: SolidityParser SVMType.Type
mappingType = do
  reserved "mapping"
  (mapDomT, keyName, mapCodT, valName) <- parens $ do
    d <- simpleTypeExpression
    kn <- optionMaybe identifier
    reservedOp "=>"
    c <- simpleTypeExpression
    vn <- optionMaybe identifier
    return (d, kn, c, vn)
  return $ SVMType.Mapping (Just True) mapDomT mapCodT keyName valName

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool") = SVMType.Bool
userTypeHelper' (Just "string") = SVMType.String $ Just True
userTypeHelper' (Just "int") = (SVMType.Int (Just True) Nothing)
userTypeHelper' (Just "uint") = (SVMType.Int (Just False) Nothing)
userTypeHelper' _ = SVMType.Bool --TODO fix this
