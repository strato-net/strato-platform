{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Statement
-- Description: Statements
module SolidVM.Solidity.Parse.Fast.Statement
  ( statement,
    statements,
  )
where

import qualified Data.Map as Map
import qualified Data.Text as T
import SolidVM.Model.CodeCollection.Statement
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Fast.Expression
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.Fast.Types

-- | A block: statements between braces.
statements :: P [Statement]
statements = braces (many statement)

statement :: P Statement
statement = do
  t <- peek
  case tKind t of
    TWord -> case tText t of
      "if" -> ifStatement
      "while" -> whileStatement
      "try" -> tryStatement
      "do" -> doWhileStatement
      "for" -> forStatement
      "return" -> returnStatement
      "emit" -> emitStatement
      "throw" -> throwStatement
      "continue" -> Continue <$> (position (reserved "continue") <* semi)
      "break" -> Break <$> (position (reserved "break") <* semi)
      "revert" -> revertStatement
      "assembly" -> reserved "assembly" *> inlineAssembly
      "unchecked" -> uncheckedStatement
      "_" -> ModifierExecutor <$> (position (reserved "_") <* semi)
      _ -> simple
    _ -> simple
  where
    simple = variableDefinitionStatement <|> expressionStatement

-- | A block or a single statement.
body :: P [Statement]
body = statements <|> ((: []) <$> statement)

ifStatement :: P Statement
ifStatement = do
  ~(a, (c, t, e)) <- withPosition $ do
    reserved "if"
    c <- parens expression
    t <- body
    e <- optionMaybe (reserved "else" *> body)
    pure (c, t, e)
  pure (IfStatement c t e a)

whileStatement :: P Statement
whileStatement = do
  ~(a, (c, s)) <- withPosition $ do
    reserved "while"
    c <- parens expression
    s <- body
    pure (c, s)
  pure (WhileStatement c s a)

doWhileStatement :: P Statement
doWhileStatement = do
  ~(a, (s, c)) <- withPosition $ do
    reserved "do"
    s <- body
    reserved "while"
    c <- parens expression
    semi
    pure (s, c)
  pure (DoWhileStatement s c a)

forStatement :: P Statement
forStatement = do
  ~(a, (initial, cond, step, s)) <- withPosition $ do
    reserved "for"
    (initial, cond, step) <- parens $ do
      initial <- optionMaybe (try variableDefinition <|> (ExpressionStatement <$> expression))
      semi
      cond <- optionMaybe expression
      semi
      step <- optionMaybe expression
      pure (initial, cond, step)
    s <- statements
    pure (initial, cond, step, s)
  pure (ForStatement initial cond step s a)

returnStatement :: P Statement
returnStatement = do
  ~(a, e) <- withPosition (reserved "return" *> optionMaybe expression)
  semi
  pure (Return e a)

emitStatement :: P Statement
emitStatement = do
  ~(a, (name, args)) <- withPosition $ do
    reserved "emit"
    name <- identifier
    args <- parens (commaSep expression)
    pure (name, args)
  semi
  pure (EmitStatement name (map ((,) Nothing) args) a)

throwStatement :: P Statement
throwStatement = do
  ~(a, e) <- withPosition (reserved "throw" *> expression <* semi)
  pure (Throw e a)

-- | @revert(args);@ or @revert Error(args);@; arguments may be named.
revertStatement :: P Statement
revertStatement = do
  ~(a, (name, args)) <- withPosition $ do
    reserved "revert"
    name <- optionMaybe identifier
    args <- parens (braces (commaSep (identifier *> sym ":" *> expression)) <|> commaSep expression)
    pure (name, args)
  semi
  pure (RevertStatement name args a)

uncheckedStatement :: P Statement
uncheckedStatement = do
  ~(a, s) <- withPosition (reserved "unchecked" *> statements)
  pure (UncheckedStatement s a)

expressionStatement :: P Statement
expressionStatement = do
  ~(a, e) <- withPosition expression
  semi
  pure (SimpleStatement (ExpressionStatement e) a)

------------------------------------------------------------------------------
-- Variable definitions

variableDefinitionStatement :: P Statement
variableDefinitionStatement = try $ do
  ~(a, d) <- withPosition variableDefinition
  semi
  pure (SimpleStatement d a)

-- | @var x@, @var (x, y)@, @T x@ or @(T x, U y)@, each with an optional
-- initializer.
variableDefinition :: P SimpleStatement
variableDefinition = do
  entries <-
    (reserved "var" *> (parens (commaSep1 (option BlankEntry (entry (pure Nothing)))) <|> ((: []) <$> entry (pure Nothing))))
      <|> parens (commaSep1 (option BlankEntry (entry (Just <$> simpleTypeExpression))))
      <|> ((: []) <$> entry (Just <$> simpleTypeExpression))
  VariableDefinition entries <$> optionMaybe (sym "=" *> expression)
  where
    entry typ = do
      ~(a, (t, loc, name)) <- withPosition $ do
        t <- typ
        loc <- location
        name <- stringToLabel <$> identifier
        pure (t, loc, name)
      pure (VarDefEntry t loc name a)

location :: P (Maybe Location)
location =
  optionMaybe $
    (Memory <$ reserved "memory")
      <|> (Storage <$ reserved "storage")
      <|> (Calldata <$ reserved "calldata")

------------------------------------------------------------------------------
-- try / catch

tryStatement :: P Statement
tryStatement = do
  reserved "try"
  solidityTryCatch <|> legacyTryCatch

-- | @try expr [returns (...)] { ... } catch [Error|Panic] [(params)] { ... }...@
solidityTryCatch :: P Statement
solidityTryCatch = do
  ~(a, (e, returns, success, catches)) <- withPosition $ do
    e <- expression
    returns <- optionMaybe (reserved "returns" *> catchParams)
    success <- statements
    catches <- many1 $ do
      reserved "catch"
      kind <- optionMaybe identifier
      params <- optionMaybe catchParams
      s <- statements
      (name, param) <- catchClause kind params
      pure (name, (param, s))
    pure (e, returns, success, catches)
  pure (SolidityTryCatchStatement e returns success (Map.fromList catches) a)
  where
    -- @catch Error(string)@, @catch Panic(uint)@ and the plain @catch (bytes)@,
    -- each with at most one, correctly typed, parameter
    catchClause kind params = case (kind, params) of
      (Just "Error", Just [(n, t@(SVMType.String _))]) -> pure ("Error", Just (n, t))
      (Just "Panic", Just [(n, t@(SVMType.Int _ _))]) -> pure ("Panic", Just (n, t))
      (Nothing, Just [(n, t@(SVMType.Bytes _ _))]) -> pure ("Nill", Just (n, t))
      (Just "Error", ps) | maybe True null ps -> pure ("Error", Nothing)
      (Just "Panic", ps) | maybe True null ps -> pure ("Panic", Nothing)
      (Nothing, ps) | maybe True null ps -> pure ("Nill", Nothing)
      _ -> empty

catchParams :: P [(String, SVMType.Type)]
catchParams = parens $
  commaSep $ do
    t <- simpleTypeExpression
    optional (reserved "indexed" <|> reserved "storage" <|> reserved "memory" <|> reserved "calldata")
    name <- option "" identifier
    pure (name, t)

-- | @try { ... } catch [name] [(params)] { ... }...@
legacyTryCatch :: P Statement
legacyTryCatch = do
  ~(a, (s, catches)) <- withPosition $ do
    s <- statements
    catches <- many1 $ do
      reserved "catch"
      err <- option "" identifier
      params <- optionMaybe (parens (commaSep identifier))
      ss <- statements
      pure (err, (params, ss))
    pure (s, catches)
  pure (TryCatchStatement s (Map.fromList catches) a)

------------------------------------------------------------------------------
-- Assembly

-- | The one supported form: @assembly { dst := mload(add(src, 32)) }@.
inlineAssembly :: P Statement
inlineAssembly = do
  ~(a, e) <- withPosition $
    braces $ do
      dst <- identifier
      sym ":="
      reserved "mload"
      src <- parens $ do
        reserved "add"
        parens (identifier <* comma <* next (\t -> if tKind t == TNumber && tValue t == 32 then Just () else Nothing))
      pure (MloadAdd32 (T.pack dst) (T.pack src))
  pure (AssemblyStatement e a)
