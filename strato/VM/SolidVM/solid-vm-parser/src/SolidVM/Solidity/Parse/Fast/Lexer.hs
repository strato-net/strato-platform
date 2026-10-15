{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE UnboxedTuples #-}

-- |
-- Module: Fast.Lexer
-- Description: Splits Solidity source into tokens
--
-- One pass over the UTF-8 array of the source by byte index; a token's text
-- is a slice of it. ASCII bytes are classified by table lookup and only
-- non-ASCII input is decoded. Whitespace and comments are dropped. The lexer
-- never fails: input no token can start with becomes a 'TError' token, which
-- no grammar rule accepts, so the parse fails there with the token's message.
--
-- Words and operators carry their 'String' form: one shared 'String' per
-- distinct word, so the tree the parser builds shares the names too.
--
-- The tokens are kept in flat arrays ('Tokens'), which the garbage collector
-- never copies however large the source; 'tokenAt' reads one out.
module SolidVM.Solidity.Parse.Fast.Lexer
  ( Kind (..),
    Token (..),
    Tokens (..),
    tokenAt,
    Value (..),
    tValue,
    tStr,
    tReserved,
    tByte,
    tokenize,
    reservedNames,
  )
where

import Control.Monad.ST (runST)
import Data.Bits (countLeadingZeros, finiteBitSize, shiftL, xor, (.&.))
import Data.Char (chr, isAlpha, isAlphaNum, isAsciiLower, isAsciiUpper, isDigit, isSpace)
import Data.Foldable (foldl')
import qualified Data.IntMap.Strict as IntMap
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Array as A
import Data.Text.Internal (Text (..))
import Data.Text.Unsafe (Iter (..), iterArray)
import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV
import qualified Data.Vector.Unboxed as VU
import qualified Data.Vector.Unboxed.Mutable as MVU
import Data.Word (Word8)

data Kind
  = -- | An identifier or keyword.
    TWord
  | -- | An operator (see 'operators').
    TOp
  | -- | One of @( ) { } [ ] ; ,@.
    TPunct
  | -- | An integer literal: decimal, @0x@ hex, or @digits e digits@.
    TNumber
  | -- | @digits.digits@.
    TDecimal
  | -- | A string literal in either quote; 'tText' is the raw text with quotes.
    TString
  | -- | Input the lexer could not read.
    TError
  | -- | End of input.
    TEOF
  deriving (Eq, Show, Enum)

data Token = Token
  { tKind :: !Kind,
    tText :: {-# UNPACK #-} !Text,
    -- | Line and column of the token's first character, as parsec counts them.
    tLine :: !Int,
    tCol :: !Int,
    tValue' :: !Value
  }

-- | The tokens of a source: per token five 'Int's (kind, byte offset, byte
-- length, line, column) in one unboxed array and a 'Value' in one boxed
-- array. The last token is 'TEOF'.
data Tokens = Tokens
  { tokCount :: !Int,
    tokInts :: !(VU.Vector Int),
    tokValues :: !(V.Vector Value),
    -- | The source array, which every token's text is a slice of.
    tokArr :: !A.Array
  }

-- | Token @i@, which must be less than 'tokCount'.
tokenAt :: Tokens -> Int -> Token
tokenAt (Tokens _ ints vals arr) i =
  let b = i * 5
      at = VU.unsafeIndex ints
   in Token {tKind = toEnum (at b), tText = Text arr (at (b + 1)) (at (b + 2)), tLine = at (b + 3), tCol = at (b + 4), tValue' = V.unsafeIndex vals i}
{-# INLINE tokenAt #-}

-- | What a token's text denotes. Every occurrence of a word shares one
-- 'Word', every operator one static 'Op'.
data Value
  = -- | The word's text and whether it is in 'reservedNames'.
    Word {-# UNPACK #-} !Text !Bool
  | -- | The operator as a 'String'.
    Op String
  | -- | An integer literal's value.
    Number !Integer
  | -- | The value of an integer written with an exponent, @1e3@, which only
    -- expressions accept.
    Scientific !Integer
  | -- | A decimal's integer part and fraction digits.
    Decimal !Integer String
  | -- | A string literal's decoded value, or why a 'TError' could not be read.
    Str String
  | -- | Punctuation and the end of input.
    None

-- | A number's value, or a decimal's integer part.
tValue :: Token -> Integer
tValue t = case tValue' t of
  Number n -> n
  Scientific n -> n
  Decimal n _ -> n
  _ -> 0

-- | A word's or operator's 'String', a string's value, a decimal's fraction
-- digits, or an error's message.
tStr :: Token -> String
tStr t = case tValue' t of
  Word w _ -> T.unpack w
  Op s -> s
  Decimal _ s -> s
  Str s -> s
  _ -> ""

-- | Whether the token is a word in 'reservedNames'.
tReserved :: Token -> Bool
tReserved t = case tValue' t of
  Word _ r -> r
  _ -> False
{-# INLINE tReserved #-}

instance Show Token where
  show t = show (tKind t) ++ " " ++ show (tText t) ++ " @" ++ show (tLine t) ++ ":" ++ show (tCol t)

-- | Byte index of the token's start in the source array.
tByte :: Token -> Int
tByte t = let Text _ off _ = tText t in off
{-# INLINE tByte #-}

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

-- | The operators.
operators :: [Text]
operators =
  [ ">>>=",
    "**", "<<", ">>>", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "=>", ":=",
    "+=", "-=", "*=", "/=", "%=", "|=", "^=", "&=", "<<=", ">>=",
    "*", "/", "%", "+", "-", "&", "^", "|", "<", ">", "?", ":", "=", "!", "~", "."
  ]

-- | An operator's length and bytes packed into one 'Int'.
packOp :: Int -> [Word8] -> Int
packOp = foldl' (\k b -> k * 256 + fromIntegral b)

-- | Each operator's 'Op' by its packed form.
operatorValues :: IntMap.IntMap Value
operatorValues = IntMap.fromList [(packOp (T.length o) (map (fromIntegral . fromEnum) (T.unpack o)), Op (T.unpack o)) | o <- operators]

longestOperator :: Int
longestOperator = maximum (map T.length operators)

-- | The classes an ASCII byte belongs to, as bits.
identStart, identLetter, opChar, punctChar, digitChar, spaceChar :: Word8
identStart = 1
identLetter = 2
opChar = 4
punctChar = 8
digitChar = 16
spaceChar = 32

-- | The class bits of each ASCII byte, as a 128-byte array.
classes :: Text
classes = T.pack [chr (fromIntegral (bits c)) | c <- ['\0' .. '\127']]
  where
    bits :: Char -> Word8
    bits c =
      (if isAsciiLower c || isAsciiUpper c || c == '$' || c == '_' then identStart else 0)
        + (if isAsciiLower c || isAsciiUpper c || isDigit c || c == '$' || c == '_' then identLetter else 0)
        + (if c `elem` ("!%&*+-./:<=>?^|~" :: String) then opChar else 0)
        + (if c `elem` ("(){}[];," :: String) then punctChar else 0)
        + (if isDigit c then digitChar else 0)
        + (if isSpace c then spaceChar else 0)

-- | The token arrays being filled; they double when full.
data Buf s = Buf !(MVU.MVector s Int) !(MV.MVector s Value)

tokenize :: Text -> Tokens
tokenize (Text arr start len) = runST $ do
  buf0 <- Buf <$> MVU.unsafeNew (5 * (len `quot` 4 + 16)) <*> MV.unsafeNew (len `quot` 4 + 16)
  names <- MV.replicate buckets []
  let end = start + len
      Text tbl tblOff _ = classes

      byteAt :: Int -> Word8
      byteAt = A.unsafeIndex arr
      {-# INLINE byteAt #-}
      -- whether an ASCII byte is in a class
      is :: Word8 -> Word8 -> Bool
      is cl b = A.unsafeIndex tbl (tblOff + fromIntegral b) .&. cl /= 0
      {-# INLINE is #-}
      -- the byte after the run of bytes in a class from i
      spanClass :: Word8 -> Int -> Int
      spanClass cl !i
        | i < end, b <- byteAt i, b < 0x80, is cl b = spanClass cl (i + 1)
        | otherwise = i
      -- bytes of a UTF-8 sequence from its first byte
      utf8Length :: Word8 -> Int
      utf8Length b
        | b < 0xe0 = 2
        | b < 0xf0 = 3
        | otherwise = 4

      -- (line, column) after the bytes in [i, j)
      advance :: Int -> Int -> Int -> Int -> (# Int, Int #)
      advance !i !j !l !c
        | i >= j = (# l, c #)
        | otherwise =
            let b = byteAt i
             in if
                  | b == 0x0a -> advance (i + 1) j (l + 1) 1
                  | b == 0x09 -> advance (i + 1) j l (tab c)
                  | b < 0x80 -> advance (i + 1) j l (c + 1)
                  | otherwise -> advance (i + utf8Length b) j l (c + 1)

      -- the column after a tab, as parsec counts it
      tab c = c + 8 - ((c - 1) `mod` 8)

      slice i j = Text arr i (j - i)

      -- the 'Word' of the word at bytes [i, j), shared with its earlier
      -- occurrences. Its text is a copy, not a slice: it ends up in the AST,
      -- which must not keep the whole source alive.
      intern i j = do
        let txt = slice i j
            h = hashBytes i j .&. (buckets - 1)
            look (w@(Word t _) : rest)
              | t == txt = pure w
              | otherwise = look rest
            look _ = do
              bucket <- MV.unsafeRead names h
              let w = Word (T.copy txt) (Set.member txt reservedNames)
              MV.unsafeWrite names h (w : bucket)
              pure w
        MV.unsafeRead names h >>= look

      -- FNV-1a of the bytes in [i, j)
      hashBytes :: Int -> Int -> Int
      hashBytes !i !j = hash (-3750763034362895579) i
        where
          hash !h k
            | k >= j = h
            | otherwise = hash ((h `xor` fromIntegral (byteAt k)) * 0x100000001b3) (k + 1)

      -- writes token k: its kind, bytes [i, j), position and value
      push (Buf ints vals) !k !kind !i !j !line !col !val = do
        Buf ints' vals' <-
          if k < MV.length vals
            then pure (Buf ints vals)
            else Buf <$> MVU.unsafeGrow ints (MVU.length ints) <*> MV.unsafeGrow vals (MV.length vals)
        let b = 5 * k
        MVU.unsafeWrite ints' b (fromEnum kind)
        MVU.unsafeWrite ints' (b + 1) i
        MVU.unsafeWrite ints' (b + 2) (j - i)
        MVU.unsafeWrite ints' (b + 3) line
        MVU.unsafeWrite ints' (b + 4) col
        MV.unsafeWrite vals' k val
        pure (Buf ints' vals')

      finish (Buf ints vals) k =
        Tokens k <$> VU.unsafeFreeze (MVU.unsafeSlice 0 (5 * k) ints) <*> V.unsafeFreeze (MV.unsafeSlice 0 k vals) <*> pure arr

      -- whitespace and comments, then the token that follows
      go buf !k !i !line !col
        | i >= end = do
            buf1 <- push buf k TEOF i i line col None
            finish buf1 (k + 1)
        | otherwise =
            let b = byteAt i
             in if
                  | b == 0x20 -> go buf k (i + 1) line (col + 1)
                  | b == 0x0a -> go buf k (i + 1) (line + 1) 1
                  | b == 0x09 -> go buf k (i + 1) line (tab col)
                  | b == 0x2f, i + 1 < end, byteAt (i + 1) == 0x2f ->
                      -- a newline or the end follows a line comment, so its columns do not matter
                      go buf k (lineEnd (i + 2)) line col
                  | b == 0x2f, i + 1 < end, byteAt (i + 1) == 0x2a ->
                      case closeComment (i + 2) of
                        Nothing -> do
                          buf1 <- push buf k TError i (i + 2) line col (Str "unterminated comment")
                          buf2 <- push buf1 (k + 1) TEOF i i line col None
                          finish buf2 (k + 2)
                        Just j -> case advance i j line col of (# l, c #) -> go buf k j l c
                  | b < 0x80 -> if is spaceChar b then go buf k (i + 1) line (col + 1) else token buf k i line col
                  | otherwise -> case iterArray arr i of
                      Iter ch d -> if isSpace ch then go buf k (i + d) line (col + 1) else token buf k i line col

      -- the byte index of the newline ending the line, or the end
      lineEnd :: Int -> Int
      lineEnd !i
        | i >= end || byteAt i == 0x0a = i
        | otherwise = lineEnd (i + 1)

      -- byte index after the "*/" closing a block comment opened before i
      closeComment :: Int -> Maybe Int
      closeComment !i
        | i + 1 >= end = Nothing
        | byteAt i == 0x2a && byteAt (i + 1) == 0x2f = Just (i + 2)
        | otherwise = closeComment (i + 1)

      -- the end of the identifier starting at byte i, and its character count
      spanIdent :: Int -> Int -> (# Int, Int #)
      spanIdent !i !n
        | i >= end = (# i, n #)
        | otherwise =
            let b = byteAt i
             in if
                  | b < 0x80 -> if is identLetter b then spanIdent (i + 1) (n + 1) else (# i, n #)
                  | otherwise -> case iterArray arr i of
                      Iter ch d -> if isAlphaNum ch then spanIdent (i + d) (n + 1) else (# i, n #)

      -- the token starting at byte i
      token buf !k !i !line !col = do
        let -- a token in bytes [i, j) of n columns
            flat kind j n val = do
              buf1 <- push buf k kind i j line col val
              go buf1 (k + 1) j line (col + n)
            err j msg = flat TError j (j - i) (Str msg)
            unexpected ch = "unexpected character " ++ show ch
            word = case spanIdent i 0 of
              (# j, n #) -> intern i j >>= flat TWord j n
            b = byteAt i
        if
          | b >= 0x80 -> case iterArray arr i of
              Iter ch d
                | isAlpha ch -> word
                | otherwise -> err (i + d) (unexpected ch)
          | is identStart b -> word
          | is digitChar b -> case lexNumber i of
              Left msg -> err (i + 1) msg
              Right (kind, j, val) -> flat kind j (j - i) val
          | b == 0x22 || b == 0x27 -> case lexString b (i + 1) of
              Left msg -> err (i + 1) msg
              Right (str, j) -> do
                buf1 <- push buf k TString i j line col (Str str)
                case advance i j line col of (# l, c #) -> go buf1 (k + 1) j l c
          | is opChar b ->
              let match n
                    | n == 0 = err (i + 1) (unexpected (chr (fromIntegral b)))
                    | Just op <- IntMap.lookup (packAt i n) operatorValues = flat TOp (i + n) n op
                    | otherwise = match (n - 1)
               in match (min longestOperator (spanClass opChar i - i))
          | is punctChar b -> flat TPunct (i + 1) 1 None
          | otherwise -> err (i + 1) (unexpected (chr (fromIntegral b)))

      -- the n bytes at i packed like 'packOp'
      packAt :: Int -> Int -> Int
      packAt i n = pack 0 n
        where
          pack m !acc
            | m >= n = acc
            | otherwise = pack (m + 1) (acc * 256 + fromIntegral (byteAt (i + m)))

      -- the number literal at byte i: kind, end and value
      lexNumber :: Int -> Either String (Kind, Int, Value)
      lexNumber i
        | byteAt i == 0x30, i + 1 < end, byteAt (i + 1) == 0x78 || byteAt (i + 1) == 0x58 =
            let j = spanHex (i + 2)
             in if j == i + 2 then Left "hex literal without digits" else Right (TNumber, j, Number (value 16 (i + 2) j))
        | otherwise =
            let j = spanClass digitChar i
                ds = value 10 i j
             in if
                  | j < end, byteAt j == 0x2e, k <- spanClass digitChar (j + 1), k > j + 1 ->
                      Right (TDecimal, k, Decimal ds [chr (fromIntegral (byteAt m)) | m <- [j + 1 .. k - 1]])
                  | j < end, byteAt j == 0x65 || byteAt j == 0x45, k <- spanClass digitChar (j + 1), k > j + 1 ->
                      Right (TNumber, k, Scientific (ds * 10 ^ value 10 (j + 1) k))
                  | otherwise -> Right (TNumber, j, Number ds)
      spanHex :: Int -> Int
      spanHex !i
        | i < end, isHexByte (byteAt i) = spanHex (i + 1)
        | otherwise = i
      -- the value of the digits in bytes [i, j)
      value :: Integer -> Int -> Int -> Integer
      value base i j = foldl' (\acc m -> acc * base + fromIntegral (digitValue (byteAt m))) 0 [i .. j - 1]

      -- the body of the string opened by the quote byte q, from byte i:
      -- the decoded value and the byte index after the closing quote
      lexString :: Word8 -> Int -> Either String (String, Int)
      lexString q = go' []
        where
          go' acc !m
            | m >= end = Left "unterminated string"
            | otherwise =
                let b = byteAt m
                 in if
                      | b == q -> Right (reverse acc, m + 1)
                      | b == 0x5c, m + 1 < end, e <- byteAt (m + 1) ->
                          if
                            | Just v <- escape e -> go' (v : acc) (m + 2)
                            | e == 0x78, Just h <- digitsAt isHexByte (m + 2) 2 -> go' (chr h : acc) (m + 4)
                            -- \u takes four decimal digits, read as hex, as parsec does
                            | e == 0x75, Just h <- digitsAt isDigitByte (m + 2) 4 -> go' (chr h : acc) (m + 6)
                            | otherwise -> Left "bad escape in string"
                      | b == 0x5c -> Left "bad escape in string"
                      | b < 0x80 -> go' (chr (fromIntegral b) : acc) (m + 1)
                      | otherwise -> case iterArray arr m of Iter ch d -> go' (ch : acc) (m + d)
      -- the hex value of the n digits of the given kind at byte i, if they are there
      digitsAt :: (Word8 -> Bool) -> Int -> Int -> Maybe Int
      digitsAt ok i n
        | i + n <= end, all (ok . byteAt) [i .. i + n - 1] = Just (foldl' (\acc m -> acc * 16 + digitValue (byteAt m)) 0 [i .. i + n - 1])
        | otherwise = Nothing

  go buf0 0 start 1 1
  where
    -- a power of two, about one bucket per 16 bytes of source
    buckets = 1 `shiftL` (finiteBitSize len - countLeadingZeros (min 8191 (len `quot` 16 + 63)))

isDigitByte :: Word8 -> Bool
isDigitByte b = b >= 0x30 && b <= 0x39

isHexByte :: Word8 -> Bool
isHexByte b = (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46)

digitValue :: Word8 -> Int
digitValue b
  | b <= 0x39 = fromIntegral b - 0x30
  | b >= 0x61 = fromIntegral b - 0x61 + 10
  | otherwise = fromIntegral b - 0x41 + 10

-- | The character a backslash escape stands for.
escape :: Word8 -> Maybe Char
escape b = case b of
  0x61 -> Just '\a'
  0x62 -> Just '\b'
  0x66 -> Just '\f'
  0x6e -> Just '\n'
  0x72 -> Just '\r'
  0x74 -> Just '\t'
  0x76 -> Just '\v'
  0x5c -> Just '\\'
  0x22 -> Just '"'
  0x27 -> Just '\''
  _ -> Nothing
