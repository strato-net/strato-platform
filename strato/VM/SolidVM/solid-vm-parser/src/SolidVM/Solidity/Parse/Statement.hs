{-# LANGUAGE NoMonomorphismRestriction #-}

module SolidVM.Solidity.Parse.Statement where

import Blockchain.Strato.Model.Account
import Control.Monad
import Data.Decimal
import Data.Foldable (asum, foldl')
import Data.Functor.Identity
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
import Text.Parsec
import Text.Parsec.Expr
import Text.Read (readMaybe)

statements :: SolidityParser [Statement]
statements = braces $ many statement

statement :: SolidityParser Statement
statement =
  ifStatement
    <|> whileStatement
    <|> ( do
            reserved "try"
            (solidityTryCatchStatement <|> tryCatchStatement) -- hack to get it to differentiate between the two before parsing to avoid ambiguity
        )
    <|> doWhileStatement
    <|> forStatement
    <|> ( do
            ~(a, e) <- withPosition $ do
              void $ reserved "return"
              optionMaybe expression
            _ <- semi
            pure $ Return e a
        )
    <|> ( do
            ~(a, (i, e)) <- withPosition $ do
              reserved "emit"
              ident <- identifier
              exps <- parens $ commaSep expression
              pure (ident, exps)
            _ <- semi
            pure $ EmitStatement i (map ((,) Nothing) e) a
        )
    <|> throwStatement
    <|> try
      ( do
          ~(a, e) <- (withPosition variableDefinitionStatement) <* semi
          pure $ SimpleStatement e a
      )
    <|> (Continue <$> (position (reserved "continue") <* semi))
    <|> (Break <$> (position (reserved "break") <* semi))
    <|> (reserved "assembly" >> inlineAssembly)
    <|> (ModifierExecutor <$> (position (reserved "_") <* semi)) -- This parses the "_;" statement, which is used to signify when in a modifier the function should run
    <|> ((\(a, e) -> SimpleStatement (ExpressionStatement e) a) <$> ((withPosition expression) <* semi))
    <|> revertStatement
    <|> uncheckedStatement

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
uncheckedStatement = do
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
          [ fmap NamedArgs . braces $
              commaSep $ do
                fieldName <- fmap stringToLabel identifier
                void colon -- lol
                fieldExpr <- expression
                return (fieldName, fieldExpr),
            OrderedArgs <$> commaSep expression
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
expression =
  buildExpressionParser
    [ [postfix $ choice [functionCall, memberAccess, arrayIndex]],
      [Postfix (PlusPlus <$> position (reservedOp "++"))],
      [Postfix (MinusMinus <$> position (reservedOp "--"))],
      [prefix "!", prefix "~", prefix "delete", prefix "++", prefix "--", prefix "+", prefix "-"],
      [binary "**"],
      [binary "*", binary "/", binary "%"],
      [binary "+", binary "-"],
      [binary "<<", binary ">>", binary ">>>"],
      [binary "&"],
      [binary "^"],
      [binary "|"],
      [binary "==", binary "!="],
      [binary "<", binary ">", binary "<=", binary ">="],
      [ Postfix
          ( do
              ~(a, (e1, e2)) <- withPosition $ do
                reservedOp "?"
                e1 <- expression
                reservedOp ":"
                e2 <- expression
                pure (e1, e2)
              pure (\e -> Ternary (extractExpression e <> a) e e1 e2)
          )
      ],
      [binary "=", binary "|=", binary "^=", binary "&=", binary "<<=", binary ">>=", binary ">>>=", binary "+=", binary "-=", binary "*=", binary "/=", binary "%="],
      [binary "&&"],
      [binary "||"]
    ]
    (tuple <|> array <|> primaryExpression)

functionCall :: SolidityParser (Expression -> Expression)
functionCall = do
  ~(a, args) <-
    withPosition $
      parens $
        choice
          [ fmap NamedArgs . braces $
              commaSep $ do
                fieldName <- fmap stringToLabel identifier
                void colon -- haha
                fieldExpr <- expression
                return (fieldName, fieldExpr),
            OrderedArgs <$> commaSep expression
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

binary :: String -> Operator String u Identity Expression
binary x = Infix (uncurry Binary <$> withPosition (x <$ reservedOp x)) AssocLeft

prefix :: String -> Operator String u Identity Expression
prefix x = Prefix (uncurry Unitary <$> withPosition (x <$ reservedOp x))

postfix ::
  Stream s m t =>
  ParsecT s u m (a -> a) ->
  Operator s u m a
postfix p = Postfix . chainl1 p $ return (flip (.))

memberName :: SolidityParser SolidString
memberName =
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
objectE :: SolidityParser Expression
objectE = do
  ~(a, exps) <- withPosition $ braces $ commaSep assoc
  return $ ObjectLiteral a $ Map.fromList exps
  where
    assoc = do
      k <- many1 (noneOf ":")
      void colon
      v <- expression
      return (stringToLabel $ init . tail $ show k, v) -- get rid of the surrounding quotes
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

primaryExpression :: SolidityParser Expression
primaryExpression = do
  let res' a b = withPosition $ b <$ reserved a
      res a = res' a a

  myHexParser
    <|> (uncurry Variable . fmap stringToLabel <$> res "msg")
    <|> (uncurry Variable . fmap stringToLabel <$> res "address")
    <|> (uncurry Variable . fmap stringToLabel <$> res "account")
    <|> (uncurry Variable . fmap stringToLabel <$> res "payable")
    <|> (uncurry Variable . fmap stringToLabel <$> res "bool")
    <|> (uncurry Variable . fmap stringToLabel <$> res "this")
    <|> (uncurry Variable . fmap stringToLabel <$> res "block")
    <|> (uncurry Variable . fmap stringToLabel <$> res "tx")
    <|> (uncurry Variable . fmap stringToLabel <$> res "uint")
    <|> (uncurry Variable . fmap stringToLabel <$> res "int")
    <|> (uncurry Variable . fmap stringToLabel <$> res "decimal")
    <|> (uncurry Variable . fmap stringToLabel <$> res "byte")
    <|> (uncurry Variable . fmap stringToLabel <$> res "bytes")
    <|> (uncurry Variable . fmap stringToLabel <$> res "string")
    <|> (uncurry BoolLiteral <$> res' "false" False)
    <|> (uncurry BoolLiteral <$> res' "true" True)
    <|> (uncurry NewExpression <$> withPosition (reserved "new" >> simpleTypeExpression))
    <|> ( try $ do
            ~(a, decimalNum) <- withPosition $ do
              num <- lexeme $ integer
              period <- string "."
              fraction <- many1 digit
              skipMany space
              let decimalNum = read (show num ++ period ++ fraction) :: Decimal
              pure (decimalNum)
            pure $ DecimalLiteral a $ WrappedDecimal decimalNum
          )
    <|> (uncurry Variable <$> withPosition (stringToLabel <$> identifier))
    <|> ( do
            ~(a, (val, nu)) <- withPosition $ do
              val <- scientificInteger
              nu <- optionMaybe numberUnit
              pure (val, nu)
            pure $ NumberLiteral a val nu
        )
    <|> (uncurry StringLiteral <$> withPosition stringLiteral)
    <|> (uncurry AccountLiteral <$> withPosition accountLiteral)

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

accountLiteral :: SolidityParser NamedAccount
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
      uncurry StringLiteral <$> withPosition stringLiteral,
      uncurry AccountLiteral <$> withPosition accountLiteral,
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
