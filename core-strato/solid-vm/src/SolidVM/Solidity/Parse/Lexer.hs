-- |
-- Module: Lexer
-- Description: Parsers for various lexical elements of a Solidity source

{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

module SolidVM.Solidity.Parse.Lexer (
  parens,
  natural,
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
  solidityLanguage,
  whiteSpace
  ) where

import           Data.ByteString.Internal
import           Numeric
import           Text.Parsec
import           Text.Parsec.Language                 (javaStyle)
import qualified Text.Parsec.Token                    as P

import           SolidVM.Solidity.Parse.ParserTypes  (SolidityParser)

reserved = P.reserved solidityLexer
reservedOp = P.reservedOp solidityLexer
identifier = P.identifier solidityLexer
lexeme = P.lexeme solidityLexer
natural = P.natural solidityLexer
braces = P.braces solidityLexer
parens = P.parens solidityLexer
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

solidityLexer = P.makeTokenParser solidityLanguage

solidityLanguage = javaStyle {
  P.reservedNames = [
     "pragma", "import", "library", "using",
     "contract", "is", "public", "internal", "private", "external", "import", "payable",
     "event", "indexed", "anonymous",
     "bool", "true", "false",
     "uint", "int", "bytes", "byte", "real", "ureal", "string",
     "address", --"send", "balance",
     "enum", "struct", "mapping", "var",
     "function", "returns", "return", "modifier", "payable",
     "delete", "constant", "storage", "memory", "calldata",
     "if", "else", "while", "for", "break", "continue",
     "call", "callcode", "length", "sha3", "sha256", "ripemd160", "ecrecover",
     "suicide", "this",
     "block", --"coinbase", "difficulty", "gaslimit", "number", "blockhash", "timestamp", "now"
     "msg", --"data", "gas", "sender", "value",
     "tx", --"gasprice", "origin",
     "wei", "finney", "szabo", "ether",
     "seconds", "minutes", "hours", "days", "weeks", "years"
     ],
  P.reservedOpNames = [
    "!", "&&", "||", "==", "!=",
    "<=", ">=", "<", ">", "&", "|", "^", "~", "+", "*", "-", "/"," %", "**",
    "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "++", "--",
    "=>", "="
    ],
  P.caseSensitive = True,
  P.identStart = letter <|> char '_',
  P.nestedComments = False
  }


-------------------------


solidityStringLiteral :: SolidityParser String
solidityStringLiteral = lexeme $
  (between (char '"') (char '"' <?> "double quote") (many $ doubleQuoteStringChar))
  <|>
  (between (char '\'') (char '\'' <?> "single quote") (many $ singleQuoteStringChar))


singleQuoteStringChar :: SolidityParser Char
singleQuoteStringChar = singleQuoteStringLetter <|> stringEscape
                        <?> "string character"

doubleQuoteStringChar :: SolidityParser Char
doubleQuoteStringChar = doubleQuoteStringLetter <|> stringEscape
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
escapeCode = charEsc <|> hexChar <|> unicodeChar
             <?> "escape code"

hexChar :: SolidityParser Char
hexChar = do
  _ <- char 'x'
  d1 <- hexDigit
  d2 <- hexDigit
  let ((d, _):_) = readHex [d1,d2]
  return $ w2c d

unicodeChar :: SolidityParser Char
unicodeChar = do
  _ <- char 'u'
  d1 <- digit
  d2 <- digit
  d3 <- digit
  d4 <- digit
  let ((d, _):_) = readHex [d1,d2,d3,d4]
  return $ toEnum d

charEsc :: SolidityParser Char
charEsc = choice (map parseEsc escMap)
  where
    parseEsc (c,code) = do{ _ <- char c; return code }
    escMap = zip ("abfnrtv\\\"\'") ("\a\b\f\n\r\t\v\\\"\'")
