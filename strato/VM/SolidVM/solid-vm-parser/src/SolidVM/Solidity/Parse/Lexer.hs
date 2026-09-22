{-# LANGUAGE BangPatterns #-}
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
    peekWord,
    peekOp,
    orElse,
    quiet,
  )
where

import Data.ByteString.Internal
import Data.Char (isAlpha, isAlphaNum, isSpace)
import Data.List (foldl')
import qualified Data.Set as Set
import Numeric
import SolidVM.Solidity.Parse.ParserTypes (SolidityParser)
import Text.Parsec
import Text.Parsec.Language (javaStyle)
import Text.Parsec.Error (newErrorUnknown)
import Text.Parsec.Pos (updatePosChar)
import qualified Text.Parsec.Token as P

-- The token parsers below are parsec's own definitions (Text.Parsec.Token,
-- 3.1.17), restated here so that they use this module's 'whiteSpace' and
-- 'ident', which take whole runs of characters in one step where parsec takes
-- them one at a time. Their errors are unchanged: each still ends by running
-- the parsec parser it stands in for at the point where that parser stops.

reserved :: String -> SolidityParser ()
reserved name =
  lexeme $ try $ do
    _ <- string name
    notFollowedBy (P.identLetter solidityLanguage) <?> ("end of " ++ show name)

reservedOp :: String -> SolidityParser ()
reservedOp name =
  lexeme $ try $ do
    _ <- string name
    notFollowedBy (P.opLetter solidityLanguage) <?> ("end of " ++ show name)

-- Same as 'P.identifier', with the reserved-word test as a 'Set' lookup
-- instead of parsec's linear scan over the sorted list.
identifier :: SolidityParser String
identifier = lexeme $ try $ do
  name <- ident
  if Set.member name reservedNames
    then unexpected ("reserved word " ++ show name)
    else return name

-- | @identStart@ then @many identLetter@ of 'solidityLanguage', as one span
-- of the input. The parsec character parsers still run where the span starts
-- (if it is empty) and where it ends, so the errors are theirs.
ident :: SolidityParser String
ident = ((span1 isIdentStart isIdentLetter <|> ([] <$ P.identStart solidityLanguage)) <* many (P.identLetter solidityLanguage)) <?> "identifier"

-- | The predicates behind 'solidityLanguage''s @identStart@ (@letter <|> oneOf "$_"@)
-- and @identLetter@ (@alphaNum <|> oneOf "$_"@).
isIdentStart, isIdentLetter :: Char -> Bool
isIdentStart c = isAlpha c || c == '$' || c == '_'
isIdentLetter c = isAlphaNum c || c == '$' || c == '_'

-- | Consumes a character satisfying @isStart@ and then every following one
-- satisfying @isLetter@, in one parser step. Fails, consuming nothing and
-- saying nothing, if the first character does not satisfy @isStart@.
span1 :: (Char -> Bool) -> (Char -> Bool) -> SolidityParser String
span1 isStart isLetter = mkPT $ \s -> pure $ case stateInput s of
  c : cs
    | isStart c ->
        let (w, rest) = span isLetter cs
            word = c : w
            pos = foldl' updatePosChar (statePos s) word
         in Consumed (pure (Ok word (State rest pos (stateUser s)) (newErrorUnknown pos)))
  _ -> Empty (pure (Error (unknownError s)))

reservedNames :: Set.Set String
reservedNames = Set.fromList (P.reservedNames solidityLanguage)

-- | The identifier-shaped word at the current position, without consuming it;
-- 'Nothing' if the next character cannot start an identifier. Lets a parser
-- pick the one alternative that can match instead of trying each in turn.
peekWord :: SolidityParser (Maybe String)
peekWord = lookAhead (optionMaybe ident)

-- | The operator token at the current position, without consuming it: the
-- longest run of operator characters. @reservedOp o@ succeeds exactly when
-- this equals @o@, so one look decides which operator, if any, follows.
peekOp :: SolidityParser (Maybe String)
peekOp = lookAhead (optionMaybe ((:) <$> P.opStart solidityLanguage <*> many (P.opLetter solidityLanguage)))

-- | @fast `orElse` slow@ runs @fast@; if it fails without consuming input, its
-- error is discarded and @slow@ runs from the same position. When @fast@ is a
-- subset of @slow@'s alternatives, the result — including the error message
-- on failure — is exactly that of @slow@, because a consuming success or
-- failure never merges with the alternatives that were skipped.
orElse :: SolidityParser a -> SolidityParser a -> SolidityParser a
fast `orElse` slow = quiet fast <|> slow

-- | @quiet p@ is @p@ with a non-consuming failure's message erased, so it
-- merges into nothing. Used where an optional part must not add its
-- "expecting" to a later error, as the original alternatives did not.
quiet :: SolidityParser a -> SolidityParser a
quiet p = mkPT $ \s -> do
  r <- runParsecT p s
  pure $ case r of
    Empty mr -> Empty $ do
      rep <- mr
      pure $ case rep of
        Error _ -> Error (unknownError s)
        ok -> ok
    consumed -> consumed

lexeme :: SolidityParser a -> SolidityParser a
lexeme p = do
  x <- p
  whiteSpace
  return x

natural = P.natural solidityLexer

integer = P.integer solidityLexer

braces :: SolidityParser a -> SolidityParser a
braces p = between (symbol "{") (symbol "}") p

parens :: SolidityParser a -> SolidityParser a
parens p = between (symbol "(") (symbol ")") p

symbol :: String -> SolidityParser String
symbol name = lexeme (string name)

brackets :: SolidityParser a -> SolidityParser a
brackets p = between (symbol "[") (symbol "]") p

comma :: SolidityParser String
comma = symbol ","

commaSep :: SolidityParser a -> SolidityParser [a]
commaSep p = sepBy p comma

commaSep1 :: SolidityParser a -> SolidityParser [a]
commaSep1 p = sepBy1 p comma

dot :: SolidityParser String
dot = symbol "."

semi :: SolidityParser String
semi = symbol ";"

colon :: SolidityParser String
colon = symbol ":"

--semiSep = P.semiSep solidityLexer
--semiSep1 = P.semiSep1 solidityLexer
stringLiteral :: SolidityParser String
stringLiteral = solidityStringLiteral

-- | Parsec's @whiteSpace@ for 'solidityLanguage', with the spaces and complete
-- comments taken in one step first. Parsec's own then runs where they end:
-- it consumes nothing, but its failed attempt there supplies the same
-- "expecting" as parsec's last loop iteration did, and it reports an
-- unterminated block comment, which the first step leaves untouched.
whiteSpace :: SolidityParser ()
whiteSpace = skipSpaceAndComments *> P.whiteSpace solidityLexer

skipSpaceAndComments :: SolidityParser ()
skipSpaceAndComments = mkPT $ \s -> pure $
  case go False (stateInput s) (statePos s) of
    (False, _, _) -> Empty (pure (Ok () s (unknownError s)))
    (True, input, pos) -> Consumed (pure (Ok () (State input pos (stateUser s)) (newErrorUnknown pos)))
  where
    go !taken input !pos = case input of
      c : rest | isSpace c -> go True rest (updatePosChar pos c)
      '/' : '/' : rest -> lineComment rest (advance pos "//")
      '/' : '*' : rest | Just (rest', pos') <- blockComment rest (advance pos "/*") -> go True rest' pos'
      _ -> (taken, input, pos)
    -- up to, not including, the newline
    lineComment input@('\n' : _) !pos = go True input pos
    lineComment (c : rest) !pos = lineComment rest (updatePosChar pos c)
    lineComment [] !pos = (True, [], pos)
    -- through the closing "*/"; Nothing if the comment never closes
    blockComment ('*' : '/' : rest) !pos = Just (rest, advance pos "*/")
    blockComment (c : rest) !pos = blockComment rest (updatePosChar pos c)
    blockComment [] _ = Nothing
    advance :: SourcePos -> String -> SourcePos
    advance = foldl' updatePosChar

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
  let d = case readHex [d1, d2] of
        ((d', _) : _) -> d'
        _ -> error "hexChar"
  return $ w2c d

unicodeChar :: SolidityParser Char
unicodeChar = do
  _ <- char 'u'
  d1 <- digit
  d2 <- digit
  d3 <- digit
  d4 <- digit
  -- let ((d, _):_) = readHex [d1,d2,d3,d4]
  let d = case readHex [d1, d2, d3, d4] of
        ((d', _) : _) -> d'
        _ -> error "unicodeChar"
  return $ toEnum d

charEsc :: SolidityParser Char
charEsc = choice (map parseEsc escMap)
  where
    parseEsc (c, code) = do _ <- char c; return code
    escMap = zip ("abfnrtv\\\"\'") ("\a\b\f\n\r\t\v\\\"\'")
