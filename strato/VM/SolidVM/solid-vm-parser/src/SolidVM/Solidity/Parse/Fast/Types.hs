{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Types
-- Description: Type expressions
module SolidVM.Solidity.Parse.Fast.Types
  ( simpleTypeExpression,
    simpleType,
  )
where

import Data.Char (isDigit)
import Data.Int (Int32)
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes

-- | A type with its array dimensions: @T[n][m]@ is @(T[n])[m]@. A dimension
-- may be an arithmetic expression over number literals.
simpleTypeExpression :: P SVMType.Type
simpleTypeExpression = simpleTypeExpression' <?> "type"

simpleTypeExpression' :: P SVMType.Type
simpleTypeExpression' = do
  base <- simpleType <|> mappingType
  sizes <- many (brackets (optionMaybe intExpr))
  pure (foldl SVMType.Array base sizes)

-- | A builtin type or a user-defined name (@Name@ or @Contract.Name@).
simpleType :: P SVMType.Type
simpleType = do
  t <- peek
  case builtin (tText t) of
    Just ty | tKind t == TWord -> do
      _ <- anyWord
      if ty == SVMType.Address False
        then option ty (SVMType.Address True <$ reserved "payable")
        else pure ty
    _ -> userType

builtin :: Text -> Maybe SVMType.Type
builtin w = case w of
  "bool" -> Just SVMType.Bool
  "address" -> Just (SVMType.Address False)
  "string" -> Just (SVMType.String (Just True))
  "byte" -> Just (SVMType.Bytes Nothing (Just 1))
  "bytes" -> Just (SVMType.Bytes (Just True) Nothing)
  "decimal" -> Just SVMType.Decimal
  "variadic" -> Just SVMType.Variadic
  "uint" -> Just (SVMType.Int (Just False) Nothing)
  "int" -> Just (SVMType.Int (Just True) Nothing)
  _
    | Just n <- sized "uint", n `elem` [8, 16 .. 256] -> Just (SVMType.Int (Just False) (Just (n `quot` 8)))
    | Just n <- sized "int", n `elem` [8, 16 .. 256] -> Just (SVMType.Int (Just True) (Just (n `quot` 8)))
    | Just n <- sized "bytes", n >= 1 && n <= 32 -> Just (SVMType.Bytes Nothing (Just n))
    | otherwise -> Nothing
  where
    sized :: Text -> Maybe Int32
    sized base = do
      digits <- T.stripPrefix base w
      if not (T.null digits) && T.length digits <= 3 && T.all isDigit digits
        then Just (fromIntegral (T.foldl' (\n c -> n * 10 + fromEnum c - fromEnum '0') 0 digits))
        else Nothing

userType :: P SVMType.Type
userType = do
  name <- identifier
  member <- optionMaybe (sym "." *> identifier)
  case member of
    Just m -> pure (SVMType.UnknownLabel (name ++ "." ++ m))
    Nothing -> do
      aliases <- userDefinedTypes <$> getSt
      pure $ case Map.lookup name aliases of
        Just alias -> SVMType.UserDefined name (userTypeHelper' (Just alias))
        Nothing -> SVMType.UnknownLabel name

mappingType :: P SVMType.Type
mappingType = do
  reserved "mapping"
  parens $ do
    dom <- simpleTypeExpression
    keyName <- optionMaybe identifier
    sym "=>"
    cod <- simpleTypeExpression
    valName <- optionMaybe identifier
    pure (SVMType.Mapping (Just True) dom cod keyName valName)

-- | An array dimension: @+ - * / % **@ and parentheses over number literals.
intExpr :: P Word
intExpr = fromInteger <$> sums
  where
    sums = chainl1 products (((+) <$ sym "+") <|> ((-) <$ sym "-"))
    products = chainl1 powers (((*) <$ sym "*") <|> (div <$ sym "/") <|> (mod <$ sym "%"))
    powers = do
      x <- signed
      (sym "**" >> (x ^) <$> powers) <|> pure x
    signed = (sym "-" >> negate <$> atom) <|> (sym "+" >> atom) <|> atom
    atom = parens sums <|> integer

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool") = SVMType.Bool
userTypeHelper' (Just "string") = SVMType.String $ Just True
userTypeHelper' (Just "int") = SVMType.Int (Just True) Nothing
userTypeHelper' (Just "uint") = SVMType.Int (Just False) Nothing
userTypeHelper' _ = SVMType.Bool --TODO fix this
