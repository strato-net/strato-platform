{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

-- |
-- Module: Lexer
-- Description: Parsers for various lexical elements of a Solidity source
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module BlockApps.Solidity.Parse.Lexer where

import Text.Parsec
import Text.Parsec.Language (javaStyle)
import qualified Text.Parsec.Token as P

reserved = P.reserved solidityLexer

reservedOp = P.reservedOp solidityLexer

identifier = P.identifier solidityLexer

lexeme = P.lexeme solidityLexer

natural = P.natural solidityLexer

braces = P.braces solidityLexer

parens = P.parens solidityLexer

brackets = P.brackets solidityLexer

commaSep = P.commaSep solidityLexer

commaSep1 = P.commaSep1 solidityLexer

dot = P.dot solidityLexer

semi = P.semi solidityLexer

semiSep = P.semiSep solidityLexer

semiSep1 = P.semiSep1 solidityLexer

stringLiteral = P.stringLiteral solidityLexer

whiteSpace = P.whiteSpace solidityLexer

solidityLexer = P.makeTokenParser solidityLanguage

solidityLanguage =
  javaStyle
    { P.reservedNames =
        [ "pragma",
          "import",
          "library",
          "using",
          "abstract",
          "contract",
          "is",
          "public",
          "internal",
          "private",
          "external",
          "import",
          "payable",
          "event",
          "indexed",
          "anonymous",
          "bool",
          "true",
          "false",
          "uint",
          "int",
          "bytes",
          "byte",
          "real",
          "ureal",
          "string",
          "address", --"send", "balance",
          "enum",
          "struct",
          "mapping",
          "var",
          "function",
          "returns",
          "return",
          "modifier",
          "delete",
          "constant",
          "storage",
          "memory",
          "calldata",
          "if",
          "else",
          "while",
          "for",
          "break",
          "continue",
          "call",
          "callcode",
          "length",
          "sha3",
          "sha256",
          "ripemd160",
          "ecrecover",
          "suicide",
          "this",
          "block", --"coinbase", "difficulty", "gaslimit", "number", "blockhash", "timestamp",
          "msg", --"data", "gas", "sender", "value",
          "tx", --"gasprice", "origin",
          "wei",
          "finney",
          "szabo",
          "ether",
          "now",
          "seconds",
          "minutes",
          "hours",
          "days",
          "weeks",
          "years"
        ],
      P.reservedOpNames =
        [ "!",
          "&&",
          "||",
          "==",
          "!=",
          "<=",
          ">=",
          "<",
          ">",
          "&",
          "|",
          "^",
          "~",
          "+",
          "*",
          "-",
          "/",
          " %",
          "**",
          "+=",
          "-=",
          "*=",
          "/=",
          "%=",
          "|=",
          "&=",
          "^=",
          "++",
          "--",
          "=>",
          "="
        ],
      P.caseSensitive = True,
      P.identStart = letter <|> char '_',
      P.nestedComments = False
    }
