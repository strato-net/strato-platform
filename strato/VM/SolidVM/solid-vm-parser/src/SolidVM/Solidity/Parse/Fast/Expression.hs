{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Expression
-- Description: Expressions, and the literal forms of transaction arguments
module SolidVM.Solidity.Parse.Fast.Expression
  ( expression,
    literal,
  )
where

import Blockchain.Strato.Model.Address (Address)
import Data.Char (isHexDigit)
import Data.Decimal (Decimal)
import Data.Foldable (foldl')
import Data.Maybe (fromMaybe)
import qualified Data.Map as Map
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Internal (Text (..))
import Data.Text.Unsafe (lengthWord8)
import SolidVM.Model.CodeCollection.Statement
import SolidVM.Model.SolidString
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Fast.Types
import Text.Read (readMaybe)

expression :: P Expression
expression = expression' <?> "expression"

expression' :: P Expression
expression' = do
  legacy <- legacyOperatorPrecedence <$> getSt
  climb (if legacy then legacyTable else solidityTable)

------------------------------------------------------------------------------
-- Operators

-- | Binary operator levels, tightest first.
data Level
  = InfixL [Text]
  | InfixR [Text]
  | TernaryLevel

prefixOps :: [Text]
prefixOps = ["!", "~", "delete", "++", "--", "+", "-"]

solidityLevels :: [Level]
solidityLevels =
  [ InfixR ["**"],
    InfixL ["*", "/", "%"],
    InfixL ["+", "-"],
    InfixL ["<<", ">>", ">>>"],
    InfixL ["&"],
    InfixL ["^"],
    InfixL ["|"],
    InfixL ["<", ">", "<=", ">="],
    InfixL ["==", "!="],
    InfixL ["&&"],
    InfixL ["||"],
    TernaryLevel,
    InfixR ["=", "|=", "^=", "&=", "<<=", ">>=", ">>>=", "+=", "-=", "*=", "/=", "%="]
  ]

-- | The pre-fork table: assignment tighter than @&&@ and @||@, the ternary
-- tighter than both, @**@ and assignment left-associative.
legacyLevels :: [Level]
legacyLevels =
  [ InfixL ["**"],
    InfixL ["*", "/", "%"],
    InfixL ["+", "-"],
    InfixL ["<<", ">>", ">>>"],
    InfixL ["&"],
    InfixL ["^"],
    InfixL ["|"],
    InfixL ["==", "!="],
    InfixL ["<", ">", "<=", ">="],
    TernaryLevel,
    InfixL ["=", "|=", "^=", "&=", "<<=", ">>=", "+=", "-=", "*=", "/=", "%="],
    InfixL ["&&"],
    InfixL ["||"]
  ]

-- | Each binary operator with its level (looser is higher) and whether it
-- associates to the right, plus the level of @?:@.
data Table = Table
  { tblOps :: !(Map.Map Text (Int, Bool)),
    tblTern :: !Int,
    tblTop :: !Int
  }

mkTable :: [Level] -> Table
mkTable levels =
  Table
    { tblOps = Map.fromList [(o, (i, r)) | (i, l) <- indexed, (os, r) <- ops l, o <- os],
      tblTern = case [i | (i, TernaryLevel) <- indexed] of
        i : _ -> i
        [] -> -1,
      tblTop = length levels - 1
    }
  where
    indexed = zip [0 ..] levels
    ops (InfixL os) = [(os, False)]
    ops (InfixR os) = [(os, True)]
    ops TernaryLevel = []

solidityTable, legacyTable :: Table
solidityTable = mkTable solidityLevels
legacyTable = mkTable legacyLevels

-- | Precedence climbing: an operand, then operators of decreasing binding
-- power, each read once. The token after an operand is passed along with it,
-- since the rule that read the operand has already looked at it.
climb :: Table -> P Expression
climb tbl = do
  (x, t) <- unary
  fst <$> binaries tbl (tblTop tbl) x t

-- | An operand with its calls, postfix and prefix operators, and the token
-- following it. NOINLINE: inlined into each other, 'unary' and 'binaries'
-- compile to code five times slower.
{-# NOINLINE unary #-}
unary :: P (Expression, Token)
unary = do
  t <- peek
  pre <-
    if (tKind t == TOp || isWord "delete" t) && tText t `elem` prefixOps
      then let !o = tStr t in Just <$> withPosition (o <$ skip)
      else pure Nothing
  x0 <- operand
  x1 <- callChain x0
  t1 <- peek
  (x2, t2) <- postfix "++" PlusPlus x1 t1
  (x3, t3) <- postfix "--" MinusMinus x2 t2
  let !x4 = maybe x3 (\(a, o) -> Unitary a o x3) pre
  pure (x4, t3)
  where
    postfix o k x t
      | isSym o t = do
          a <- position skip
          (,) (k a x) <$> peek
      | otherwise = pure (x, t)

-- | Applies the operators of level at most @bound@ following @x@.
{-# NOINLINE binaries #-}
binaries :: Table -> Int -> Expression -> Token -> P (Expression, Token)
binaries tbl bound = go
  where
    go x t
      | tKind t == TOp,
        tText t == "?",
        tblTern tbl <= bound = do
          f <- ternary
          peek >>= go (f x)
      | tKind t == TOp,
        Just (lvl, rassoc) <- Map.lookup (tText t) (tblOps tbl),
        lvl <= bound = do
          a <- position skip
          (y0, t0) <- unary
          (y, t') <- binaries tbl (if rassoc then lvl else lvl - 1) y0 t0
          let !o = tStr t
          go (Binary a o x y) t'
      | otherwise = pure (x, t)

ternary :: P (Expression -> Expression)
ternary = do
  (a, (e1, e2)) <- withPosition $ do
    sym "?"
    e1 <- expression
    sym ":"
    e2 <- expression
    pure (e1, e2)
  pure (\e -> Ternary (extractExpression e <> a) e e1 e2)

------------------------------------------------------------------------------
-- Operands

operand :: P Expression
operand = primaryExpression <?> "expression"

-- | The calls, member accesses and indexings following an operand, each
-- chosen by the token that starts it.
callChain :: Expression -> P Expression
callChain x = do
  t <- peek
  case tText t of
    "(" -> functionCall x >>= callChain
    "." -> memberAccess x >>= callChain
    "[" -> arrayIndex x >>= callChain
    _ -> pure x

functionCall :: Expression -> P Expression
functionCall f = do
  (a, args) <- withPosition . parens $ do
    t <- peek
    if isSym "{" t then namedArgs else commaSep expression
  pure (FunctionCall a f args)

-- | @{name: value, ...}@; the names are dropped.
namedArgs :: P [Expression]
namedArgs = braces $ commaSep (identifier *> sym ":" *> expression)

memberAccess :: Expression -> P Expression
memberAccess x = do
  (a, name) <- withPosition (sym "." *> anyWord)
  pure (MemberAccess a x (stringToLabel name))

-- | @x[i][j]@: one annotation for the whole group.
arrayIndex :: Expression -> P Expression
arrayIndex x = do
  (a, idxs) <- withPosition (many1While (isSym "[") (sym "[" *> optionalIf (not . isSym "]") expression <* sym "]"))
  pure (foldl' (IndexAccess a) x idxs)

tuple :: P Expression
tuple = do
  (a, exps) <- withPosition (parens (commaSep1 (optionalIf (\t -> not (isSym "," t || isSym ")" t)) expression)))
  pure $ case exps of
    [Just e] -> e
    _ -> TupleExpression a exps

array :: P Expression
array = do
  (a, exps) <- withPosition (brackets (commaSep expression))
  pure (ArrayExpression a exps)

-- | Keywords that are also expressions: builtin objects and type conversions.
keywordVariables :: Set.Set Text
keywordVariables = Set.fromList ["msg", "address", "account", "payable", "bool", "this", "block", "tx", "uint", "int", "decimal", "byte", "bytes", "string"]

primaryExpression :: P Expression
primaryExpression = do
  t <- peek
  case tKind t of
    TWord -> case tText t of
      "true" -> boolLiteral True
      "false" -> boolLiteral False
      "new" -> newExpression
      "hex" -> do
        t1 <- peekAt 1
        if tKind t1 == TString then hexLiteral else variable
      _ -> variable
    TDecimal -> numberLiteral
    TNumber -> expressionNumber
    TString -> uncurry StringLiteral <$> withPosition stringLiteral
    TOp | tText t == "<" -> uncurry AddressLiteral <$> withPosition accountLiteral
    TPunct | tText t == "(" -> tuple
    TPunct | tText t == "[" -> array
    _ -> empty

variable :: P Expression
variable = uncurry Variable <$> withPosition (stringToLabel <$> name)
  where
    name = next $ \t -> case tValue' t of
      Word w s keyword | not keyword || Set.member w keywordVariables -> Just s
      _ -> Nothing

boolLiteral :: Bool -> P Expression
boolLiteral b = uncurry BoolLiteral <$> withPosition (b <$ anyWord)

newExpression :: P Expression
newExpression = do
  (a, (t, salt)) <- withPosition $ do
    reserved "new"
    t <- simpleTypeExpression
    salt <- afterSym "{" (reserved "salt" *> sym ":" *> expression <* sym "}")
    pure (t, salt)
  pure (NewExpression a t salt)

-- | A number in an expression, the one place an exponent is accepted: @1e3@.
expressionNumber :: P Expression
expressionNumber = do
  (a, (n, u)) <- withPosition ((,) <$> number <*> optionalNext numberUnit)
  pure (NumberLiteral a n u)
  where
    number = next (\t -> case tValue' t of Number n -> Just n; Scientific n -> Just n; _ -> Nothing)

-- | A number, with an optional unit, or a decimal, after the optional sign
-- parsec's @integer@ accepts.
numberLiteral :: P Expression
numberLiteral = do
  (a, e) <- withPosition $ do
    neg <- negative
    t <- peek
    case tKind t of
      TDecimal -> DecimalLiteral () (WrappedDecimal (decimalOf neg t)) <$ skip
      _ -> (\n u -> NumberLiteral () (negated neg n) u) <$> natural <*> optionalNext numberUnit
  pure (a <$ e)

-- | The decimal of a 'TDecimal' token, negated when written with a @-@.
decimalOf :: Bool -> Token -> Decimal
decimalOf neg t = negated neg (read (show (tValue t) ++ "." ++ tStr t))

numberUnit :: Token -> Maybe NumberUnit
numberUnit t = case tText t of
  "wei" | tKind t == TWord -> Just Wei
  "szabo" | tKind t == TWord -> Just Szabo
  "finney" | tKind t == TWord -> Just Finney
  "ether" | tKind t == TWord -> Just Ether
  _ -> Nothing

-- | @hex"00ff"@: an even number of hex digits between quotes.
hexLiteral :: P Expression
hexLiteral = do
  (a, digits) <- withPosition $ do
    reserved "hex"
    digits <- T.unpack . T.init . T.tail . tText <$> peek
    hexDigits digits
    digits <$ skip
  pure (HexaLiteral a digits)

hexDigits :: String -> P ()
hexDigits digits
  | not (all isHexDigit digits) = failWith "a hex literal has only hex digits"
  | odd (length digits) = failWith "a hex literal has an even number of digits"
  | otherwise = pure ()

-- | @<hex>@ with nothing between the brackets; read from the source text,
-- since its parts are not tokens.
accountLiteral :: P Address
accountLiteral = do
  t <- peek
  Text arr off len <- source
  let raw = Text arr (tByte t) (off + len - tByte t)
      (digits, rest) = T.span isHexDigit (T.drop 1 raw)
  case (T.take 1 raw == "<" && T.take 1 rest == ">", readMaybe (T.unpack digits)) of
    (True, Just acct) -> do
      skipToByte (tByte t + lengthWord8 digits + 2)
      pure acct
    _ -> empty

------------------------------------------------------------------------------
-- Transaction arguments

-- | A literal as a transaction argument: a number, decimal, string, hex,
-- bool or account literal, an explicit cast (@uint(5)@, @string("123")@, ...),
-- an array or an object of these. A quoted string that reads as an address
-- is an address; @string(...)@ pins the type.
literal :: P Expression
literal = literal' <?> "literal"

literal' :: P Expression
literal' = do
  t <- peek
  case tKind t of
    TNumber -> numberLiteral
    TDecimal -> numberLiteral
    TOp | tText t == "-" || tText t == "+" -> numberLiteral
    TString -> do
      (a, s) <- withPosition stringLiteral
      pure $ maybe (StringLiteral a s) (AddressLiteral a) (readMaybe s)
    TWord -> case tText t of
      "true" -> boolLiteral True
      "false" -> boolLiteral False
      "hex" -> hexLiteral
      w | Set.member w castNames -> castLiteral
      _ -> empty
    TOp | tText t == "<" -> uncurry AddressLiteral <$> withPosition accountLiteral
    TPunct | tText t == "[" -> uncurry ArrayExpression <$> withPosition (brackets (commaSep literal))
    TPunct | tText t == "{" -> objectLiteral
    _ -> empty

castNames :: Set.Set Text
castNames = Set.fromList ["string", "address", "uint", "int", "bool", "decimal", "bytes"]

castLiteral :: P Expression
castLiteral = do
  (a, e) <- withPosition $ do
    name <- anyWord
    parens $ case name of
      "string" -> StringLiteral () <$> stringLiteral
      "address" -> AddressLiteral () <$> addressContent
      "uint" -> number
      "int" -> number
      "bool" -> BoolLiteral () <$> (next boolOf <?> "true or false")
      "decimal" -> DecimalLiteral () . WrappedDecimal <$> decimalContent
      "bytes" -> HexaLiteral () <$> bytesContent
      _ -> empty
  pure (a <$ e)
  where
    number = (\n -> NumberLiteral () n Nothing) <$> integer
    boolOf t = case tText t of
      "true" | tKind t == TWord -> Just True
      "false" | tKind t == TWord -> Just False
      _ -> Nothing
    -- a string, or hex digits with or without 0x, read from the source since
    -- they need not form one token
    addressContent = do
      t <- peek
      if tKind t == TString
        then stringLiteral >>= address
        else do
          Text arr off len <- source
          let raw = Text arr (tByte t) (off + len - tByte t)
              body = fromMaybe raw (T.stripPrefix "0x" raw)
              digits = T.takeWhile isHexDigit body
          if T.null digits
            then empty <?> "address"
            else do
              skipToByte (tByte t + lengthWord8 raw - lengthWord8 body + lengthWord8 digits)
              address (T.unpack digits)
    address s = maybe (failWith (show s ++ " is not an address")) pure (readMaybe s)
    decimalContent = do
      t <- peek
      case tKind t of
        TString -> do
          s <- stringLiteral
          maybe (failWith (show s ++ " is not a decimal")) pure (readMaybe s)
        _ -> do
          neg <- negative
          t' <- peek
          case tKind t' of
            TDecimal -> decimalOf neg t' <$ skip
            TNumber -> fromInteger . negated neg <$> natural
            _ -> empty <?> "decimal"
    bytesContent = do
      s <- stringLiteral
      hexDigits s
      pure s

-- | @{key: literal, ...}@; a key is the source text up to the colon, kept as
-- parsec shows it: escaped, with its trailing spaces.
objectLiteral :: P Expression
objectLiteral = do
  (a, kvs) <- withPosition $ braces $ commaSep $ do
    k <- rawKey
    sym ":"
    v <- literal
    pure (stringToLabel k, v)
  pure (ObjectLiteral a (Map.fromList kvs))
  where
    rawKey = do
      t <- peek
      Text arr off len <- source
      let raw = Text arr (tByte t) (off + len - tByte t)
          key = T.takeWhile (/= ':') raw
      if T.null key || lengthWord8 key == lengthWord8 raw
        then empty <?> "key"
        else do
          skipToByte (tByte t + lengthWord8 key)
          pure (init (drop 1 (show (T.unpack key))))
