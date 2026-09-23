{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Lexer
-- Description: Splits Solidity source into tokens
--
-- One pass over the UTF-8 array of the source by byte index; a token's text
-- is a slice of it. Whitespace and comments are dropped. The lexer never
-- fails: input no token can start with becomes a 'TError' token, which no
-- grammar rule accepts, so the parse fails there with the token's message.
module SolidVM.Solidity.Parse.Fast.Lexer
  ( Kind (..),
    Token (..),
    tokenize,
    reservedNames,
  )
where

import Control.Applicative ((<|>))
import Control.Monad.ST (runST)
import Data.Char (chr, isAlpha, isAlphaNum, isDigit, isHexDigit, isSpace)
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Array as A
import Data.Text.Internal (Text (..))
import Data.Text.Unsafe (Iter (..), iterArray)
import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV
import Data.Word (Word8)

data Kind
  = -- | An identifier or keyword.
    TWord
  | -- | An operator (see 'operators').
    TOp
  | -- | One of @( ) { } [ ] ; ,@.
    TPunct
  | -- | An integer literal: decimal, @0x@ hex, or @digits e digits@; 'tValue' is its value.
    TNumber
  | -- | @digits.digits@; 'tValue' is the integer part, 'tStr' the fraction digits.
    TDecimal
  | -- | A string literal in either quote; 'tStr' is the decoded value, 'tText' the raw text with quotes.
    TString
  | -- | Input the lexer could not read; 'tStr' says why.
    TError
  | -- | End of input.
    TEOF
  deriving (Eq, Show)

data Token = Token
  { tKind :: !Kind,
    tText :: {-# UNPACK #-} !Text,
    tValue :: !Integer,
    tStr :: String,
    tLine :: !Int,
    tCol :: !Int,
    -- | Byte index of the token's start in the source array.
    tByte :: !Int
  }

instance Show Token where
  show t = show (tKind t) ++ " " ++ show (tText t) ++ " @" ++ show (tLine t) ++ ":" ++ show (tCol t)

-- | Words that cannot be identifiers.
reservedNames :: Set.Set Text
reservedNames =
  Set.fromList
    [ "pragma", "import", "library", "using", "contract", "is", "public", "internal",
      "private", "external", "payable", "event", "indexed", "anonymous", "bool", "true",
      "false", "uint", "decimal", "int", "bytes", "byte", "real", "ureal", "string",
      "address", "enum", "struct", "mapping", "var", "function", "returns", "return",
      "modifier", "revert", "delete", "constant", "storage", "memory", "calldata",
      "immutable", "if", "else", "while", "for", "break", "continue", "suicide", "this",
      "call", "callcode", "length", "sha3", "block", "msg", "tx", "record", "wei", "finney",
      "szabo", "ether", "seconds", "minutes", "hours", "days", "weeks", "years", "receive",
      "fallback", "virtual", "override", "global"
    ]

-- | The operators, longest match first.
operators :: [Text]
operators =
  [ ">>>=",
    "**", "<<", ">>>", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "=>", ":=",
    "+=", "-=", "*=", "/=", "%=", "|=", "^=", "&=", "<<=", ">>=",
    "*", "/", "%", "+", "-", "&", "^", "|", "<", ">", "?", ":", "=", "!", "~", "."
  ]

operatorSet :: Set.Set Text
operatorSet = Set.fromList operators

longestOperator :: Int
longestOperator = maximum (map T.length operators)

isIdentStart, isIdentLetter, isOpChar :: Char -> Bool
isIdentStart c
  | c <= 'z' = (c >= 'a') || (c >= 'A' && c <= 'Z') || c == '$' || c == '_'
  | otherwise = isAlpha c
isIdentLetter c
  | c <= 'z' = (c >= 'a') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '$' || c == '_'
  | otherwise = isAlphaNum c
isOpChar c = c `elem` ("!%&*+-./:<=>?^|~" :: String)
{-# INLINE isIdentStart #-}
{-# INLINE isIdentLetter #-}
{-# INLINE isOpChar #-}

tokenize :: Text -> V.Vector Token
tokenize (Text arr start len) = runST $ do
  mv0 <- MV.unsafeNew 256
  let end = start + len

      charAt :: Int -> Char
      charAt i = let Iter c _ = iterArray arr i in c
      {-# INLINE charAt #-}
      byteAt :: Int -> Word8
      byteAt = A.unsafeIndex arr
      {-# INLINE byteAt #-}
      -- byte index after the char at i
      after :: Int -> Int
      after i = let Iter _ d = iterArray arr i in i + d
      {-# INLINE after #-}

      -- byte index after the run of chars satisfying p from i
      spanP :: (Char -> Bool) -> Int -> Int
      spanP p !i
        | i >= end = i
        | otherwise = let Iter c d = iterArray arr i in if p c then spanP p (i + d) else i

      -- (line, column) after the chars in [i, j)
      advance :: Int -> Int -> Int -> Int -> (Int, Int)
      advance !i !j !l !c
        | i >= j = (l, c)
        | otherwise =
            let Iter ch d = iterArray arr i
             in if ch == '\n' then advance (i + d) j (l + 1) 1 else advance (i + d) j l (c + 1)

      slice i j = Text arr i (j - i)

      mk kind i j val str line col = Token {tKind = kind, tText = slice i j, tValue = val, tStr = str, tLine = line, tCol = col, tByte = i}

      push mv k t
        | k < MV.length mv = MV.unsafeWrite mv k t >> pure mv
        | otherwise = do
            mv' <- MV.unsafeGrow mv (MV.length mv)
            MV.unsafeWrite mv' k t
            pure mv'

      finish mv k = V.unsafeFreeze (MV.unsafeSlice 0 k mv)

      -- whitespace and comments, then the token that follows
      go mv !k !i !line !col
        | i >= end = do
            mv1 <- push mv k (mk TEOF i i 0 "" line col)
            finish mv1 (k + 1)
        | otherwise =
            let b = byteAt i
             in if
                  | b == 0x20 -> go mv k (i + 1) line (col + 1)
                  | b == 0x0a -> go mv k (i + 1) (line + 1) 1
                  | b == 0x2f, i + 1 < end, byteAt (i + 1) == 0x2f ->
                      let j = spanP (/= '\n') i in go mv k j line (col + T.length (slice i j))
                  | b == 0x2f, i + 1 < end, byteAt (i + 1) == 0x2a ->
                      case closeComment (i + 2) of
                        Nothing -> do
                          mv1 <- push mv k (mk TError i (i + 2) 0 "unterminated comment" line col)
                          mv2 <- push mv1 (k + 1) (mk TEOF i i 0 "" line col)
                          finish mv2 (k + 2)
                        Just j -> let (l, c) = advance i j line col in go mv k j l c
                  | b < 0x80 ->
                      if isSpace (chr (fromIntegral b)) then go mv k (i + 1) line (col + 1) else token mv k i line col
                  | otherwise ->
                      let Iter ch d = iterArray arr i
                       in if isSpace ch then go mv k (i + d) line (col + 1) else token mv k i line col

      -- byte index after the "*/" closing a block comment opened before i
      closeComment :: Int -> Maybe Int
      closeComment !i
        | i + 1 >= end = Nothing
        | byteAt i == 0x2a && byteAt (i + 1) == 0x2f = Just (i + 2)
        | otherwise = closeComment (i + 1)

      -- the token starting at byte i
      token mv !k !i !line !col = do
        let ch = charAt i
            -- a token in bytes [i, j), on one line
            {-# INLINE flat #-}
            flat kind j val str = do
              mv1 <- push mv k (mk kind i j val str line col)
              go mv1 (k + 1) j line (col + T.length (slice i j))
            err j msg = flat TError j 0 msg
        if
          | isIdentStart ch -> flat TWord (spanP isIdentLetter i) 0 ""
          | isDigit ch -> case lexNumber (slice i end) of
              Left msg -> err (after i) msg
              Right (kind, n, val, str) -> flat kind (i + n) val str
          | ch == '"' || ch == '\'' -> case lexString ch (slice (after i) end) of
              Left msg -> err (after i) msg
              Right (str, n) -> do
                let j = after i + n
                    (l, c) = advance i j line col
                mv1 <- push mv k (mk TString i j 0 str line col)
                go mv1 (k + 1) j l c
          | isOpChar ch ->
              let run = slice i (spanP isOpChar i)
                  match n
                    | n == 0 = err (after i) "unexpected character"
                    | otherwise =
                        let op = T.take n run
                         in if Set.member op operatorSet then flat TOp (i + n) 0 "" else match (n - 1)
               in match (min longestOperator (T.length run))
          | ch `elem` ("(){}[];," :: String) -> flat TPunct (i + 1) 0 ""
          | otherwise -> err (after i) "unexpected character"

  go mv0 0 start 1 1

-- | A number literal at the start of the text: kind, byte length, value and,
-- for a decimal, its fraction digits.
lexNumber :: Text -> Either String (Kind, Int, Integer, String)
lexNumber input
  | Just rest <- T.stripPrefix "0x" input <|> T.stripPrefix "0X" input =
      let ds = T.takeWhile isHexDigit rest
       in if T.null ds then Left "hex literal without digits" else Right (TNumber, 2 + T.length ds, value 16 ds, "")
  | otherwise =
      let ds = T.takeWhile isDigit input
          rest = T.drop (T.length ds) input
          n = T.length ds
       in case T.uncons rest of
            Just ('.', rest')
              | fs <- T.takeWhile isDigit rest',
                not (T.null fs) ->
                  Right (TDecimal, n + 1 + T.length fs, value 10 ds, T.unpack fs)
            Just (e, rest')
              | e == 'e' || e == 'E',
                es <- T.takeWhile isDigit rest',
                not (T.null es) ->
                  Right (TNumber, n + 1 + T.length es, value 10 ds * 10 ^ value 10 es, "")
            _ -> Right (TNumber, n, value 10 ds, "")
  where
    value :: Integer -> Text -> Integer
    value base = T.foldl' (\acc d -> acc * base + fromIntegral (digitValue d)) 0
    digitValue d
      | isDigit d = fromEnum d - fromEnum '0'
      | d >= 'a' && d <= 'f' = fromEnum d - fromEnum 'a' + 10
      | otherwise = fromEnum d - fromEnum 'A' + 10

-- | The body of a string literal opened with @quote@, decoded. Returns the
-- value and the byte length of the body including the closing quote.
lexString :: Char -> Text -> Either String (String, Int)
lexString quote = go 0 []
  where
    go !n acc input = case T.uncons input of
      Nothing -> Left "unterminated string"
      Just (ch, rest)
        | ch == quote -> Right (reverse acc, n + 1)
        | ch == '\\' -> case T.uncons rest of
            Just (e, rest')
              | Just v <- lookup e escapes -> go (n + 2) (v : acc) rest'
              | e == 'x', (h, rest'') <- T.splitAt 2 rest', T.length h == 2, T.all isHexDigit h -> go (n + 4) (chr (hex h) : acc) rest''
              | e == 'u', (h, rest'') <- T.splitAt 4 rest', T.length h == 4, T.all isHexDigit h -> go (n + 6) (chr (hex h) : acc) rest''
            _ -> Left "bad escape in string"
        | otherwise -> go (n + utf8Length ch) (ch : acc) rest
    escapes = zip ("abfnrtv\\\"'" :: String) ("\a\b\f\n\r\t\v\\\"'" :: String)
    hex = T.foldl' (\acc d -> acc * 16 + digit d) 0
    digit d
      | isDigit d = fromEnum d - fromEnum '0'
      | d >= 'a' && d <= 'f' = fromEnum d - fromEnum 'a' + 10
      | otherwise = fromEnum d - fromEnum 'A' + 10
    utf8Length c
      | c < '\x80' = 1
      | c < '\x800' = 2
      | c < '\x10000' = 3
      | otherwise = 4
