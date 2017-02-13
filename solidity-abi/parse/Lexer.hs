{-# OPTIONS_GHC -fno-warn-missing-signatures #-}
module Lexer where

import Text.Parsec
import Text.Parsec.Language (javaStyle)
import qualified Text.Parsec.Token as P

import ParserTypes

bracedCode :: SolidityParser String
bracedCode = braces $ fmap concat $ many $ (many1 $ noneOf "{}") <|> do
  innerBraces <- bracedCode
  return $ "{" ++ innerBraces ++ "}"

parensCode :: SolidityParser String
parensCode = parens $ fmap concat $ many $ (many1 $ noneOf "()") <|> do
  innerParens <- parensCode
  return $ "(" ++ innerParens ++ ")"

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

solidityLanguage = javaStyle {
  P.reservedNames = [
     "import", "library", "using",
     "contract", "is", "public", "internal", "private", "external", "import",
     "event", "indexed", "anonymous",
     "bool", "true", "false",
     "uint", "int", "bytes", "byte", "real", "ureal", "string",
     "address", --"send", "balance",
     "enum", "struct", "mapping", "var",
     "function", "returns", "return", "modifier",
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
  P.identStart = letter <|> char '_'
  }
