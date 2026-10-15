{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Types
-- Description: Type expressions
module SolidVM.Solidity.Parse.Fast.Types
  ( simpleTypeExpression,
    simpleType,
    builtin,
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
  t <- peek
  base <- if isWord "mapping" t then mappingType else simpleType
  sizes <- manyWhile (isSym "[") (sym "[" *> optionalIf (not . isSym "]") intExpr <* sym "]")
  pure (foldl SVMType.Array base sizes)

-- | A builtin type or a user-defined name (@Name@ or @Contract.Name@).
simpleType :: P SVMType.Type
simpleType = do
  t <- peek
  case builtin (tText t) of
    Just ty | tKind t == TWord -> do
      skip
      if ty == SVMType.Address False
        then do
          payable <- optionalWord "payable"
          pure (if payable then SVMType.Address True else ty)
        else pure ty
    _ -> userType

-- | Dispatches on the first letter, so most identifiers are rejected at once.
builtin :: Text -> Maybe SVMType.Type
builtin w
  | T.null w = Nothing
  | otherwise = case T.head w of
    'b' -> case w of
      "bool" -> Just SVMType.Bool
      "byte" -> Just (SVMType.Bytes Nothing (Just 1))
      "bytes" -> Just (SVMType.Bytes (Just True) Nothing)
      _ | Just n <- sized "bytes", n >= 1 && n <= 32 -> Just (SVMType.Bytes Nothing (Just n))
      _ -> Nothing
    'a' | w == "address" -> Just (SVMType.Address False)
    's' | w == "string" -> Just (SVMType.String (Just True))
    'd' | w == "decimal" -> Just SVMType.Decimal
    'v' | w == "variadic" -> Just SVMType.Variadic
    'u' -> case w of
      "uint" -> Just (SVMType.Int (Just False) Nothing)
      _ | Just n <- sized "uint", bits n -> Just (SVMType.Int (Just False) (Just (n `quot` 8)))
      _ -> Nothing
    'i' -> case w of
      "int" -> Just (SVMType.Int (Just True) Nothing)
      _ | Just n <- sized "int", bits n -> Just (SVMType.Int (Just True) (Just (n `quot` 8)))
      _ -> Nothing
    _ -> Nothing
  where
    bits n = n >= 8 && n <= 256 && n `rem` 8 == 0
    sized :: Text -> Maybe Int32
    sized base = do
      digits <- T.stripPrefix base w
      if not (T.null digits) && T.length digits <= 3 && T.all isDigit digits
        then Just (fromIntegral (T.foldl' (\n c -> n * 10 + fromEnum c - fromEnum '0') 0 digits))
        else Nothing

userType :: P SVMType.Type
userType = do
  name <- identifier
  member <- afterSym "." identifier
  case member of
    Just m -> pure (SVMType.UnknownLabel (name <> "." <> m))
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
    keyName <- optionalIdentifier
    sym "=>"
    cod <- simpleTypeExpression
    valName <- optionalIdentifier
    pure (SVMType.Mapping (Just True) dom cod keyName valName)

-- | An array dimension: @+ - * / % **@ and parentheses over number literals.
-- Division by zero and a negative exponent are rejected here rather than
-- left in the tree.
intExpr :: P Word
intExpr = fromInteger <$> sums
  where
    sums = products >>= more
      where
        more x = do
          t <- peek
          if
            | isSym "+" t -> skip *> products >>= more . (x +)
            | isSym "-" t -> skip *> products >>= more . (x -)
            | otherwise -> pure x
    products = powers >>= more
      where
        more x = do
          t <- peek
          if
            | isSym "*" t -> skip *> powers >>= more . (x *)
            | isSym "/" t -> skip *> (powers >>= nonZero) >>= more . div x
            | isSym "%" t -> skip *> (powers >>= nonZero) >>= more . mod x
            | otherwise -> pure x
        nonZero 0 = failWith "division by zero in an array size"
        nonZero y = pure y
    powers = do
      x <- signed
      t <- peek
      if isSym "**" t
        then do
          skip
          y <- powers
          if y < 0 then failWith "negative exponent in an array size" else pure (x ^ y)
        else pure x
    signed = do
      t <- peek
      if
        | isSym "-" t -> skip *> (negate <$> atom)
        | isSym "+" t -> skip *> atom
        | otherwise -> atom
    atom = do
      t <- peek
      if isSym "(" t then parens sums else integer

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool") = SVMType.Bool
userTypeHelper' (Just "string") = SVMType.String $ Just True
userTypeHelper' (Just "int") = SVMType.Int (Just True) Nothing
userTypeHelper' (Just "uint") = SVMType.Int (Just False) Nothing
userTypeHelper' _ = SVMType.Bool --TODO fix this
