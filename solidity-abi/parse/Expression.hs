{-# OPTIONS_GHC -fno-warn-missing-signatures #-}
module Expression where

import Text.Parsec
import Text.Parsec.Expr

import Data.Functor.Identity

import Lexer
import ParserTypes

intExpr :: (Integral a) => SolidityParser a
intExpr = buildExpressionParser intTable intTerm

intTerm :: (Integral a) => SolidityParser a
intTerm =  parens intTerm <|> fmap fromIntegral natural

intTable :: (Integral a) => OperatorTable String u Identity a
intTable = [ [prefix "-" negate, prefix "+" id ],
             [binary "**" (^) AssocRight],
             [binary "*" (*) AssocLeft,
              binary "/" (div) AssocLeft,
              binary "%" (mod) AssocLeft],
             [binary "+" (+) AssocLeft, binary "-" (-) AssocLeft ]]
         
binary  name fun assoc = Infix (do{ reservedOp name; return fun }) assoc
prefix  name fun       = Prefix (do{ reservedOp name; return fun })
postfix name fun       = Postfix (do{ reservedOp name; return fun })
