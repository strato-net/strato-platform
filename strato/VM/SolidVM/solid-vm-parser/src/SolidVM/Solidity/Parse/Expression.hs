{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

-- |
-- Module: Expression
-- Description: Parses simple arithmetic expressions that may appear in
-- array sizes.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module SolidVM.Solidity.Parse.Expression where

import Data.Functor.Identity
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec
import Text.Parsec.Expr

-- | Parses an arithmetic expression involving integer values and
-- operations
intExpr :: (Integral a) => SolidityParser a
intExpr = buildExpressionParser intTable intTerm

-- | Parses integers and parenthesized expressions
intTerm :: (Integral a) => SolidityParser a
intTerm = parens intTerm <|> fmap fromIntegral integer

-- | All the operations, with their associativities and corresponding
-- Haskell operations
intTable :: (Integral a) => OperatorTable String u Identity a
intTable =
  [ [prefix "-" negate, prefix "+" id],
    [binary "**" (^) AssocRight],
    [ binary "*" (*) AssocLeft,
      binary "/" div AssocLeft,
      binary "%" mod AssocLeft
    ],
    [binary "+" (+) AssocLeft, binary "-" (-) AssocLeft]
  ]

-- | Convenience function for specifying a binary operation
binary name fun = Infix (do reservedOp name; return fun)

-- | Convenience function for specifying a prefix operator
prefix name fun = Prefix (do reservedOp name; return fun)

-- | Convenience function for specifying a postfix operator
postfix name fun = Postfix (do reservedOp name; return fun)
