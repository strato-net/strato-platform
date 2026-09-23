{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE UnboxedSums #-}
{-# LANGUAGE UnboxedTuples #-}

-- |
-- Module: Fast.Monad
-- Description: The parser monad over the token arrays
--
-- 'P' reads 'Token's by index and never backtracks: a rule that may or may
-- not apply is chosen by looking at the next token, so a successful parse
-- never fails a rule. A failure remembers the furthest token any rule failed
-- at, which is where the error is reported, and what was expected there or
-- why it was rejected.
module SolidVM.Solidity.Parse.Fast.Monad
  ( P,
    St (..),
    Err (..),
    runP,
    (<?>),
    empty,
    failWith,
    eof,
    peek,
    peekAt,
    next,
    skip,
    optionalIf,
    optionalNext,
    optionalSym,
    optionalWord,
    optionalIdentifier,
    afterSym,
    afterWord,
    manyWhile,
    many1While,
    manyNext,
    manyTillSym,
    sepBy1Sym,
    isSym,
    isWord,
    isIdentifier,
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
    natural,
    negative,
    negated,
    stringLiteral,
  )
where

import Data.Maybe (isJust)
import Data.Source (SourceAnnotation (..), SourcePosition (..))
import Data.Text (Text)
import Data.Text.Internal (Text (..))
import GHC.Exts (Int (I#), Int#, isTrue#, (+#), (==#))
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.ParserTypes (ParserState)

data St = St
  { stToks :: !Tokens,
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
-- index any rule failed at, and the 'Err' for that index. Values are
-- evaluated as they are returned, so a rule never leaves a thunk behind.
type Res# a = (# (# a, Int#, St #) | (# Int#, Int#, Err #) #)

newtype P a = P {unP :: St -> Int# -> Res# a}

-- | The result, or the index of the token the parse failed at and why.
runP :: P a -> St -> Either (Int, Err) (a, St)
runP (P p) st = case p st 0# of
  (# (# a, _, st' #) | #) -> Right (a, st')
  (# | (# _, far, e #) #) -> Left (I# far, e)

noErr :: Err
noErr = Expecting []

-- | Everything two failures at the same token expected.
both :: Err -> Err -> Err
both (Expecting a) (Expecting b) = Expecting (a ++ b)
both r@(Because _) _ = r
both _ r = r

instance Functor P where
  fmap f (P p) = P $ \st i -> case p st i of
    (# (# a, j, st' #) | #) -> let !b = f a in (# (# b, j, st' #) | #)
    (# | e #) -> (# | e #)
  {-# INLINE fmap #-}

instance Applicative P where
  pure !a = P $ \st i -> (# (# a, i, st #) | #)
  {-# INLINE pure #-}
  P pf <*> P pa = P $ \st i -> case pf st i of
    (# (# f, j, st' #) | #) -> case pa st' j of
      (# (# a, k, st'' #) | #) -> let !b = f a in (# (# b, k, st'' #) | #)
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

infix 0 <?>

-- | Names what a rule expects; used when it fails at its first token, since
-- a deeper failure has its own, more specific, message.
(<?>) :: P a -> Text -> P a
P p <?> name = P $ \st i -> case p st i of
  (# | (# s, far, _ #) #) | isTrue# (far ==# i) -> (# | (# s, far, Expecting [name] #) #)
  r -> r
{-# INLINE (<?>) #-}

-- | Fails at the current token; the enclosing rule's label names what was expected.
empty :: P a
empty = P $ \_ i -> (# | (# i, i, noErr #) #)
{-# INLINE empty #-}

-- | Rejects the input read so far, saying why.
failWith :: String -> P a
failWith why = P $ \_ i -> (# | (# i, i, Because why #) #)

------------------------------------------------------------------------------
-- Lookahead: a rule that may or may not apply is run only when the next
-- token says it does.

-- | Consumes the current token, whatever it is.
skip :: P ()
skip = P $ \st i -> (# (# (), i +# 1#, st #) | #)
{-# INLINE skip #-}

-- | @p@, if the current token satisfies @f@.
optionalIf :: (Token -> Bool) -> P a -> P (Maybe a)
optionalIf f (P p) = P $ \st i ->
  if f (tokAt st i)
    then case p st i of
      (# (# a, j, st' #) | #) -> (# (# Just a, j, st' #) | #)
      (# | e #) -> (# | e #)
    else (# (# Nothing, i, st #) | #)
{-# INLINE optionalIf #-}

-- | The current token, consumed, if @f@ accepts it.
optionalNext :: (Token -> Maybe a) -> P (Maybe a)
optionalNext f = P $ \st i -> case f (tokAt st i) of
  Just a -> (# (# Just a, i +# 1#, st #) | #)
  Nothing -> (# (# Nothing, i, st #) | #)
{-# INLINE optionalNext #-}

-- | Whether the current token is @s@ / the word @w@; consumed if so.
optionalSym, optionalWord :: Text -> P Bool
optionalSym s = isJust <$> optionalIf (isSym s) skip
optionalWord w = isJust <$> optionalIf (isWord w) skip
{-# INLINE optionalSym #-}
{-# INLINE optionalWord #-}

-- | @s p@ / @w p@, if @s@ / @w@ is next.
afterSym, afterWord :: Text -> P a -> P (Maybe a)
afterSym s p = optionalIf (isSym s) (skip *> p)
afterWord w p = optionalIf (isWord w) (skip *> p)
{-# INLINE afterSym #-}
{-# INLINE afterWord #-}

-- | An identifier, if one is next.
optionalIdentifier :: P (Maybe String)
optionalIdentifier = optionalIf isIdentifier identifier

-- | @p@ while the current token satisfies @f@.
manyWhile :: (Token -> Bool) -> P a -> P [a]
manyWhile f (P p) = P $ \st0 i0 ->
  let go st i
        | f (tokAt st i) = case p st i of
            (# (# a, j, st' #) | #) -> case go st' j of
              (# (# as, k, st'' #) | #) -> (# (# a : as, k, st'' #) | #)
              (# | e #) -> (# | e #)
            (# | e #) -> (# | e #)
        | otherwise = (# (# [], i, st #) | #)
   in go st0 i0
{-# INLINE manyWhile #-}

-- | @p@, then @p@ while the current token satisfies @f@.
many1While :: (Token -> Bool) -> P a -> P [a]
many1While f p = (:) <$> p <*> manyWhile f p
{-# INLINE many1While #-}

-- | Tokens while @f@ accepts them.
manyNext :: (Token -> Maybe a) -> P [a]
manyNext f = manyWhile (isJust . f) (next f)

-- | @p@ until the punctuation @s@, which is consumed. Failing at the first
-- token of a @p@, the error names @s@ too.
manyTillSym :: P a -> Text -> P [a]
manyTillSym (P p) s = P $ \st0 i0 ->
  let go st i
        | isSym s (tokAt st i) = (# (# [], i +# 1#, st #) | #)
        | otherwise = case p st i of
            (# (# a, j, st' #) | #) -> case go st' j of
              (# (# as, k, st'' #) | #) -> (# (# a : as, k, st'' #) | #)
              (# | e #) -> (# | e #)
            (# | (# s', far, e #) #)
              | isTrue# (far ==# i) -> (# | (# s', far, both e (Expecting [quoted s]) #) #)
              | otherwise -> (# | (# s', far, e #) #)
   in go st0 i0
{-# INLINE manyTillSym #-}

-- | @p@ separated by the punctuation @s@, one or more times.
sepBy1Sym :: P a -> Text -> P [a]
sepBy1Sym p s = (:) <$> p <*> manyWhile (isSym s) (skip *> p)
{-# INLINE sepBy1Sym #-}

isSym, isWord :: Text -> Token -> Bool
isSym s t = (tKind t == TOp || tKind t == TPunct) && tText t == s
isWord w t = tKind t == TWord && tText t == w
{-# INLINE isSym #-}
{-# INLINE isWord #-}

-- | A word that is not a keyword.
isIdentifier :: Token -> Bool
isIdentifier t = tKind t == TWord && not (tReserved t)
{-# INLINE isIdentifier #-}

tokAt :: St -> Int# -> Token
tokAt st i = tokenAt (stToks st) (I# i)
{-# INLINE tokAt #-}

-- | The current token, without consuming it.
peek :: P Token
peek = P $ \st i -> (# (# tokAt st i, i, st #) | #)
{-# INLINE peek #-}

-- | The token @n@ places ahead of the current one (the final 'TEOF' if there is none).
peekAt :: Int -> P Token
peekAt n = P $ \st i ->
  let ts = stToks st
      j = min (I# i + n) (tokCount ts - 1)
   in (# (# tokenAt ts j, i, st #) | #)
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
  let go :: Int# -> Res# ()
      go j =
        let t = tokAt st j
         in if tByte t < b && tKind t /= TEOF then go (j +# 1#) else (# (# (), j, st #) | #)
   in go i

-- | The source text.
source :: P Text
source = P $ \st i -> (# (# stSrc st, i, st #) | #)

-- | The source text between two token byte offsets.
sourceSlice :: Int -> Int -> P Text
sourceSlice from to = P $ \st i -> let Text arr _ _ = stSrc st in (# (# Text arr from (to - from), i, st #) | #)

getPos :: P SourcePosition
getPos = P $ \st i -> case tokAt st i of
  Token {tLine = l, tCol = c} -> (# (# SourcePosition (stName st) l c, i, st #) | #)
{-# INLINE getPos #-}

-- | The result of a rule with the positions of the first token it read and
-- of the token after the last.
withPosition :: P b -> P (SourceAnnotation (), b)
withPosition (P p) = P $ \st i -> case p st i of
  (# (# x, j, st' #) | #) -> case tokAt st i of
    Token {tLine = sl, tCol = sc} -> case tokAt st' j of
      Token {tLine = el, tCol = ec} ->
        let name = stName st
         in (# (# (SourceAnnotation (SourcePosition name sl sc) (SourcePosition name el ec) (), x), j, st' #) | #)
  (# | e #) -> (# | e #)
{-# INLINE withPosition #-}

position :: P a -> P (SourceAnnotation ())
position p = fst <$> withPosition p
{-# INLINE position #-}

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

identifier :: P String
identifier = next (\t -> case tValue' t of Word _ s False -> Just s; _ -> Nothing) <?> "identifier"
{-# INLINE identifier #-}

-- | Any word, keyword or not.
anyWord :: P String
anyWord = next (\t -> case tValue' t of Word _ s _ -> Just s; _ -> Nothing) <?> "identifier"

-- | The operator or punctuation @s@.
sym :: Text -> P ()
sym s = next (\t -> if (tKind t == TOp || tKind t == TPunct) && tText t == s then Just () else Nothing) <?> quoted s
{-# INLINE sym #-}

quoted :: Text -> Text
quoted s = "\"" <> s <> "\""

parens, braces, brackets :: P a -> P a
parens p = sym "(" *> p <* sym ")"
braces p = sym "{" *> p <* sym "}"
brackets p = sym "[" *> p <* sym "]"
{-# INLINE parens #-}
{-# INLINE braces #-}
{-# INLINE brackets #-}

semi, comma :: P ()
semi = sym ";"
comma = sym ","

-- | Comma-separated @p@: none when the list's closing bracket is next.
commaSep, commaSep1 :: P a -> P [a]
commaSep p = do
  t <- peek
  if tKind t == TPunct && (tText t == ")" || tText t == "]" || tText t == "}") then pure [] else commaSep1 p
commaSep1 p = sepBy1Sym p ","
{-# INLINE commaSep #-}
{-# INLINE commaSep1 #-}

-- | A number, after the optional @-@ or @+@ that parsec's @integer@ accepts.
integer :: P Integer
integer = negated <$> negative <*> natural

-- | Whether a @-@ precedes the number; a @+@ is accepted and skipped.
negative :: P Bool
negative = do
  t <- peek
  if
    | isSym "-" t -> True <$ skip
    | isSym "+" t -> False <$ skip
    | otherwise -> pure False

-- | Negate a number written with a @-@.
negated :: Num a => Bool -> a -> a
negated neg = if neg then negate else id

natural :: P Integer
natural = next (\t -> case tValue' t of Number n -> Just n; _ -> Nothing) <?> "number"

stringLiteral :: P String
stringLiteral = next (\t -> case tValue' t of Str s | tKind t == TString -> Just s; _ -> Nothing) <?> "string"
