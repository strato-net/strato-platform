
module SolidVM.Solidity.Parse.Statement where

import           Control.Monad
import           Data.Foldable (asum, foldl')
import           Data.Functor.Identity
import qualified Data.Text as T
import           Text.Parsec
import           Text.Parsec.Expr

import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Types
import           SolidVM.Solidity.Xabi.Statement
import           SolidVM.Solidity.Xabi.Type




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
  <|> (reserved "assembly" >> inlineAssembly)
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
  return $ WhileStatement e s

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

location :: SolidityParser (Maybe Location)
location = optionMaybe $ asum [ reserved "memory" >> return Memory
                              , reserved "storage" >> return Storage
                              ]

varDefEntry :: SolidityParser (Maybe Type) -> SolidityParser VarDefEntry
varDefEntry tpar = liftM3 VarDefEntry tpar location identifier

variableDefinitionStatement :: SolidityParser SimpleStatement
variableDefinitionStatement = do
  -- If "var", parse a standalone vardef or a type free tuple
  -- If there's a type, this must not be a tuple
  -- Otherwise, we have a tuple that needs to have a type on each entry
  vardefs <- choice $ map try
      [ reserved "var" >> fmap (:[]) (varDefEntry (return Nothing))
      , reserved "var" >> parens (commaSep1 $ option BlankEntry $ varDefEntry (return Nothing))
      , (:[]) <$> varDefEntry (Just <$> simpleTypeExpression)
      , parens (commaSep1 $ varDefEntry (Just <$> simpleTypeExpression))
      ]
  VariableDefinition vardefs <$> optionMaybe (reservedOp "=" >> expression)

expression :: SolidityParser Expression
expression =
  buildExpressionParser
  [
    [postfix $ choice [functionCall, memberAccess, arrayIndex]],
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
  (tuple <|> array <|> primaryExpression)

functionCall :: SolidityParser (Expression -> Expression)
functionCall = do
  args <- parens $ choice
    [ fmap NamedArgs . braces $ commaSep $ do
        fieldName <- identifier
        void colon -- haha
        fieldExpr <- expression
        return (fieldName, fieldExpr)
    , OrderedArgs <$> commaSep expression
    ]
  return $ flip FunctionCall args

memberAccess :: SolidityParser (Expression -> Expression)
memberAccess = do
  name <- reservedOp "." >> memberName
  return $ flip MemberAccess name

arrayIndex :: SolidityParser (Expression -> Expression)
arrayIndex = do
  idxs <- many1 . brackets $ optionMaybe expression
  return $ \x -> foldl' IndexAccess x idxs

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
  exps <- parens $ commaSep1 $ optionMaybe expression
  case exps of
    [Just exp'] -> return exp'
    _ -> return $ TupleExpression exps

array :: SolidityParser Expression
array = do
  exps <- brackets $ commaSep1 expression
  return $ ArrayExpression exps


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
  <|> (reserved "int" >> return (Variable "int"))
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
parseArgs = parens $ commaSep literal

literal :: SolidityParser Expression
literal = asum
        [ liftM2 NumberLiteral natural (optionMaybe numberUnit)
        , StringLiteral <$> stringLiteral
        , reserved "false" >> return (BoolLiteral False)
        , reserved "true" >> return (BoolLiteral True)
        , ArrayExpression <$> brackets (commaSep1 literal)
        ]

inlineAssembly :: SolidityParser Statement
inlineAssembly = fmap AssemblyStatement . braces $ do
  let match = void . lexeme . string
  dst <- identifier
  match ":="
  match "mload"
  src <- parens $ do
    match "add"
    parens $ do
      src <- identifier
      void $ comma
      match "32"
      return src
  return $ MloadAdd32 (T.pack dst) (T.pack src)
