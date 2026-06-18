{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

-- |
-- Module: Lexer
-- Description: Parsers for various lexical elements of a Solidity source
module SolidVM.Solidity.Parse.Lexer
  ( parens,
    natural,
    integer,
    reservedOp,
    brackets,
    reserved,
    lexeme,
    dot,
    identifier,
    stringLiteral,
    commaSep1,
    commaSep,
    semi,
    colon,
    comma,
    braces,
    symbol,
    solidityLanguage,
    whiteSpace,
    boundedNoneOf,
  )
where

import Data.ByteString.Internal
import Numeric
import SolidVM.Solidity.Parse.ParserTypes (SolidityParser)
import Text.Parsec
import Text.Parsec.Language (javaStyle)
import qualified Text.Parsec.Token as P

reserved = P.reserved solidityLexer

reservedOp = P.reservedOp solidityLexer

identifier = P.identifier solidityLexer

lexeme = P.lexeme solidityLexer

natural = P.natural solidityLexer

integer = P.integer solidityLexer

braces = P.braces solidityLexer

parens = P.parens solidityLexer

symbol = P.symbol solidityLexer

brackets = P.brackets solidityLexer

comma = P.comma solidityLexer

commaSep = P.commaSep solidityLexer

commaSep1 = P.commaSep1 solidityLexer

dot = P.dot solidityLexer

semi = P.semi solidityLexer

colon = P.colon solidityLexer

--semiSep = P.semiSep solidityLexer
--semiSep1 = P.semiSep1 solidityLexer
stringLiteral :: SolidityParser String
stringLiteral = solidityStringLiteral

whiteSpace = P.whiteSpace solidityLexer

-- | Consume up to @maxLen@ characters that are not in @forbidden@, then fail
-- with a descriptive error if the limit is reached before the expected
-- delimiter appears. Prevents unbounded allocation in parsers that used
-- 'many (noneOf ";")' (audit findings 30/31).
boundedNoneOf :: Int -> String -> SolidityParser String
boundedNoneOf maxLen forbidden = go maxLen
  where
    go :: Int -> SolidityParser String
    go 0 = unexpected "input too long while scanning for delimiter"
    go n = (noneOf forbidden >>= \c -> (c :) <$> go (n - 1)) <|> pure ""

solidityLexer = P.makeTokenParser solidityLanguage

solidityLanguage =
  javaStyle
    { P.reservedNames =
        [ "pragma",
          "import",
          "library",
          "using",
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
          "decimal",
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
          "revert",
          "delete",
          "constant",
          "storage",
          "memory",
          "calldata",
          "immutable",
          "if",
          "else",
          "while",
          "for",
          "break",
          "continue",
          "suicide",
          "this",
          "call",
          "callcode",
          "length",
          "sha3",
          "block", --"coinbase", "difficulty", "gaslimit", "number", "blockhash", "timestamp", "now"
          "msg", --"data", "gas", "sender", "value",
          "tx", --"gasprice", "origin",
          "record",
          "wei",
          "finney",
          "szabo",
          "ether",
          "seconds",
          "minutes",
          "hours",
          "days",
          "weeks",
          "years",
          --The following are protected as they are also names for cirrus columns
          --"block_number", "block_timestamp", "block_hash",
          --"transaction_hash", "transaction_sender"
          "receive",
          "fallback",
          "virtual",
          "override",
          "global"
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
          ">>=",
          "<<=",
          "^=",
          "++",
          "--",
          "hex",
          "=>",
          "="
        ],
      P.caseSensitive = True,
      P.identStart = letter <|> oneOf "$_",
      P.identLetter = alphaNum <|> oneOf "$_",
      P.nestedComments = False,
      P.opStart  = oneOf ":!#%&*+./<=>?@\\^|-~",
      P.opLetter = oneOf ":!#%&*+./<=>?@\\^|-~"
    }

-------------------------

solidityStringLiteral :: SolidityParser String
solidityStringLiteral =
  lexeme $
    (between (char '"') (char '"' <?> "double quote") (many $ doubleQuoteStringChar))
      <|> (between (char '\'') (char '\'' <?> "single quote") (many $ singleQuoteStringChar))

singleQuoteStringChar :: SolidityParser Char
singleQuoteStringChar =
  singleQuoteStringLetter <|> stringEscape
    <?> "string character"

doubleQuoteStringChar :: SolidityParser Char
doubleQuoteStringChar =
  doubleQuoteStringLetter <|> stringEscape
    <?> "string character"

singleQuoteStringLetter :: SolidityParser Char
singleQuoteStringLetter = satisfy (\c -> (c /= '\'') && (c /= '\\'))

doubleQuoteStringLetter :: SolidityParser Char
doubleQuoteStringLetter = satisfy (\c -> (c /= '"') && (c /= '\\'))

stringEscape :: SolidityParser Char
stringEscape = do
  _ <- char '\\'
  escapeCode

escapeCode :: SolidityParser Char
escapeCode =
  charEsc <|> hexChar <|> unicodeChar
    <?> "escape code"

hexChar :: SolidityParser Char
hexChar = do
  _ <- char 'x'
  d1 <- hexDigit
  d2 <- hexDigit
  case readHex [d1, d2] of
    ((d', _) : _) -> pure $ w2c d'
    _ -> fail "malformed \\x hex escape"

unicodeChar :: SolidityParser Char
unicodeChar = do
  _ <- char 'u'
  d1 <- digit
  d2 <- digit
  d3 <- digit
  d4 <- digit
  case readHex [d1, d2, d3, d4] of
    ((d', _) : _) -> pure $ toEnum d'
    _ -> fail "malformed \\u unicode escape"

charEsc :: SolidityParser Char
charEsc = choice (map parseEsc escMap)
  where
    parseEsc (c, code) = do _ <- char c; return code
    escMap = zip ("abfnrtv\\\"\'") ("\a\b\f\n\r\t\v\\\"\'")
