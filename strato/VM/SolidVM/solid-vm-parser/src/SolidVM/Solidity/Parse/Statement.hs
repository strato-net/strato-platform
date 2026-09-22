{-# LANGUAGE NoMonomorphismRestriction #-}

module SolidVM.Solidity.Parse.Statement where

import Blockchain.Strato.Model.Address
import Control.Monad
import Data.Decimal
import Data.Foldable (asum, foldl')
import Data.Functor.Identity
import Data.List (uncons)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe)
import Data.Source
import qualified Data.Text as T
import SolidVM.Model.CodeCollection.Statement
import SolidVM.Model.SolidString
import SolidVM.Model.Type
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Types
import Text.Parsec hiding (uncons)
import Text.Parsec.Expr
import Text.Read (readMaybe)

statements :: SolidityParser [Statement]
statements = braces $ many statement

-- | Every alternative of 'anyStatement' that opens with a keyword accepts
-- exactly the input whose first word is that keyword, so the word selects it
-- directly. Anything else goes through the remaining alternatives in their
-- original order; 'orElse' keeps the error message identical on failure.
statement :: SolidityParser Statement
statement = do
  w <- peekWord
  case w of
    Just "if" -> ifStatement
    Just "while" -> whileStatement
    Just "try" -> tryStatement
    Just "do" -> doWhileStatement
    Just "for" -> forStatement
    Just "return" -> returnStatement
    Just "emit" -> emitStatement
    Just "throw" -> throwStatement
    Just "continue" -> continueStatement
    Just "break" -> breakStatement
    Just "revert" -> revertStatement `orElse` anyStatement
    Just _ ->
      ( variableDefinitionStatement'
          <|> assemblyStatement
          <|> modifierExecutorStatement
          <|> uncheckedStatement
          <|> expressionStatement
      )
        `orElse` anyStatement
    Nothing -> anyStatement

anyStatement :: SolidityParser Statement
anyStatement =
  ifStatement
    <|> whileStatement
    <|> tryStatement
    <|> doWhileStatement
    <|> forStatement
    <|> returnStatement
    <|> emitStatement
    <|> throwStatement
    <|> variableDefinitionStatement'
    <|> continueStatement
    <|> breakStatement
    <|> assemblyStatement
    <|> modifierExecutorStatement
    <|> revertStatement
    <|> uncheckedStatement
    <|> expressionStatement

tryStatement :: SolidityParser Statement
tryStatement = do
  reserved "try"
  solidityTryCatchStatement <|> tryCatchStatement -- hack to get it to differentiate between the two before parsing to avoid ambiguity

returnStatement :: SolidityParser Statement
returnStatement = do
  ~(a, e) <- withPosition $ do
    void $ reserved "return"
    optionMaybe expression
  _ <- semi
  pure $ Return e a

emitStatement :: SolidityParser Statement
emitStatement = do
  ~(a, (i, e)) <- withPosition $ do
    reserved "emit"
    ident <- identifier
    exps <- parens $ commaSep expression
    pure (ident, exps)
  _ <- semi
  pure $ EmitStatement i (map ((,) Nothing) e) a

variableDefinitionStatement' :: SolidityParser Statement
variableDefinitionStatement' = try $ do
  ~(a, e) <- (withPosition variableDefinitionStatement) <* semi
  pure $ SimpleStatement e a

continueStatement :: SolidityParser Statement
continueStatement = Continue <$> (position (reserved "continue") <* semi)

breakStatement :: SolidityParser Statement
breakStatement = Break <$> (position (reserved "break") <* semi)

assemblyStatement :: SolidityParser Statement
assemblyStatement = reserved "assembly" >> inlineAssembly

-- This parses the "_;" statement, which is used to signify when in a modifier the function should run
modifierExecutorStatement :: SolidityParser Statement
modifierExecutorStatement = ModifierExecutor <$> (position (reserved "_") <* semi)

expressionStatement :: SolidityParser Statement
expressionStatement = (\(a, e) -> SimpleStatement (ExpressionStatement e) a) <$> ((withPosition expression) <* semi)

{-
Statement = IfStatement | WhileStatement | ForStatement | Block | InlineAssemblyStatement |
            ( DoWhileStatement | PlaceholderStatement | Continue | Break | Return |
              Throw | EmitStatement | RevertStatement | SimpleStatement ) ';'
-}

solidityTryCatchStatement :: SolidityParser Statement
solidityTryCatchStatement = do
  ~(a, (tryExpression, returnsDecl, statementsForSuccess, catchArr)) <- withPosition $ do
    --    reserved "try"
    e <- expression
    mReturns <- optionMaybe $ do
      reserved "returns"
      tp <- tupleDeclaration'
      pure tp
    sms <- statements
    catchs <- many1 $ do
      reserved "catch"
      mIdent <- optionMaybe identifier
      mtps <- optionMaybe tupleDeclaration'
      ss <- statements
      (i, tps) <- case (mIdent, mtps) of
        (Just "Error", Just [(a, b)]) -> if (case b of (SVMType.String _) -> True; _ -> False) then pure ("Error", Just (a, b)) else fail "'Error' catch statement parameter type must be string"
        (Just "Error", Just xs) -> if Prelude.length xs < 2 then pure ("Error", Nothing) else fail "'Error' catch statement must only have one or zero parameters"
        (Just "Error", Nothing) -> pure ("Error", Nothing)
        (Just "Panic", Just [(a, b)]) -> if (case b of (SVMType.Int _ _) -> True; _ -> False) then pure ("Panic", Just (a, b)) else fail "'Panic' catch statement parameter type must be uint"
        (Just "Panic", Just xs) -> if Prelude.length xs < 2 then pure ("Panic", Nothing) else fail "'Panic' catch statement must only have one or zero parameters"
        (Just "Panic", Nothing) -> pure ("Panic", Nothing)
        (Nothing, Just [(a, b)]) -> if (case b of (SVMType.Bytes _ _) -> True; _ -> False) then pure ("Nill", Just (a, b)) else fail "the empty catch statement parameter type must be bytes"
        (Nothing, Just xs) -> if Prelude.length xs < 2 then pure ("Nill", Nothing) else fail "the empty catch statement must only have one or zero parameters"
        (Nothing, Nothing) -> pure ("Nill", Nothing)
        _ -> fail "catch statement must have a valid identifier such as 'Error' or 'Panic'"
      pure (i, (tps, ss))
    pure (e, mReturns, sms, catchs)
  pure $ SolidityTryCatchStatement tryExpression returnsDecl statementsForSuccess (Map.fromList catchArr) a

tupleDeclaration' :: SolidityParser [(String, SVMType.Type)]
tupleDeclaration' = parens $
  commaSep $ do
    partType <- simpleTypeExpression
    optional $
      reserved "indexed"
        <|> reserved "storage"
        <|> reserved "memory"
        <|> reserved "calldata"
    partName <- option "" identifier
    return (partName, partType)

tryCatchStatement :: SolidityParser Statement
tryCatchStatement = do
  ~(a, (test1, test2)) <- withPosition $ do
    --      reserved "try"
    s <- statements
    catchs <- many1 $ do
      reserved "catch"
      err <- option "" identifier
      params <- optionMaybe (parens $ commaSep $ do identifier)
      ss <- statements
      pure (err, (params, ss))
    pure (s, catchs)
  pure $ TryCatchStatement test1 (Map.fromList test2) a

ifStatement :: SolidityParser Statement
ifStatement = do
  ~(a, (i, t, e)) <- withPosition $ do
    reserved "if"
    e <- parens expression
    s <- fmap (: []) statement <|> statements
    elseStatement <- optionMaybe (reserved "else" >> (fmap (: []) statement <|> statements))
    pure (e, s, elseStatement)
  pure $ IfStatement i t e a

uncheckedStatement :: SolidityParser Statement
uncheckedStatement = try $ do
  ~(a, s) <- withPosition $ do
    reserved "unchecked"
    statements
  pure $ UncheckedStatement s a

whileStatement :: SolidityParser Statement
whileStatement = do
  ~(a, (e, s)) <- withPosition $ do
    reserved "while"
    e <- parens expression
    s <- fmap (: []) statement <|> statements
    pure (e, s)
  pure $ WhileStatement e s a

doWhileStatement :: SolidityParser Statement
doWhileStatement = do
  ~(a, (s, e)) <- withPosition $ do
    reserved "do"
    s <- fmap (: []) statement <|> statements
    reserved "while"
    e <- parens expression
    _ <- semi
    pure (s, e)
  pure $ DoWhileStatement s e a

forStatement :: SolidityParser Statement
forStatement = do
  ~(a, (v1, v2, v3, s)) <- withPosition $ do
    reserved "for"
    (v1, v2, v3) <- parens $ do
      v1 <- optionMaybe (try variableDefinitionStatement <|> fmap ExpressionStatement expression)
      reservedOp ";"
      v2 <- optionMaybe expression
      reservedOp ";"
      v3 <- optionMaybe expression
      return (v1, v2, v3)
    s <- statements
    pure (v1, v2, v3, s)
  pure $ ForStatement v1 v2 v3 s a

throwStatement :: SolidityParser Statement
throwStatement = do
  ~(a, (errorExp)) <- withPosition $ do
    reserved "throw"
    errorExp <- expression
    _ <- semi
    pure $ (errorExp)
  pure $ Throw errorExp a

-- revert("foo") <|> revert({x: y, q: z})
revertStatement :: SolidityParser Statement
revertStatement = try $ do
  ~(a, (i, e)) <- withPosition $ do
    reserved "revert"
    i <- optionMaybe identifier
    e <-
      parens $
        choice
          [ braces $
              commaSep $ do
                _ <- fmap stringToLabel identifier
                void colon -- lol
                fieldExpr <- expression
                return fieldExpr,
            commaSep expression
          ]
    pure (i, e)
  _ <- semi
  pure $ RevertStatement i e a

location :: SolidityParser (Maybe Location)
location =
  optionMaybe $
    asum
      [ reserved "memory" >> return Memory,
        reserved "storage" >> return Storage,
        reserved "calldata" >> return Calldata
      ]

varDefEntry :: SolidityParser (Maybe Type) -> SolidityParser VarDefEntry
varDefEntry tpar = do
  ~(a, (t, l, i)) <- withPosition $ liftM3 (,,) tpar location $ fmap stringToLabel identifier
  pure $ VarDefEntry t l i a

variableDefinitionStatement :: SolidityParser SimpleStatement
variableDefinitionStatement = do
  -- If "var", parse a standalone vardef or a type free tuple
  -- If there's a type, this must not be a tuple
  -- Otherwise, we have a tuple that needs to have a type on each entry
  vardefs <-
    choice $
      map
        try
        [ reserved "var" >> fmap (: []) (varDefEntry (return Nothing)),
          reserved "var" >> parens (commaSep1 $ option BlankEntry $ varDefEntry (return Nothing)),
          (: []) <$> varDefEntry (Just <$> simpleTypeExpression),
          parens (commaSep1 $ option BlankEntry $ varDefEntry (Just <$> simpleTypeExpression))
        ]
  VariableDefinition vardefs <$> optionMaybe (reservedOp "=" >> expression)

expression :: SolidityParser Expression
expression = do
  legacy <- getLegacyOperatorPrecedence
  fast <- getFastExpressions
  case (legacy, fast) of
    (True, True) -> legacyFastExpression
    (True, False) -> legacyExpression
    (False, True) -> solidityFastExpression
    (False, False) -> solidityExpression

-- | One precedence level of an operator table, tightest level first. Every
-- level holds operators of a single kind, which is what lets 'climb' read the
-- table the same way 'buildExpressionParser' does.
data Level
  = -- | Function calls, member accesses and index accesses, any number in a row.
    Calls
  | -- | One postfix operator, at most once.
    Post String (SourceAnnotation () -> Expression -> Expression)
  | -- | Prefix operators, at most one of them.
    Pre [String]
  | -- | Left-associative binary operators.
    InfixL [String]
  | -- | Right-associative binary operators.
    InfixR [String]
  | -- | The conditional @a ? b : c@, at most once.
    Tern

-- | Solidity's operator precedence, tightest first. Notable orderings that the
-- legacy table below got wrong: relational operators bind tighter than
-- equality, @&&@ tighter than @||@, both tighter than the ternary, and
-- assignment is the loosest of all (so @a = b || c@ assigns @b || c@).
-- @**@ and the assignment operators associate to the right.
solidityLevels :: [Level]
solidityLevels =
  [ Calls,
    Post "++" PlusPlus,
    Post "--" MinusMinus,
    Pre ["!", "~", "delete", "++", "--", "+", "-"],
    InfixR ["**"],
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
    Tern,
    InfixR ["=", "|=", "^=", "&=", "<<=", ">>=", ">>>=", "+=", "-=", "*=", "/=", "%="]
  ]

-- | The operator table SolidVM shipped with before the operator-precedence
-- fork. Kept verbatim so blocks produced under it still replay identically:
-- assignment binds tighter than @&&@ and @||@, which is why
-- @flag = flag || cond@ only ever stored @flag@.
legacyLevels :: [Level]
legacyLevels =
  [ Calls,
    Post "++" PlusPlus,
    Post "--" MinusMinus,
    Pre ["!", "~", "delete", "++", "--", "+", "-"],
    InfixL ["**"],
    InfixL ["*", "/", "%"],
    InfixL ["+", "-"],
    InfixL ["<<", ">>", ">>>"],
    InfixL ["&"],
    InfixL ["^"],
    InfixL ["|"],
    InfixL ["==", "!="],
    InfixL ["<", ">", "<=", ">="],
    Tern,
    InfixL ["=", "|=", "^=", "&=", "<<=", ">>=", ">>>=", "+=", "-=", "*=", "/=", "%="],
    InfixL ["&&"],
    InfixL ["||"]
  ]

operand :: SolidityParser Expression
operand = tuple <|> array <|> primaryExpression

-- | The reference expression parsers: 'buildExpressionParser' over the tables.
solidityExpression, legacyExpression :: SolidityParser Expression
solidityExpression = buildExpressionParser (map operators solidityLevels) operand
legacyExpression = buildExpressionParser (map operators legacyLevels) operand

operators :: Level -> [Operator String ParserState Identity Expression]
operators Calls = [Postfix callChain]
operators (Post o k) = [Postfix (k <$> position (reservedOp o))]
operators (Pre os) = map prefix os
operators (InfixL os) = map binary os
operators (InfixR os) = map binaryR os
operators Tern = [ternary]

-- | The fast expression parsers: 'climb' over the same tables.
solidityFastExpression, legacyFastExpression :: SolidityParser Expression
solidityFastExpression = climb solidityLevels
legacyFastExpression = climb legacyLevels

-- | Accepts exactly the language of @buildExpressionParser (map operators
-- levels) operand@ and builds the same tree, but reads the operator token
-- after an operand once ('peekOp') and hands it up through the levels, where
-- 'buildExpressionParser' attempts every operator of every level against it.
-- Each level does what its 'buildExpressionParser' counterpart does: an
-- infix level loops while the operator is one of its own; postfix and
-- conditional levels apply at most once; the prefix level takes at most one
-- operator, and, since @delete@ is not made of operator characters, looks
-- for it where no operator token is present. An operator token equals an
-- operator name exactly when 'reservedOp' of that name would succeed, so a
-- level that does not own the token leaves it to the next one, just as
-- every 'reservedOp' of the level would have failed.
climb :: [Level] -> SolidityParser Expression
climb levels = fst <$> foldl level base levels
  where
    base = (,) <$> operand <*> peekOp
    level term Calls = do
      (x, op) <- term
      post <- optionMaybe callChain
      case post of
        Nothing -> pure (x, op)
        Just f -> (,) (f x) <$> peekOp
    level term (Post o k) = do
      (x, op) <- term
      if op == Just o
        then do
          a <- position (reservedOp o)
          (,) (k a x) <$> peekOp
        else pure (x, op)
    level term (Pre os) = do
      op <- peekOp
      pre <- case op of
        Just o | o `elem` os -> Just <$> withPosition (o <$ reservedOp o)
        Nothing | "delete" `elem` os -> optionMaybe (withPosition ("delete" <$ reservedOp "delete"))
        _ -> pure Nothing
      (x, op') <- term
      pure (maybe x (\(a, o) -> Unitary a o x) pre, op')
    level term (InfixL os) = term >>= uncurry go
      where
        go x (Just o) | o `elem` os = do
          a <- position (reservedOp o)
          (y, op) <- term
          go (Binary a o x y) op
        go x op = pure (x, op)
    level term (InfixR os) = term >>= uncurry go
      where
        go x (Just o) | o `elem` os = do
          a <- position (reservedOp o)
          (z, op) <- term
          (y, op') <- go z op
          pure (Binary a o x y, op')
        go x op = pure (x, op)
    level term Tern = do
      (x, op) <- term
      if op == Just "?"
        then do
          f <- ternaryPostfix
          (,) (f x) <$> peekOp
        else pure (x, op)

callChain :: SolidityParser (Expression -> Expression)
callChain = chainl1 (choice [functionCall, memberAccess, arrayIndex]) $ return (flip (.))

ternary :: Operator String ParserState Identity Expression
ternary = Postfix ternaryPostfix

ternaryPostfix :: SolidityParser (Expression -> Expression)
ternaryPostfix = do
  ~(a, (e1, e2)) <- withPosition $ do
    reservedOp "?"
    e1 <- expression
    reservedOp ":"
    e2 <- expression
    pure (e1, e2)
  pure (\e -> Ternary (extractExpression e <> a) e e1 e2)

functionCall :: SolidityParser (Expression -> Expression)
functionCall = do
  ~(a, args) <-
    withPosition $
      parens $
        choice
          [ braces $
              commaSep $ do
                _ <- fmap stringToLabel identifier
                void colon -- haha
                fieldExpr <- expression
                return fieldExpr,
            commaSep expression
          ]
  return $ flip (FunctionCall a) args

memberAccess :: SolidityParser (Expression -> Expression)
memberAccess = do
  ~(a, name) <- withPosition $ reservedOp "." >> memberName
  return $ flip (MemberAccess a) name

arrayIndex :: SolidityParser (Expression -> Expression)
arrayIndex = do
  ~(a, idxs) <- withPosition $ many1 . brackets $ optionMaybe expression
  return $ \x -> foldl' (IndexAccess a) x idxs

binary :: String -> Operator String ParserState Identity Expression
binary x = Infix (uncurry Binary <$> withPosition (x <$ reservedOp x)) AssocLeft

binaryR :: String -> Operator String ParserState Identity Expression
binaryR x = Infix (uncurry Binary <$> withPosition (x <$ reservedOp x)) AssocRight

prefix :: String -> Operator String ParserState Identity Expression
prefix x = Prefix (uncurry Unitary <$> withPosition (x <$ reservedOp x))

memberName :: SolidityParser SolidString
memberName = do
  w <- peekWord
  case w of
    Just word | word `notElem` ["call", "derive", "length"] -> fmap stringToLabel identifier `orElse` anyMemberName
    _ -> anyMemberName

anyMemberName :: SolidityParser SolidString
anyMemberName =
  do
    (reserved "call" >> return (stringToLabel "call"))
    <|> (reserved "derive" >> return (stringToLabel "derive"))
    <|> (reserved "length" >> return (stringToLabel "length"))
    <|> fmap stringToLabel identifier

tuple :: SolidityParser Expression -- includes the case of a 1-tuple, ie- parens...  but just returns as a simple expression
tuple = do
  ~(a, exps) <- withPosition $ parens $ commaSep1 $ optionMaybe expression
  case exps of
    [Just exp'] -> return exp'
    _ -> return $ TupleExpression a exps

array :: SolidityParser Expression
array = do
  ~(a, exps) <- withPosition $ brackets $ commaSep expression
  return $ ArrayExpression a exps

-- Parses a JSON object style text into a Haskell Object literal type
-- Uses `literal` for values to support nested objects (used by API argument parsing)
objectE :: SolidityParser Expression
objectE = do
  ~(a, exps) <- withPosition $ braces $ commaSep assoc
  return $ ObjectLiteral a $ Map.fromList exps
  where
    assoc = do
      k <- many1 (noneOf ":")
      void colon
      v <- literal
      return (stringToLabel $ init . maybe "" snd . uncons $ show k, v) -- get rid of the surrounding quotes
      {-
      // Precedence by order (see github.com/ethereum/solidity/pull/732)
      Expression
        = Expression ('++' | '--')
        | NewExpression
        | IndexAccess
        | MemberAccess
        | FunctionCall
        | '(' Expression ')'
        | ('!' | '~' | 'delete' | '++' | '--' | '+' | '-') Expression
        | Expression '**' Expression
        | Expression ('*' | '/' | '%') Expression
        | Expression ('+' | '-') Expression
        | Expression ('<<' | '>>') Expression
        | Expression '&' Expression
        | Expression '^' Expression
        | Expression '|' Expression
        | Expression ('<' | '>' | '<=' | '>=') Expression
        | Expression ('==' | '!=') Expression
        | Expression '&&' Expression
        | Expression '||' Expression
        | Expression '?' Expression ':' Expression
        | Expression ('=' | '|=' | '^=' | '&=' | '<<=' | '>>=' | '+=' | '-=' | '*=' | '/=' | '%=') Expression
        | PrimaryExpression
      -}

-- | Keywords that 'anyPrimaryExpression' turns into a 'Variable'.
keywordVariables :: [String]
keywordVariables = ["msg", "address", "account", "payable", "bool", "this", "block", "tx", "uint", "int", "decimal", "byte", "bytes", "string"]

-- | A leading word selects its alternative in 'anyPrimaryExpression': the
-- keyword ones match exactly that word, and no literal starts with a word.
primaryExpression :: SolidityParser Expression
primaryExpression = do
  w <- peekWord
  case w of
    Nothing -> anyPrimaryExpression
    Just word -> byWord word `orElse` anyPrimaryExpression
  where
    byWord "hex" = myHexParser <|> variableExpression
    byWord "false" = boolLiteral "false" False
    byWord "true" = boolLiteral "true" True
    byWord "new" = newExpression
    byWord word
      | word `elem` keywordVariables = keywordVariable word
      | otherwise = variableExpression

anyPrimaryExpression :: SolidityParser Expression
anyPrimaryExpression =
  myHexParser
    <|> choice (map keywordVariable keywordVariables)
    <|> boolLiteral "false" False
    <|> boolLiteral "true" True
    <|> newExpression
    <|> decimalLiteral
    <|> variableExpression
    <|> ( do
            ~(a, (val, nu)) <- withPosition $ do
              val <- scientificInteger
              nu <- optionMaybe numberUnit
              pure (val, nu)
            pure $ NumberLiteral a val nu
        )
    <|> (uncurry StringLiteral <$> withPosition stringLiteral)
    <|> (uncurry AddressLiteral <$> withPosition accountLiteral)

keywordVariable :: String -> SolidityParser Expression
keywordVariable kw = uncurry Variable . fmap stringToLabel <$> withPosition (kw <$ reserved kw)

boolLiteral :: String -> Bool -> SolidityParser Expression
boolLiteral kw b = uncurry BoolLiteral <$> withPosition (b <$ reserved kw)

variableExpression :: SolidityParser Expression
variableExpression = uncurry Variable <$> withPosition (stringToLabel <$> identifier)

newExpression :: SolidityParser Expression
newExpression = do
  (a, (t, mSalt)) <- withPosition $ do
    reserved "new"
    t' <- simpleTypeExpression
    mSalt' <- optionMaybe . braces $ do
      reserved "salt"
      void colon
      expression
    pure (t', mSalt')
  pure $ NewExpression a t mSalt

decimalLiteral :: SolidityParser Expression
decimalLiteral = try $ do
  ~(a, decimalNum) <- withPosition $ do
    num <- lexeme $ integer
    period <- string "."
    fraction <- many1 digit
    skipMany space
    let decimalNum = read (show num ++ period ++ fraction) :: Decimal
    pure (decimalNum)
  pure $ DecimalLiteral a $ WrappedDecimal decimalNum

myHexParser :: SolidityParser Expression
myHexParser = try $ do
  ~(a, val) <- withPosition $ do
    reservedOp "hex"
    val' <- (between (symbol "\'") (symbol "\'") $ many1 hexDigit) <|> (between (symbol "\"") (symbol "\"") $ many1 hexDigit) --make this work with double quotes as well
    when (Prelude.length val' `mod` 2 /= 0) $ fail "hex digit must be even number"
    pure val'
  return $ HexaLiteral a val

scientific :: SolidityParser Integer
scientific = do
  leftVal <- integer
  _ <- symbol "e"
  rightVal <- integer
  pure $ leftVal * (10 ^ rightVal)

scientificInteger :: SolidityParser Integer
scientificInteger = do
  (try scientific) <|> integer

numberUnit :: SolidityParser NumberUnit
numberUnit = do
  (reserved "wei" >> return Wei)
    <|> (reserved "szabo" >> return Szabo)
    <|> (reserved "finney" >> return Finney)
    <|> (reserved "ether" >> return Ether)

parseArg :: SolidityParser Expression
parseArg = literal >>= (<$ eof)

parseArgs :: SolidityParser [Expression]
parseArgs = (try $ parens $ commaSep literal) <|> parseCreateArgs

parseCreateArgs :: SolidityParser [Expression]
parseCreateArgs = do
  void $ char '('
  str1 <- uncurry StringLiteral <$> withPosition stringLiteral  -- Contract Name
  void $ char ','
  str2 <- uncurry StringLiteral <$> withPosition parseCreateContractSrc  -- Contract Src
  str3 <- uncurry StringLiteral <$> withPosition parseCreateConstructArgs -- Constructor Args
  return [str1, str2, str3]

parseCreateContractSrc :: SolidityParser String
parseCreateContractSrc = do
  srcLength <- getContractSrcLength
  void $ string "\""
  case srcLength of
    0 -> manyTill anyChar (try (void $ string "\",\"("))
    _ -> count srcLength anyChar

parseCreateConstructArgs :: SolidityParser String
parseCreateConstructArgs = do
  srcLength <- getContractSrcLength
  case srcLength of
    0 -> do
      content <- manyTill anyChar (try $ (void $ string "\")") <* eof)
      return ('(' : content)
    _ -> do
      void $ string "\",\""
      manyTill anyChar (try $ (void $ string "\")") <* eof)

parseExternalCallArgs :: SolidityParser (SolidString, [SVMType.Type])
parseExternalCallArgs = do
  ~(fname, args) <- do
    name <- fromMaybe "fallback" <$> optionMaybe identifier
    args <- parens $ commaSep simpleType
    return (name, args)
  return (fname, args)

accountLiteral :: SolidityParser Address
accountLiteral = do
  void $ char '<'
  addr <- many1 hexDigit
  cId <- optionMaybe $ do
    void $ char ':'
    (reserved "main" >> pure "main") <|> many1 hexDigit
  let acctStr = addr ++ maybe "" (':' :) cId
  acct <- case readMaybe acctStr of
    Nothing -> fail $ "accountLiteral: Could not parse account from " ++ acctStr
    Just acct -> pure acct
  void $ char '>'
  pure acct

-- | Explicit type-cast literal forms for transaction args: string("…"),
-- address("hex"), uint(5), int(-5), bool(true), decimal("1.5"), bytes("00ff").
-- A plain quoted literal's type depends on its content ("123" parses as the
-- address 0x123), so a marshaler that knows the intended type emits the cast
-- form instead; string("123") is always the three-character string. Plain
-- literals keep their existing inference, so old-format args are unaffected.
castLiteral :: SolidityParser Expression
castLiteral =
  asum
    [ cast "string" StringLiteral stringLiteral,
      cast "address" AddressLiteral addressContent,
      cast "uint" (\a n -> NumberLiteral a n Nothing) integer,
      cast "int" (\a n -> NumberLiteral a n Nothing) integer,
      cast "bool" BoolLiteral boolContent,
      cast "decimal" (\a d -> DecimalLiteral a (WrappedDecimal d)) decimalContent,
      cast "bytes" HexaLiteral bytesContent
    ]
  where
    cast name f p = try $ do
      ~(a, v) <- withPosition $ reserved name >> parens p
      pure $ f a v
    addressContent = do
      s <- stringLiteral <|> lexeme rawHex
      case readMaybe s of
        Just addr -> pure addr
        Nothing -> fail $ "address(...): could not parse address from " ++ show s
    rawHex :: SolidityParser String
    rawHex = (++) <$> option "" (try $ string "0x") <*> many1 hexDigit
    boolContent = (False <$ reserved "false") <|> (True <$ reserved "true")
    decimalContent =
      asum
        [ try $ do
            num <- lexeme integer
            period <- string "."
            fraction <- many1 digit
            skipMany space
            pure (read (show num ++ period ++ fraction) :: Decimal),
          do
            s <- stringLiteral
            case readMaybe s of
              Just d -> pure d
              Nothing -> fail $ "decimal(...): could not parse decimal from " ++ show s,
          fromInteger <$> integer
        ]
    bytesContent = do
      s <- stringLiteral
      when (not (all (`elem` ("0123456789abcdefABCDEF" :: String)) s) || odd (Prelude.length s)) $
        fail "bytes(...): expected an even-length hex string"
      pure s

literal :: SolidityParser Expression
literal =
  asum
    [ ( try $ do
            ~(a, decimalNum) <- withPosition $ do
              num <- lexeme $ integer
              period <- string "."
              fraction <- many1 digit
              skipMany space
              let decimalNum = read (show num ++ period ++ fraction) :: Decimal
              pure (decimalNum)
            pure $ DecimalLiteral a $ WrappedDecimal decimalNum
      ),
      do
        ~(a, (n, u)) <- withPosition $ (,) <$> integer <*> optionMaybe numberUnit
        pure $ NumberLiteral a n u,
      myHexParser,
      castLiteral,
      do
        (a, str) <- withPosition stringLiteral
        pure $ case readMaybe str of
          Just addr -> AddressLiteral a addr
          _ -> StringLiteral a str,
      uncurry AddressLiteral <$> withPosition accountLiteral,
      uncurry BoolLiteral <$> withPosition (False <$ reserved "false"),
      uncurry BoolLiteral <$> withPosition (True <$ reserved "true"),
      uncurry ArrayExpression <$> withPosition (brackets $ commaSep literal),
      objectE
    ]

inlineAssembly :: SolidityParser Statement
inlineAssembly = do
  ~(a, e) <- withPosition $
    braces $ do
      let match = void . lexeme . string
      dst <- identifier
      match ":="
      match "mload"
      src <- parens $ do
        match "add"
        parens $ do
          src <- identifier
          void comma
          match "32"
          return src
      return $ MloadAdd32 (T.pack dst) (T.pack src)
  pure $ AssemblyStatement e a
