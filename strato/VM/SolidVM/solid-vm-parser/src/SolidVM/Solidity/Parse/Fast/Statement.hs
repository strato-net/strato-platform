{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.Statement
-- Description: Statements
module SolidVM.Solidity.Parse.Fast.Statement
  ( statement,
    statements,
    blockOrSemi,
  )
where

import qualified Data.Map as Map
import Data.Maybe (fromMaybe)
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
statements = sym "{" *> manyTillSym statement "}"

-- | A block, or @;@ for none.
blockOrSemi :: P (Maybe [Statement])
blockOrSemi = do
  t <- peek
  if isSym "{" t then Just <$> statements else Nothing <$ semi

statement :: P Statement
statement = statement' <?> "statement"

statement' :: P Statement
statement' = do
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
    simple = do
      definition <- startsDefinition
      if definition then variableDefinitionStatement else expressionStatement

-- | A block or a single statement.
body :: P [Statement]
body = do
  t <- peek
  if isSym "{" t then statements else (: []) <$> statement

ifStatement :: P Statement
ifStatement = do
  (a, (c, t, e)) <- withPosition $ do
    reserved "if"
    c <- parens expression
    t <- body
    e <- afterWord "else" body
    pure (c, t, e)
  pure (IfStatement c t e a)

whileStatement :: P Statement
whileStatement = do
  (a, (c, s)) <- withPosition $ do
    reserved "while"
    c <- parens expression
    s <- body
    pure (c, s)
  pure (WhileStatement c s a)

doWhileStatement :: P Statement
doWhileStatement = do
  (a, (s, c)) <- withPosition $ do
    reserved "do"
    s <- body
    reserved "while"
    c <- parens expression
    semi
    pure (s, c)
  pure (DoWhileStatement s c a)

forStatement :: P Statement
forStatement = do
  (a, (initial, cond, step, s)) <- withPosition $ do
    reserved "for"
    (initial, cond, step) <- parens $ do
      initial <- optionalIf (not . isSym ";") $ do
        definition <- startsDefinition
        if definition then variableDefinition else ExpressionStatement <$> expression
      semi
      cond <- optionalIf (not . isSym ";") expression
      semi
      step <- optionalIf (not . isSym ")") expression
      pure (initial, cond, step)
    s <- statements
    pure (initial, cond, step, s)
  pure (ForStatement initial cond step s a)

returnStatement :: P Statement
returnStatement = do
  (a, e) <- withPosition (reserved "return" *> optionalIf (not . isSym ";") expression)
  semi
  pure (Return e a)

emitStatement :: P Statement
emitStatement = do
  (a, (name, args)) <- withPosition $ do
    reserved "emit"
    name <- identifier
    args <- parens (commaSep expression)
    pure (name, args)
  semi
  pure (EmitStatement name (map ((,) Nothing) args) a)

throwStatement :: P Statement
throwStatement = do
  (a, e) <- withPosition (reserved "throw" *> expression <* semi)
  pure (Throw e a)

-- | @revert(args);@ or @revert Error(args);@; arguments may be named.
revertStatement :: P Statement
revertStatement = do
  (a, (name, args)) <- withPosition $ do
    reserved "revert"
    name <- optionalIdentifier
    args <- parens $ do
      t <- peek
      if isSym "{" t then braces (commaSep (identifier *> sym ":" *> expression)) else commaSep expression
    pure (name, args)
  semi
  pure (RevertStatement name args a)

uncheckedStatement :: P Statement
uncheckedStatement = do
  (a, s) <- withPosition (reserved "unchecked" *> statements)
  pure (UncheckedStatement s a)

expressionStatement :: P Statement
expressionStatement = do
  (a, e) <- withPosition expression
  semi
  pure (SimpleStatement (ExpressionStatement e) a)

------------------------------------------------------------------------------
-- Variable definitions

variableDefinitionStatement :: P Statement
variableDefinitionStatement = do
  (a, d) <- withPosition variableDefinition
  semi
  pure (SimpleStatement d a)

-- | Whether a variable definition, rather than an expression, starts here:
-- @var@, or a type followed by a name, or a tuple whose first entry is one.
-- Decided by looking at the tokens, so neither is ever parsed twice.
startsDefinition :: P Bool
startsDefinition = do
  t <- peek
  if
    | isWord "var" t -> pure True
    | isSym "(" t -> firstEntry 1
    | otherwise -> typedName 0
  where
    -- the first tuple entry that is not blank
    firstEntry n = do
      t <- peekAt n
      if isSym "," t then firstEntry (n + 1) else typedName n
    -- a type at token n, then a name; @new T@ is never a type
    typedName n = do
      t <- peekAt n
      t1 <- peekAt (n + 1)
      if
        | tKind t /= TWord || isWord "new" t -> pure False
        | isWord "mapping" t -> pure True
        | Just _ <- builtin (tText t) -> afterDims (if isWord "payable" t1 then n + 2 else n + 1)
        | not (isIdentifier t) -> pure False
        | isSym "." t1 -> afterDims (n + 3)
        | otherwise -> afterDims (n + 1)
    -- past the [..] dimensions from token n: a name?
    afterDims n = do
      t <- peekAt n
      if isSym "[" t then closing (n + 1) (1 :: Int) >>= afterDims else pure (isName t)
    -- the token after the ] that closes depth brackets, scanning from token n
    closing n depth = do
      t <- peekAt n
      if
        | tKind t == TEOF -> pure n
        | isSym "[" t -> closing (n + 1) (depth + 1)
        | isSym "]" t -> if depth == 1 then pure (n + 1) else closing (n + 1) (depth - 1)
        | otherwise -> closing (n + 1) depth
    isName t = isIdentifier t || isWord "memory" t || isWord "storage" t || isWord "calldata" t

-- | @var x@, @var (x, y)@, @T x@ or @(T x, U y)@, each with an optional
-- initializer.
variableDefinition :: P SimpleStatement
variableDefinition = do
  t <- peek
  entries <-
    if
      | isWord "var" t -> do
          skip
          t' <- peek
          if isSym "(" t' then tupleOf (entry (pure Nothing)) else (: []) <$> entry (pure Nothing)
      | isSym "(" t -> tupleOf (entry (Just <$> simpleTypeExpression))
      | otherwise -> (: []) <$> entry (Just <$> simpleTypeExpression)
  VariableDefinition entries <$> afterSym "=" expression
  where
    tupleOf e = parens (commaSep1 (blankOr e))
    blankOr e = do
      t <- peek
      if isSym "," t || isSym ")" t then pure BlankEntry else e
    entry typ = do
      (a, (t, loc, name)) <- withPosition $ do
        t <- typ
        loc <- location
        name <- stringToLabel <$> identifier
        pure (t, loc, name)
      pure (VarDefEntry t loc name a)

location :: P (Maybe Location)
location = optionalNext $ \t -> case tText t of
  "memory" | tKind t == TWord -> Just Memory
  "storage" | tKind t == TWord -> Just Storage
  "calldata" | tKind t == TWord -> Just Calldata
  _ -> Nothing

------------------------------------------------------------------------------
-- try / catch

tryStatement :: P Statement
tryStatement = do
  reserved "try"
  t <- peek
  if isSym "{" t then legacyTryCatch else solidityTryCatch

-- | @try expr [returns (...)] { ... } catch [Error|Panic] [(params)] { ... }...@
solidityTryCatch :: P Statement
solidityTryCatch = do
  (a, (e, returns, success, catches)) <- withPosition $ do
    e <- expression
    returns <- afterWord "returns" catchParams
    success <- statements
    catches <- many1While (isWord "catch") $ do
      reserved "catch"
      kind <- optionalIdentifier
      params <- optionalIf (isSym "(") catchParams
      (name, param) <- catchClause kind params
      s <- statements
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
      (Just "Error", _) -> failWith "catch Error takes one string parameter"
      (Just "Panic", _) -> failWith "catch Panic takes one uint parameter"
      (Nothing, _) -> failWith "catch takes one bytes parameter"
      (Just other, _) -> failWith ("unknown catch clause " ++ other ++ "; expected Error or Panic")

catchParams :: P [(String, SVMType.Type)]
catchParams = parens $
  commaSep $ do
    t <- simpleTypeExpression
    _ <- optionalIf (\k -> any (`isWord` k) ["indexed", "storage", "memory", "calldata"]) skip
    name <- fromMaybe "" <$> optionalIdentifier
    pure (name, t)

-- | @try { ... } catch [name] [(params)] { ... }...@
legacyTryCatch :: P Statement
legacyTryCatch = do
  (a, (s, catches)) <- withPosition $ do
    s <- statements
    catches <- many1While (isWord "catch") $ do
      reserved "catch"
      err <- fromMaybe "" <$> optionalIdentifier
      params <- optionalIf (isSym "(") (parens (commaSep identifier))
      ss <- statements
      pure (err, (params, ss))
    pure (s, catches)
  pure (TryCatchStatement s (Map.fromList catches) a)

------------------------------------------------------------------------------
-- Assembly

-- | The one supported form: @assembly { dst := mload(add(src, 32)) }@.
inlineAssembly :: P Statement
inlineAssembly = do
  (a, e) <- withPosition $
    braces $ do
      dst <- identifier
      sym ":="
      reserved "mload"
      src <- parens $ do
        reserved "add"
        parens (identifier <* comma <* next (\t -> if tKind t == TNumber && tValue t == 32 then Just () else Nothing))
      pure (MloadAdd32 (T.pack dst) (T.pack src))
  pure (AssemblyStatement e a)
