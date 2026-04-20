{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE FlexibleContexts #-}

-- | Parser for inline assembly (Yul) blocks. Grammar follows the Solidity
-- documentation for Yul: https://docs.soliditylang.org/en/latest/yul.html
module SolidVM.Solidity.Parse.Yul
  ( inlineAssemblyBlock,
    yulStatement,
    yulExpression,
    yulLiteral,
  )
where

import Control.Monad (when)
import Data.Source.Annotation (SourceAnnotation, withPosition)
import qualified SolidVM.Model.CodeCollection.Yul as Y
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec hiding (State)

-- | Keywords that cannot be identifiers inside a Yul block.
-- These do NOT get added to the outer Solidity lexer's reserved list so
-- ordinary Solidity code may continue to use names like @let@ or
-- @switch@ as identifiers.
yulKeywords :: [String]
yulKeywords =
  [ "let",
    "if",
    "for",
    "switch",
    "case",
    "default",
    "leave",
    "break",
    "continue",
    "function",
    "true",
    "false",
    "hex"
  ]

yulReserved :: String -> SolidityParser ()
yulReserved s = try . lexeme $ do
  _ <- string s
  notFollowedBy (alphaNum <|> oneOf "_$") <?> ("end of keyword " ++ show s)

-- | Yul identifier: same character class as Solidity identifiers, but
-- Yul keywords are rejected and @.@ is permitted after the first char
-- to support names like @verbatim_1i_1o@ style builtins.
yulIdent :: SolidityParser String
yulIdent = try . lexeme $ do
  c <- letter <|> oneOf "_$"
  cs <- many (alphaNum <|> oneOf "_$.")
  let name = c : cs
  when (name `elem` yulKeywords) $
    unexpected ("Yul reserved word " ++ show name)
  return name

-- | Top-level entrypoint: parse the body of an @assembly { ... }@ block
-- (including optional @"dialect"@ and flag list).
inlineAssemblyBlock :: SolidityParser (Y.InlineAssemblyF (SourceAnnotation ()))
inlineAssemblyBlock = do
  _ <- optionMaybe (try stringLiteral)
  _ <- optionMaybe (try (parens (commaSep stringLiteral)))
  body <- braces (many yulStatement)
  return $ Y.InlineAssembly body

-- ---------------------------------------------------------------------------
-- Statements

yulStatement :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulStatement =
  yulBlockStmt
    <|> (yulReserved "let" *> yulLet)
    <|> (yulReserved "if" *> yulIf)
    <|> (yulReserved "for" *> yulFor)
    <|> (yulReserved "switch" *> yulSwitch)
    <|> (yulReserved "break" *> (Y.YulBreak . fst <$> withPosition (return ())))
    <|> (yulReserved "continue" *> (Y.YulContinue . fst <$> withPosition (return ())))
    <|> (yulReserved "leave" *> (Y.YulLeave . fst <$> withPosition (return ())))
    <|> (yulReserved "function" *> yulFunctionDef)
    <|> try yulAssign
    <|> yulExpressionStatement

yulBlockStmt :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulBlockStmt = do
  ~(a, body) <- withPosition (braces (many yulStatement))
  return $ Y.YulBlock a body

yulBlockBody :: SolidityParser [Y.YulStatementF (SourceAnnotation ())]
yulBlockBody = braces (many yulStatement)

yulLet :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulLet = do
  ~(a, (names, rhs)) <- withPosition $ do
    ns <- commaSep1 yulTypedName
    mExpr <- optionMaybe (try (yulOp ":=") *> yulExpression)
    return (ns, mExpr)
  return $ Y.YulLet a names rhs

yulAssign :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulAssign = do
  ~(a, (names, rhs)) <- withPosition $ do
    ns <- commaSep1 yulIdent
    _ <- yulOp ":="
    e <- yulExpression
    return (ns, e)
  return $ Y.YulAssign a names rhs

yulIf :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulIf = do
  ~(a, (cond, body)) <- withPosition $ do
    c <- yulExpression
    b <- yulBlockBody
    return (c, b)
  return $ Y.YulIfStmt a cond body

yulFor :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulFor = do
  ~(a, (iBlock, cond, postBlock, body)) <- withPosition $ do
    i <- yulBlockBody
    c <- yulExpression
    p <- yulBlockBody
    b <- yulBlockBody
    return (i, c, p, b)
  return $ Y.YulFor a iBlock cond postBlock body

yulSwitch :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulSwitch = do
  ~(a, (expr, cases, mDefault)) <- withPosition $ do
    e <- yulExpression
    cs <- many $ do
      yulReserved "case"
      lit <- yulLiteral
      body <- yulBlockBody
      return (lit, body)
    md <- optionMaybe (yulReserved "default" *> yulBlockBody)
    when (null cs && md == Nothing) $
      fail "switch statement must have at least one case or a default clause"
    return (e, cs, md)
  return $ Y.YulSwitch a expr cases mDefault

yulFunctionDef :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulFunctionDef = do
  ~(a, (name, params, rets, body)) <- withPosition $ do
    n <- yulIdent
    ps <- parens (commaSep yulTypedName)
    rs <- option [] (try (yulOp "->") *> commaSep1 yulTypedName)
    b <- yulBlockBody
    return (n, ps, rs, b)
  return $ Y.YulFunctionDef a name params rets body

yulExpressionStatement :: SolidityParser (Y.YulStatementF (SourceAnnotation ()))
yulExpressionStatement = do
  ~(a, e) <- withPosition yulExpression
  return $ Y.YulExpressionStatement a e

-- ---------------------------------------------------------------------------
-- Expressions

yulExpression :: SolidityParser (Y.YulExpressionF (SourceAnnotation ()))
yulExpression =
  (do ~(a, lit) <- withPosition yulLiteral; return $ Y.YulLit a lit)
    <|> yulIdentOrCall

-- An identifier optionally followed by an argument list. If the argument
-- list is absent the name refers to a Yul variable; otherwise it's a
-- function call (builtin or user-defined).
yulIdentOrCall :: SolidityParser (Y.YulExpressionF (SourceAnnotation ()))
yulIdentOrCall = do
  ~(a, (name, mArgs)) <- withPosition $ do
    n <- yulIdent
    ma <- optionMaybe (parens (commaSep yulExpression))
    return (n, ma)
  return $ case mArgs of
    Nothing -> Y.YulIdentifier a name
    Just args -> Y.YulFunctionCall a name args

-- ---------------------------------------------------------------------------
-- Literals and helpers

yulLiteral :: SolidityParser Y.YulLiteral
yulLiteral =
  (Y.YulBool True <$ yulReserved "true")
    <|> (Y.YulBool False <$ yulReserved "false")
    <|> yulHexStringLit
    <|> (Y.YulNumber <$> natural)
    <|> (Y.YulString <$> stringLiteral)

-- Parse a @hex"..."@ literal. The @hex@ prefix must not be followed by
-- an identifier character and is directly adjacent to the string quote
-- (no intervening whitespace is allowed per the Yul grammar).
yulHexStringLit :: SolidityParser Y.YulLiteral
yulHexStringLit = try . lexeme $ do
  _ <- string "hex"
  notFollowedBy (alphaNum <|> oneOf "_$")
  content <-
    between (char '"') (char '"' <?> "closing quote") (many hexDigit)
      <|> between (char '\'') (char '\'' <?> "closing quote") (many hexDigit)
  return $ Y.YulHexString content

yulTypedName :: SolidityParser (Y.YulTypedNameF (SourceAnnotation ()))
yulTypedName = do
  ~(a, (name, mType)) <- withPosition $ do
    n <- yulIdent
    -- The whole ':' Ident must backtrack as a unit so a bare ':='
    -- can still be parsed as assignment instead of being mistaken
    -- for a type annotation.
    mt <- optionMaybe (try (colon *> yulIdent))
    return (n, mt)
  return $ Y.YulTypedName name mType a

-- | Parse a symbolic Yul operator literally. Unlike 'reservedOp' this
-- does not consult the Solidity operator table, so @:=@ and @->@ are
-- handled unambiguously inside assembly blocks.
yulOp :: String -> SolidityParser ()
yulOp s = try . lexeme $ do
  _ <- string s
  return ()
