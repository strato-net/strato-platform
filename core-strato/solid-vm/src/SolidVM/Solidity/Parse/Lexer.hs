-- |
-- Module: Lexer
-- Description: Parsers for various lexical elements of a Solidity source

{-# LANGUAGE FlexibleContexts #-}

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
--semiSep = P.semiSep solidityLexer
--semiSep1 = P.semiSep1 solidityLexer
stringLiteral :: Stream s m Char =>
                 ParsecT s u m String
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
     "block", --"coinbase", "difficulty", "gaslimit", "number", "blockhash", "timestamp",
     "msg", --"data", "gas", "sender", "value",
     "tx", --"gasprice", "origin",
     "wei", "finney", "szabo", "ether",
     "now", "seconds", "minutes", "hours", "days", "weeks", "years"
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


solidityStringLiteral :: Stream s m Char =>
                         ParsecT s u m String
solidityStringLiteral = 
  (between (char '"') (char '"' <?> "double quote") (many $ doubleQuoteStringChar))
  <|>
  (between (char '\'') (char '\'' <?> "single quote") (many $ singleQuoteStringChar))


singleQuoteStringChar :: Stream s m Char =>
                         ParsecT s u m Char
singleQuoteStringChar = singleQuoteStringLetter <|> stringEscape
                        <?> "string character"

doubleQuoteStringChar :: Stream s m Char =>
                         ParsecT s u m Char
doubleQuoteStringChar = doubleQuoteStringLetter <|> stringEscape
                        <?> "string character"

singleQuoteStringLetter :: Stream s m Char =>
                           ParsecT s u m Char
singleQuoteStringLetter = satisfy (\c -> (c /= '\'') && (c /= '\\'))

doubleQuoteStringLetter :: Stream s m Char =>
                           ParsecT s u m Char
doubleQuoteStringLetter = satisfy (\c -> (c /= '"') && (c /= '\\'))

stringEscape :: Stream s m Char =>
                ParsecT s u m Char
stringEscape = do
  _ <- char '\\'
  escapeCode

escapeCode :: Stream s m Char =>
              ParsecT s u m Char
escapeCode = charEsc <|> hexChar <|> unicodeChar
             <?> "escape code"

hexChar :: Stream s m Char =>
           ParsecT s u m Char
hexChar = do
  _ <- char 'x'
  d1 <- hexDigit
  d2 <- hexDigit
  let ((d, _):_) = readHex [d1,d2]
  return $ w2c d

unicodeChar :: Stream s m Char =>
               ParsecT s u m Char
unicodeChar = do
  _ <- char 'u'
  d1 <- digit
  d2 <- digit
  d3 <- digit
  d4 <- digit
  let ((d, _):_) = readHex [d1,d2,d3,d4]
  return $ toEnum d

charEsc :: Stream s m Char =>
           ParsecT s u m Char
charEsc = choice (map parseEsc escMap)
  where
    parseEsc (c,code) = do{ _ <- char c; return code }
    escMap = zip ("abfnrtv\\\"\'") ("\a\b\f\n\r\t\v\\\"\'")
