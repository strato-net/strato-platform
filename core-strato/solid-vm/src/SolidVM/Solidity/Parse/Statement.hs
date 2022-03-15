{-# LANGUAGE NoMonomorphismRestriction #-}

module SolidVM.Solidity.Parse.Statement where

import           Control.Monad
import           Data.Foldable (asum, foldl')
import           Data.Functor.Identity
import           Data.Source
import qualified Data.Text as T
import           Text.Parsec
import           Text.Parsec.Expr

import           SolidVM.Model.CodeCollection.Statement
import           SolidVM.Model.Type
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Types

statements :: SolidityParser [Statement]
statements = braces $ many statement

statement :: SolidityParser Statement
statement = do
  ifStatement
  <|> whileStatement
  <|> doWhileStatement
  <|> forStatement
  <|> (do
          ~(a, e) <- withPosition $ do
            void $ reserved "return"
            optionMaybe expression
          _ <- semi
          pure $ Return e a)
  <|> (do
          ~(a, (i, e)) <- withPosition $ do
            reserved "emit"
            ident <- identifier
            exps <- parens $ commaSep expression
            pure (ident, exps)
          _ <- semi
          pure $ EmitStatement i (map ((,) Nothing) e) a
      )
  <|> try (do
              ~(a, e) <- (withPosition variableDefinitionStatement) <* semi
              pure $ SimpleStatement e a 
          )
  <|> (Continue <$> (position (reserved "continue") <* semi))
  <|> (Break <$> (position (reserved "break") <* semi))
  <|> (reserved "assembly" >> inlineAssembly)
  <|> ((\(a,e) -> SimpleStatement (ExpressionStatement e) a) <$> ((withPosition expression) <* semi))



{-
Statement = IfStatement | WhileStatement | ForStatement | Block | InlineAssemblyStatement |
            ( DoWhileStatement | PlaceholderStatement | Continue | Break | Return |
              Throw | EmitStatement | SimpleStatement ) ';'
-}


ifStatement :: SolidityParser Statement
ifStatement = do
  ~(a, (i,t,e)) <- withPosition $ do
    reserved "if"
    e <- parens expression
    s <- fmap (:[]) statement <|> statements
    elseStatement <- optionMaybe (reserved "else" >> (fmap (:[]) statement <|> statements))
    pure (e,s,elseStatement)
  pure $ IfStatement i t e a

whileStatement :: SolidityParser Statement
whileStatement = do
  ~(a, (e, s)) <- withPosition $ do
    reserved "while"
    e <- parens expression
    s <- fmap (:[]) statement <|> statements
    pure (e, s)
  pure $ WhileStatement e s a

doWhileStatement :: SolidityParser Statement
doWhileStatement = do
  ~(a, (s, e)) <- withPosition $ do
    reserved "do"
    s <- fmap (:[]) statement <|> statements
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



--ForStatement = 'for' '(' (SimpleStatement)? ';' (Expression)? ';' (ExpressionStatement)? ')' Statement

location :: SolidityParser (Maybe Location)
location = optionMaybe $ asum [ reserved "memory" >> return Memory
                              , reserved "storage" >> return Storage
                              ]

varDefEntry :: SolidityParser (Maybe Type) -> SolidityParser VarDefEntry
varDefEntry tpar = do
  ~(a, (t,l,i)) <- withPosition $ liftM3 (,,) tpar location identifier
  pure $ VarDefEntry t l i a

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
    [Postfix (PlusPlus <$> position (reservedOp "++"))],
    [Postfix (MinusMinus <$> position (reservedOp "--"))],
    [prefix "!", prefix "~", prefix "delete", prefix "++", prefix "--", prefix "+", prefix "-"],
    [binary "**"],
    [binary "*", binary "/", binary "%"],
    [binary "+", binary "-"],
    [binary "<<", binary ">>"],
    [binary "&"],
    [binary "^"],
    [binary "|"],
    [binary "==", binary "!="],
    [binary "<", binary ">", binary "<=", binary ">="],
    [Postfix (do
                 ~(a, (e1, e2)) <- withPosition $ do
                   reservedOp "?"
                   e1 <- expression
                   reservedOp ":"
                   e2 <- expression
                   pure (e1, e2)
                 pure (\e -> Ternary (extractExpression e <> a) e e1 e2)
             )],
    [binary "=", binary "|=", binary "^=", binary "&=", binary "<<=", binary ">>=", binary "+=", binary "-=", binary "*=", binary "/=", binary "%="],
    [binary "&&"],
    [binary "||"]
  ]
  (tuple <|> array <|> primaryExpression)

functionCall :: SolidityParser (Expression -> Expression)
functionCall = do
  ~(a, args) <- withPosition $ parens $ choice
    [ fmap NamedArgs . braces $ commaSep $ do
        fieldName <- identifier
        void colon -- haha
        fieldExpr <- expression
        return (fieldName, fieldExpr)
    , OrderedArgs <$> commaSep expression
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

postfix :: Stream s m t =>
           ParsecT s u m (a -> a) -> Operator s u m a
postfix p = Postfix . chainl1 p $ return (flip (.))

memberName :: SolidityParser String
memberName = do
  (reserved "length" >> return "length")
  <|> identifier

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
      res  a   = res' a a
  (uncurry Variable <$> res "msg")
    <|> (uncurry Variable <$> res "address")
    <|> (uncurry Variable <$> res "account")
    <|> (uncurry Variable <$> res "bool")
    <|> (uncurry Variable <$> res "this")
    <|> (uncurry Variable <$> res "block")
    <|> (uncurry Variable <$> res "tx")
    <|> (uncurry Variable <$> res "uint")
    <|> (uncurry Variable <$> res "int")
    <|> (uncurry Variable <$> res "byte")
    <|> (uncurry Variable <$> res "bytes")
    <|> (uncurry Variable <$> res "string")
    <|> (uncurry BoolLiteral <$> res' "false" False)
    <|> (uncurry BoolLiteral <$> res' "true" True)
    <|> (uncurry NewExpression <$> withPosition (reserved "new" >> simpleTypeExpression))
    <|> (uncurry Variable <$> withPosition identifier)
    <|> (do 
            ~(a, (val, nu)) <- withPosition $ do
              val <- integer
              nu <- optionMaybe numberUnit
              pure (val, nu)
            pure $ NumberLiteral a val nu)
    <|> (uncurry StringLiteral <$> withPosition stringLiteral)

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
        [ do
            ~(a, (n, u)) <- withPosition $ (,) <$> integer <*> optionMaybe numberUnit
            pure $ NumberLiteral a n u
        , uncurry StringLiteral <$> withPosition stringLiteral
        , uncurry BoolLiteral <$> withPosition (False <$ reserved "false")
        , uncurry BoolLiteral <$> withPosition (True <$ reserved "true")
        , uncurry ArrayExpression <$> withPosition (brackets $ commaSep literal)
        ]

inlineAssembly :: SolidityParser Statement
inlineAssembly = do
  ~(a, e) <- withPosition $ braces $ do
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
  pure $ AssemblyStatement e a
