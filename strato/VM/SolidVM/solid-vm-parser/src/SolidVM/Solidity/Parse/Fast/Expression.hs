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

-- | The operator or keyword operator at the current position, if any.
peekOp :: P (Maybe Text)
peekOp = do
  t <- peek
  pure $ case tKind t of
    TOp -> Just (tText t)
    TWord | tText t == "delete" -> Just (tText t)
    _ -> Nothing

-- | Precedence climbing: an operand, then operators of decreasing binding
-- power, each read once.
climb :: Table -> P Expression
climb tbl = do
  (x, op) <- unary
  fst <$> binaries tbl (tblTop tbl) x op

-- | An operand with its calls, postfix and prefix operators, and the
-- operator following it. NOINLINE: inlined into each other, 'unary' and
-- 'binaries' compile to code five times slower.
{-# NOINLINE unary #-}
unary :: P (Expression, Maybe Text)
unary = do
  op <- peekOp
  pre <- case op of
    Just o | o `elem` prefixOps -> Just <$> withPosition (o <$ next (const (Just ())))
    _ -> pure Nothing
  x0 <- operand
  x1 <- maybe x0 ($ x0) <$> optionMaybe callChain
  op1 <- peekOp
  (x2, op2) <- postfix "++" PlusPlus x1 op1
  (x3, op3) <- postfix "--" MinusMinus x2 op2
  pure (maybe x3 (\(a, o) -> Unitary a (T.unpack o) x3) pre, op3)
  where
    postfix o k x op
      | op == Just o = do
          a <- position (sym o)
          (,) (k a x) <$> peekOp
      | otherwise = pure (x, op)

-- | Applies the operators of level at most @bound@ following @x@.
{-# NOINLINE binaries #-}
binaries :: Table -> Int -> Expression -> Maybe Text -> P (Expression, Maybe Text)
binaries tbl bound = go
  where
    go x (Just o)
      | o == "?",
        tblTern tbl <= bound = do
          f <- ternary
          peekOp >>= go (f x)
      | Just (lvl, rassoc) <- Map.lookup o (tblOps tbl),
        lvl <= bound = do
          a <- position (sym o)
          (y0, op0) <- unary
          (y, op) <- binaries tbl (if rassoc then lvl else lvl - 1) y0 op0
          go (Binary a (T.unpack o) x y) op
    go x op = pure (x, op)

ternary :: P (Expression -> Expression)
ternary = do
  ~(a, (e1, e2)) <- withPosition $ do
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

-- | Calls, member accesses and indexings following an operand; dispatched
-- on the next token rather than tried in turn.
callChain :: P (Expression -> Expression)
callChain = chainl1 call (pure (flip (.)))
  where
    call = do
      t <- peek
      case tText t of
        "(" -> functionCall
        "." -> memberAccess
        "[" -> arrayIndex
        _ -> empty

functionCall :: P (Expression -> Expression)
functionCall = do
  ~(a, args) <- withPosition . parens $ do
    t <- peek
    if tText t == "{" then namedArgs else commaSep expression
  pure (flip (FunctionCall a) args)

-- | @{name: value, ...}@; the names are dropped.
namedArgs :: P [Expression]
namedArgs = braces $ commaSep (identifier *> sym ":" *> expression)

memberAccess :: P (Expression -> Expression)
memberAccess = do
  ~(a, name) <- withPosition (sym "." *> anyWord)
  pure (flip (MemberAccess a) (stringToLabel name))

arrayIndex :: P (Expression -> Expression)
arrayIndex = do
  ~(a, idxs) <- withPosition (many1 (brackets (optionMaybe expression)))
  pure (\x -> foldl' (IndexAccess a) x idxs)

tuple :: P Expression
tuple = do
  ~(a, exps) <- withPosition (parens (commaSep1 (optionMaybe expression)))
  pure $ case exps of
    [Just e] -> e
    _ -> TupleExpression a exps

array :: P Expression
array = do
  ~(a, exps) <- withPosition (brackets (commaSep expression))
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
    TDecimal -> decimalLiteral
    TNumber -> numberLiteral
    TString -> uncurry StringLiteral <$> withPosition stringLiteral
    TOp | tText t == "<" -> uncurry AddressLiteral <$> withPosition accountLiteral
    TPunct | tText t == "(" -> tuple
    TPunct | tText t == "[" -> array
    _ -> empty

variable :: P Expression
variable = uncurry Variable <$> withPosition (stringToLabel <$> name)
  where
    name = next $ \t ->
      if tKind t == TWord && (Set.member (tText t) keywordVariables || not (Set.member (tText t) reservedNames))
        then Just (T.unpack (tText t))
        else Nothing

boolLiteral :: Bool -> P Expression
boolLiteral b = uncurry BoolLiteral <$> withPosition (b <$ anyWord)

newExpression :: P Expression
newExpression = do
  (a, (t, salt)) <- withPosition $ do
    reserved "new"
    t <- simpleTypeExpression
    salt <- optionMaybe (braces (reserved "salt" *> sym ":" *> expression))
    pure (t, salt)
  pure (NewExpression a t salt)

decimalLiteral :: P Expression
decimalLiteral = do
  ~(a, d) <- withPosition $ next $ \t -> if tKind t == TDecimal then Just (decimalOf t) else Nothing
  pure (DecimalLiteral a (WrappedDecimal d))

decimalOf :: Token -> Decimal
decimalOf t = read (show (tValue t) ++ "." ++ tStr t)

numberLiteral :: P Expression
numberLiteral = do
  ~(a, (val, unit)) <- withPosition ((,) <$> integer <*> optionMaybe numberUnit)
  pure (NumberLiteral a val unit)

numberUnit :: P NumberUnit
numberUnit = next $ \t -> case tText t of
  "wei" | tKind t == TWord -> Just Wei
  "szabo" | tKind t == TWord -> Just Szabo
  "finney" | tKind t == TWord -> Just Finney
  "ether" | tKind t == TWord -> Just Ether
  _ -> Nothing

-- | @hex"00ff"@: an even number of hex digits between quotes.
hexLiteral :: P Expression
hexLiteral = do
  ~(a, digits) <- withPosition $ do
    reserved "hex"
    digits <- T.unpack . T.init . T.tail . tText <$> peek
    hexDigits digits
    digits <$ next (const (Just ()))
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
    TDecimal -> decimalLiteral
    TString -> do
      ~(a, s) <- withPosition stringLiteral
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
  ~(a, e) <- withPosition $ do
    name <- anyWord
    parens $ case name of
      "string" -> StringLiteral () <$> stringLiteral
      "address" -> AddressLiteral () <$> addressContent
      "uint" -> number
      "int" -> number
      "bool" -> BoolLiteral () <$> ((True <$ reserved "true") <|> (False <$ reserved "false"))
      "decimal" -> DecimalLiteral () . WrappedDecimal <$> decimalContent
      "bytes" -> HexaLiteral () <$> bytesContent
      _ -> empty
  pure (a <$ e)
  where
    number = do
      negative <- option False (True <$ sym "-")
      n <- integer
      pure (NumberLiteral () (if negative then negate n else n) Nothing)
    -- a string, or the text of a number token: hex digits, with or without 0x
    addressContent = do
      s <- stringLiteral <|> next (\t -> if tKind t == TNumber then Just (T.unpack (stripHex (tText t))) else Nothing)
      maybe (failWith (show s ++ " is not an address")) pure (readMaybe s)
    stripHex s = fromMaybe s (T.stripPrefix "0x" s)
    decimalContent =
      next (\t -> if tKind t == TDecimal then Just (decimalOf t) else Nothing)
        <|> (stringLiteral >>= \s -> maybe (failWith (show s ++ " is not a decimal")) pure (readMaybe s))
        <|> (fromInteger <$> integer)
    bytesContent = do
      s <- stringLiteral
      hexDigits s
      pure s

-- | @{key: literal, ...}@; a key is a word or a string.
objectLiteral :: P Expression
objectLiteral = do
  ~(a, kvs) <- withPosition $ braces $ commaSep $ do
    k <- anyWord <|> stringLiteral
    sym ":"
    v <- literal
    pure (stringToLabel k, v)
  pure (ObjectLiteral a (Map.fromList kvs))
