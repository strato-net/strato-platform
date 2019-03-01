
module SolidVM.Solidity.Parse.Statement where

import           Data.Functor.Identity
import           Text.Parsec
import           Text.Parsec.Expr

import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Types
import           SolidVM.Solidity.Xabi.Statement




statements :: SolidityParser [Statement]
statements = braces $ many statement

statement :: SolidityParser Statement
statement = do
  ifStatement
  <|> whileStatement
  <|> forStatement
  <|> (reserved "return" >> Return <$> optionMaybe expression <* semi)
  <|> (do
          reserved "emit"
          ident <- identifier
          exps <- parens $ commaSep expression
          _ <- semi
          return $ EmitStatement ident $ map ((,) Nothing) exps
      )
  <|> try (SimpleStatement <$> variableDefinitionStatement <* semi)
  <|> (reserved "continue" >> return Continue <* semi)
  <|> (reserved "break" >> return Break <* semi)
  <|> (SimpleStatement . ExpressionStatement <$> expression <* semi)



{-
Statement = IfStatement | WhileStatement | ForStatement | Block | InlineAssemblyStatement |
            ( DoWhileStatement | PlaceholderStatement | Continue | Break | Return |
              Throw | EmitStatement | SimpleStatement ) ';'
-}


ifStatement :: SolidityParser Statement
ifStatement = do
  reserved "if"
  e <- parens expression
  s <- fmap (:[]) statement <|> statements
  elseStatement <- optionMaybe (reserved "else" >> (fmap (:[]) statement <|> statements))
  return $ IfStatement e s elseStatement

whileStatement :: SolidityParser Statement
whileStatement = do
  reserved "while"
  e <- parens expression
  s <- fmap (:[]) statement <|> statements
  elseStatement <- optionMaybe (reserved "else" >> (fmap (:[]) statement <|> statements))
  return $ IfStatement e s elseStatement

forStatement :: SolidityParser Statement
forStatement = do
  reserved "for"
  (v1, v2, v3) <- parens $ do
    v1 <- optionMaybe (try variableDefinitionStatement <|> fmap ExpressionStatement expression)
    reservedOp ";"
    v2 <- optionMaybe expression
    reservedOp ";"
    v3 <- optionMaybe expression
    return (v1, v2, v3)
  s <- statements
  return $ ForStatement v1 v2 v3 s



--ForStatement = 'for' '(' (SimpleStatement)? ';' (Expression)? ';' (ExpressionStatement)? ')' Statement

variableDefinitionStatement :: SolidityParser SimpleStatement
variableDefinitionStatement = do
  theType <- ((reserved "var" >> return Nothing) <|> Just <$> simpleTypeExpression)
  _ <- optional $ reserved "memory"
  names <- fmap ((:[]) . Just) identifier <|> parens (commaSep2 $ optionMaybe identifier)
  expr <- optionMaybe (reservedOp "=" >> expression)
  return $ VariableDefinition theType names expr

--TODO- someday we need to clean up this parser to avoid using any "try"s
commaSep2 :: SolidityParser a -> SolidityParser [a]
commaSep2 x = do
  first <- try $ x <* comma
  rest <- commaSep1 x
  return $ first:rest

expression :: SolidityParser Expression
expression =
  buildExpressionParser
  [
    [Postfix (do { exps <- many1 $ brackets $ optionMaybe expression; return $ foldl1 (.) $ map (flip IndexAccess) exps })],
    [postfix $ choice
     [
       (do { name <- (reservedOp "." >> memberName); return $ flip MemberAccess name}),
       (do { exps <- parens $ commaSep expression; return (\e -> FunctionCall e (map ((,) Nothing) exps))})
     ]
    ],
    [Postfix (do { reservedOp "++"; return PlusPlus})],
    [Postfix (reservedOp "--" >> return MinusMinus)],
    [prefix "!", prefix "~", prefix "delete", prefix "++", prefix "--", prefix "+", prefix "-"],
    [binary "**"],
    [binary "*", binary "/", binary "%"],
    [binary "+", binary "-"],
    [binary "<<", binary ">>"],
    [binary "&"],
    [binary "^"],
    [binary "|"],
    [binary "==", binary "!="],
    [binary "=", binary "|=", binary "^=", binary "&=", binary "<<=", binary ">>=", binary "+=", binary "-=", binary "*=", binary "/=", binary "%="],
    [binary "<", binary ">", binary "<=", binary ">="],
    [binary "&&"],
    [binary "||"],
    [Postfix (do { reservedOp "?"; e1 <- expression; reservedOp ":"; e2 <- expression; return (\e -> Ternary e e1 e2)})]
  ]
  (tuple <|> primaryExpression)

binary :: String -> Operator String u Identity Expression
binary x = Infix (do { reservedOp x; return (Binary x)}) AssocLeft

prefix :: String -> Operator String u Identity Expression
prefix x = Prefix (do { reservedOp x; return $ Unitary x})

postfix :: Stream s m t =>
           ParsecT s u m (a -> a) -> Operator s u m a
postfix p = Postfix . chainl1 p $ return (flip (.))

memberName :: SolidityParser String
memberName = do
  (reserved "length" >> return "length")
  <|> identifier

tuple :: SolidityParser Expression -- includes the case of a 1-tuple, ie- parens...  but just returns as a simple expression
tuple = do
  exps <- parens $ commaSep1 expression
  case exps of
    [exp'] -> return exp'
    _ -> return $ TupleExpression exps


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
  (reserved "msg" >> return (Variable "msg"))
  <|> (reserved "address" >> return (Variable "address"))
  <|> (reserved "this" >> return (Variable "this"))
  <|> (reserved "block" >> return (Variable "block"))
  <|> (reserved "tx" >> return (Variable "tx"))
  <|> (reserved "uint" >> return (Variable "uint"))
  <|> (reserved "byte" >> return (Variable "byte"))
  <|> (reserved "bytes" >> return (Variable "bytes"))
  <|> (reserved "string" >> return (Variable "string"))
  <|> (reserved "false" >> return (BoolLiteral False))
  <|> (reserved "true" >> return (BoolLiteral True))
  <|> (reserved "new" >> NewExpression <$> simpleTypeExpression)
  <|> (Variable <$> identifier)
  <|> (do { val <- natural; nu <- optionMaybe numberUnit; return $ NumberLiteral val nu})
  <|> (StringLiteral <$> stringLiteral)

numberUnit :: SolidityParser NumberUnit
numberUnit = do
  (reserved "wei" >> return Wei)
    <|> (reserved "szabo" >> return Szabo)
    <|> (reserved "finny" >> return Finney)
    <|> (reserved "ether" >> return Ether)


parseArgs :: SolidityParser [Expression]
parseArgs = parens $ commaSep expression
