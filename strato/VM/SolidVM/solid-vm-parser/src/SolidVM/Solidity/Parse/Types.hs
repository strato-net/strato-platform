{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
module SolidVM.Solidity.Parse.Types where

import Control.Monad
import Data.Char (isDigit)
import Data.List
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Expression
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec
import qualified Text.Parsec.Token as P

--import SolidVM.Solidity.Parse.Lexer (identifier)

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = do
  baseElemType <- mappingType <|> simpleType
  sizeList <- many $ brackets $ optionMaybe intExpr
  pure $ combineArrayType baseElemType sizeList

-- | Parses builtins and user-defined names
simpleType :: SolidityParser SVMType.Type
simpleType = try $ do
  name <- rawIdentifier
  case name of
    "bool" -> pure SVMType.Bool
    "address" -> do
      payable <- option False $ True <$ reserved "payable"
      pure $ SVMType.Address payable
    "string" -> pure $ SVMType.String $ Just True
    "byte" -> pure $ SVMType.Bytes Nothing $ Just 1
    "bytes" -> pure $ SVMType.Bytes (Just True) Nothing
    "decimal" -> pure SVMType.Decimal
    "uint" -> pure $ SVMType.Int (Just False) Nothing
    "int" -> pure $ SVMType.Int (Just True) Nothing
    "variadic" -> pure SVMType.Variadic
    _
      | Just size <- sizedName "bytes" [1 .. 32] name -> pure $ SVMType.Bytes Nothing (Just size)
      | Just size <- sizedName "uint" [8, 16 .. 256] name -> pure $ SVMType.Int (Just False) (Just $ size `quot` 8)
      | Just size <- sizedName "int" [8, 16 .. 256] name -> pure $ SVMType.Int (Just True) (Just $ size `quot` 8)
      | name `elem` P.reservedNames solidityLanguage -> unexpected $ "reserved word " ++ show name
      | otherwise -> do
          member <- optionMaybe . try $ dot *> identifier
          case member of
            Just memberName -> pure $ SVMType.UnknownLabel $ name ++ "." ++ memberName
            Nothing -> do
              isUserDefined <- isInUserDefinedTypes name
              if isUserDefined
                then SVMType.UserDefined name . userTypeHelper' <$> getUserDefinedType name
                else pure $ SVMType.UnknownLabel name
  where
    sizedName typePrefix validSizes candidate = do
      suffix <- stripPrefix typePrefix candidate
      guard $ not $ null suffix
      guard $ all isDigit suffix
      size <- readMaybeExact suffix
      guard $ size `elem` validSizes
      pure size

    readMaybeExact digits = case reads digits of
      [(number, "")] -> Just number
      _ -> Nothing

-- | Parses array types, allowing arithmetic expressions to specify the
-- array length so long as they only reference explicit numbers.  Note that
-- for nested arrays, we have 'T[n][m] = (T[n])[m]' rather than '(T[m])[n]'
-- as in C.
arrayType :: SolidityParser SVMType.Type
arrayType = do
  baseElemType <- mappingType <|> simpleType
  sizeList <- many1 $ brackets $ optionMaybe intExpr
  return $ combineArrayType baseElemType sizeList

combineArrayType :: SVMType.Type -> [Maybe Word] -> SVMType.Type
combineArrayType t [] = t
combineArrayType t (l : ls) = combineArrayType (SVMType.Array t l) ls

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
