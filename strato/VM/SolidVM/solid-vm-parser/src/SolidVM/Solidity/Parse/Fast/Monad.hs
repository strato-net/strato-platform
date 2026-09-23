{-# LANGUAGE MagicHash #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE UnboxedSums #-}
{-# LANGUAGE UnboxedTuples #-}

-- |
-- Module: Fast.Monad
-- Description: The parser monad over the token vector
--
-- 'P' reads 'Token's by index. '<|>' takes the second alternative only when
-- the first failed without consuming a token, and 'try' turns a consuming
-- failure into a non-consuming one. A failure remembers the furthest token
-- any rule failed at, which is where the error is reported, and what was
-- expected there or why it was rejected.
module SolidVM.Solidity.Parse.Fast.Monad
  ( P,
    St (..),
    Err (..),
    runP,
    (<|>),
    (<?>),
    try,
    empty,
    failWith,
    choice,
    many,
    many1,
    manyTill,
    option,
    optionMaybe,
    optional,
    sepBy,
    sepBy1,
    between,
    chainl1,
    eof,
    peek,
    peekAt,
    next,
    skipToByte,
    source,
    sourceSlice,
    getPos,
    withPosition,
    position,
    getSt,
    modifySt,
    reserved,
    identifier,
    anyWord,
    sym,
    parens,
    braces,
    brackets,
    semi,
    comma,
    commaSep,
    commaSep1,
    integer,
    stringLiteral,
  )
where

import qualified Data.Set as Set
import Data.Source (SourceAnnotation (..), SourcePosition (..))
import Data.Text (Text)
import Data.Text.Internal (Text (..))
import qualified Data.Text as T
import qualified Data.Vector as V
import GHC.Exts (Int (I#), Int#, isTrue#, (+#), (==#), (>#))
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.ParserTypes (ParserState)

data St = St
  { stToks :: !(V.Vector Token),
    stSrc :: !Text,
    stName :: String,
    stUser :: !ParserState
  }

-- | What a failure says about the furthest token: what could have stood
-- there, or why what stood there was rejected.
data Err = Expecting [Text] | Because String

-- | Results are unboxed: success carries the value, the next token index and
-- the state; failure the index the failing rule started reading at (past the
-- enclosing rule's start exactly when it consumed a token), the furthest
-- index any rule failed at, and the 'Err' for that index.
type Res# a = (# (# a, Int#, St #) | (# Int#, Int#, Err #) #)

newtype P a = P {unP :: St -> Int# -> Res# a}

-- | The result, or the index of the token the parse failed at and why.
runP :: P a -> St -> Either (Int, Err) (a, St)
runP (P p) st = case p st 0# of
  (# (# a, _, st' #) | #) -> Right (a, st')
  (# | (# _, far, e #) #) -> Left (I# far, e)

noErr :: Err
noErr = Expecting []

-- | The deeper of two failures; at the same token, everything both expected.
merge :: Int# -> Err -> Int# -> Err -> (# Int#, Err #)
merge far e far' e'
  | isTrue# (far' ># far) = (# far', e' #)
  | isTrue# (far ># far') = (# far, e #)
  | otherwise = (# far, both e e' #)
  where
    both (Expecting a) (Expecting b) = Expecting (a ++ b)
    both r@(Because _) _ = r
    both _ r = r
{-# INLINE merge #-}

instance Functor P where
  fmap f (P p) = P $ \st i -> case p st i of
    (# (# a, j, st' #) | #) -> (# (# f a, j, st' #) | #)
    (# | e #) -> (# | e #)
  {-# INLINE fmap #-}

instance Applicative P where
  pure a = P $ \st i -> (# (# a, i, st #) | #)
  {-# INLINE pure #-}
  P pf <*> P pa = P $ \st i -> case pf st i of
    (# (# f, j, st' #) | #) -> case pa st' j of
      (# (# a, k, st'' #) | #) -> (# (# f a, k, st'' #) | #)
      (# | e #) -> (# | e #)
    (# | e #) -> (# | e #)
  {-# INLINE (<*>) #-}
  P pa *> P pb = P $ \st i -> case pa st i of
    (# (# _, j, st' #) | #) -> pb st' j
    (# | e #) -> (# | e #)
  {-# INLINE (*>) #-}
  P pa <* P pb = P $ \st i -> case pa st i of
    (# (# a, j, st' #) | #) -> case pb st' j of
      (# (# _, k, st'' #) | #) -> (# (# a, k, st'' #) | #)
      (# | e #) -> (# | e #)
    (# | e #) -> (# | e #)
  {-# INLINE (<*) #-}

instance Monad P where
  P p >>= k = P $ \st i -> case p st i of
    (# (# a, j, st' #) | #) -> unP (k a) st' j
    (# | e #) -> (# | e #)
  {-# INLINE (>>=) #-}
  (>>) = (*>)
  {-# INLINE (>>) #-}

infixr 1 <|>

(<|>) :: P a -> P a -> P a
P p <|> P q = P $ \st i -> case p st i of
  (# | (# s, far, e #) #)
    | isTrue# (s ==# i) -> case q st i of
        (# | (# s', far', e' #) #) -> case merge far e far' e' of
          (# far'', e'' #) -> (# | (# s', far'', e'' #) #)
        r -> r
  r -> r
{-# INLINE (<|>) #-}

infix 0 <?>

-- | Names what a rule expects; used when it fails at its first token, since
-- a deeper failure has its own, more specific, message.
(<?>) :: P a -> Text -> P a
P p <?> name = P $ \st i -> case p st i of
  (# | (# s, far, _ #) #) | isTrue# (far ==# i) -> (# | (# s, far, Expecting [name] #) #)
  r -> r
{-# INLINE (<?>) #-}

try :: P a -> P a
try (P p) = P $ \st i -> case p st i of
  (# | (# _, far, e #) #) -> (# | (# i, far, e #) #)
  r -> r
{-# INLINE try #-}

empty :: P a
empty = P $ \_ i -> (# | (# i, i, noErr #) #)
{-# INLINE empty #-}

-- | Rejects the input read so far, saying why.
failWith :: String -> P a
failWith why = P $ \_ i -> (# | (# i, i, Because why #) #)

choice :: [P a] -> P a
choice = foldr (<|>) empty

many :: P a -> P [a]
many (P p) = P $ \st0 i0 ->
  let go acc st i = case p st i of
        (# (# a, j, st' #) | #)
          | isTrue# (j ># i) -> go (a : acc) st' j
          | otherwise -> (# (# reverse (a : acc), j, st' #) | #)
        (# | (# s, far, e #) #)
          | isTrue# (s ==# i) -> (# (# reverse acc, i, st #) | #)
          | otherwise -> (# | (# s, far, e #) #)
   in go [] st0 i0

-- | @p@ repeatedly until @end@; where neither applies the failure names both.
manyTill :: P a -> P end -> P [a]
manyTill (P p) (P end) = P $ \st0 i0 ->
  let go acc st i = case end st i of
        (# (# _, j, st' #) | #) -> (# (# reverse acc, j, st' #) | #)
        (# | (# s, far, e #) #)
          | isTrue# (s ==# i) -> case p st i of
              (# (# a, j, st' #) | #)
                | isTrue# (j ># i) -> go (a : acc) st' j
                | otherwise -> (# (# reverse (a : acc), j, st' #) | #)
              (# | (# s', far', e' #) #)
                | isTrue# (s' ==# i) -> case merge far e far' e' of
                    (# far'', e'' #) -> (# | (# i, far'', e'' #) #)
                | otherwise -> (# | (# s', far', e' #) #)
          | otherwise -> (# | (# s, far, e #) #)
   in go [] st0 i0

many1 :: P a -> P [a]
many1 p = do
  x <- p
  xs <- many p
  pure (x : xs)

option :: a -> P a -> P a
option x p = p <|> pure x
{-# INLINE option #-}

optionMaybe :: P a -> P (Maybe a)
optionMaybe p = option Nothing (Just <$> p)
{-# INLINE optionMaybe #-}

optional :: P a -> P ()
optional p = (() <$ p) <|> pure ()

sepBy :: P a -> P sep -> P [a]
sepBy p sep = sepBy1 p sep <|> pure []

sepBy1 :: P a -> P sep -> P [a]
sepBy1 p sep = do
  x <- p
  xs <- many (sep >> p)
  pure (x : xs)

between :: P open -> P close -> P a -> P a
between o c p = o *> p <* c
{-# INLINE between #-}

chainl1 :: P a -> P (a -> a -> a) -> P a
chainl1 p op = p >>= rest
  where
    rest x = (do f <- op; y <- p; rest (f x y)) <|> pure x

tokAt :: St -> Int# -> Token
tokAt st i = V.unsafeIndex (stToks st) (I# i)
{-# INLINE tokAt #-}

-- | The current token, without consuming it.
peek :: P Token
peek = P $ \st i -> (# (# tokAt st i, i, st #) | #)
{-# INLINE peek #-}

-- | The token @n@ places ahead of the current one (the final 'TEOF' if there is none).
peekAt :: Int -> P Token
peekAt n = P $ \st i ->
  let ts = stToks st
      j = min (I# i + n) (V.length ts - 1)
   in (# (# V.unsafeIndex ts j, i, st #) | #)
{-# INLINE peekAt #-}

-- | Consumes the current token if @f@ accepts it. Fails without consuming
-- otherwise, and always at 'TEOF' and 'TError'.
next :: (Token -> Maybe a) -> P a
next f = P $ \st i ->
  let t = tokAt st i
   in case tKind t of
        TEOF -> (# | (# i, i, noErr #) #)
        TError -> (# | (# i, i, noErr #) #)
        _ -> case f t of
          Just a -> (# (# a, i +# 1#, st #) | #)
          Nothing -> (# | (# i, i, noErr #) #)
{-# INLINE next #-}

eof :: P ()
eof = P $ \st i -> case tKind (tokAt st i) of
  TEOF -> (# (# (), i, st #) | #)
  _ -> (# | (# i, i, Expecting ["end of input"] #) #)

-- | Consumes the tokens starting before byte @b@ of the source.
skipToByte :: Int -> P ()
skipToByte b = P $ \st i ->
  let ts = stToks st
      go :: Int# -> Res# ()
      go j =
        let t = V.unsafeIndex ts (I# j)
         in if tByte t < b && tKind t /= TEOF then go (j +# 1#) else (# (# (), j, st #) | #)
   in go i

-- | The source text.
source :: P Text
source = P $ \st i -> (# (# stSrc st, i, st #) | #)

-- | The source text between two token byte offsets.
sourceSlice :: Int -> Int -> P Text
sourceSlice from to = P $ \st i -> let Text arr _ _ = stSrc st in (# (# Text arr from (to - from), i, st #) | #)

getPos :: P SourcePosition
getPos = P $ \st i ->
  let t = tokAt st i
   in (# (# SourcePosition (stName st) (tLine t) (tCol t), i, st #) | #)
{-# INLINE getPos #-}

-- | The result of a rule with the positions of the first token it read and
-- of the token after the last.
withPosition :: P b -> P (SourceAnnotation (), b)
withPosition (P p) = P $ \st i -> case p st i of
  (# (# x, j, st' #) | #) ->
    let s = tokAt st i
        e = tokAt st' j
        name = stName st
     in (# (# (SourceAnnotation (SourcePosition name (tLine s) (tCol s)) (SourcePosition name (tLine e) (tCol e)) (), x), j, st' #) | #)
  (# | e #) -> (# | e #)
{-# INLINE withPosition #-}

position :: P a -> P (SourceAnnotation ())
position = fmap fst . withPosition

getSt :: P ParserState
getSt = P $ \st i -> (# (# stUser st, i, st #) | #)

modifySt :: (ParserState -> ParserState) -> P ()
modifySt f = P $ \st i -> (# (# (), i, st {stUser = f (stUser st)} #) | #)

------------------------------------------------------------------------------
-- Tokens

-- | The keyword @w@.
reserved :: Text -> P ()
reserved w = next (\t -> if tKind t == TWord && tText t == w then Just () else Nothing) <?> quoted w
{-# INLINE reserved #-}

-- | A word that is not a keyword.
identifier :: P String
identifier = next (\t -> if tKind t == TWord && not (Set.member (tText t) reservedNames) then Just (T.unpack (tText t)) else Nothing) <?> "identifier"
{-# INLINE identifier #-}

-- | Any word, keyword or not.
anyWord :: P String
anyWord = next (\t -> if tKind t == TWord then Just (T.unpack (tText t)) else Nothing) <?> "identifier"

-- | The operator or punctuation @s@.
sym :: Text -> P ()
sym s = next (\t -> if (tKind t == TOp || tKind t == TPunct) && tText t == s then Just () else Nothing) <?> quoted s
{-# INLINE sym #-}

quoted :: Text -> Text
quoted s = T.concat ["\"", s, "\""]

parens, braces, brackets :: P a -> P a
parens = between (sym "(") (sym ")")
braces = between (sym "{") (sym "}")
brackets = between (sym "[") (sym "]")

semi, comma :: P ()
semi = sym ";"
comma = sym ","

commaSep, commaSep1 :: P a -> P [a]
commaSep p = sepBy p comma
commaSep1 p = sepBy1 p comma

integer :: P Integer
integer = next (\t -> if tKind t == TNumber then Just (tValue t) else Nothing) <?> "number"

stringLiteral :: P String
stringLiteral = next (\t -> if tKind t == TString then Just (tStr t) else Nothing) <?> "string"
