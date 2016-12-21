-- |
-- Module: Declarations
-- Description: Parsers for top-level Solidity declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module Declarations (solidityContract) where

import Data.Either
import Data.List
import Data.Maybe

import Text.Parsec
import Text.Parsec.Perm

import Lexer
import ParserTypes
import Types

-- | Parses an entire Solidity contract
solidityContract :: SolidityParser SolidityContract
solidityContract = do
  reserved "contract" <|> reserved "library"
  contractName' <- identifier
  setContractName contractName'
  baseConstrs <- option [] $ do
    reserved "is"
    commaSep1 $ do
      name <- intercalate "." <$> sepBy1 identifier dot
      consArgs <- option "" parensCode
      return (name, consArgs)
  (contractTypes', contractObjs') <-
    partitionEithers <$> braces (many solidityDeclaration)
  return Contract{
    contractName = contractName',
    contractObjs = filter (tupleHasValue . objValueType) contractObjs',
    contractTypes = contractTypes',
    contractBaseNames = baseConstrs
    }

-- | Parses anything that a contract can declare at the top level: new types,
-- variables, functions primarily, also events and function modifiers.
solidityDeclaration :: SolidityParser (Either SolidityTypeDef SolidityObjDef)
solidityDeclaration =
  fmap Left structDeclaration <|>
  fmap Left enumDeclaration <|>
  fmap Left usingDeclaration <|>
  fmap Right functionDeclaration <|>
  fmap Right modifierDeclaration <|>
  fmap Right eventDeclaration <|>
  fmap Right variableDeclaration

{- New types -}

-- | Parses a struct definition
structDeclaration :: SolidityParser SolidityTypeDef
structDeclaration = do
  reserved "struct"
  structName <- identifier
  structFields <- braces $ many1 $ do
    decl <- simpleVariableDeclaration
    semi
    return decl
  return TypeDef{
    typeName = structName,
    typeDecl = Struct { fields = structFields }
    }

-- | Parses an enum definition
enumDeclaration :: SolidityParser SolidityTypeDef
enumDeclaration = do
  reserved "enum"
  enumName <- identifier
  enumFields <- braces $ commaSep1 identifier
  return TypeDef {
    typeName = enumName,
    typeDecl = Enum { names = enumFields}
    }

-- | Erroneous; will be removed
usingDeclaration :: SolidityParser SolidityTypeDef
usingDeclaration = do
  reserved "using"
  usingContract' <- identifier
  reserved "for"
  string usingContract'
  dot
  usingName <- identifier
  semi
  return TypeDef{
    typeName = usingContract' ++ "." ++ usingName,
    typeDecl = Using { usingContract = usingContract', usingType = usingName }
    }

{- Variables -}

-- | Parses a variable definition
variableDeclaration :: SolidityParser SolidityObjDef
variableDeclaration = do
  vDecl <- simpleVariableDeclaration
  vDefn <- optionMaybe $ do
    reservedOp "="
    many $ noneOf ";"
  semi
  return $ maybe vDecl (\vD -> vDecl{objDefn = vD}) vDefn

-- | Parses the declaration part of a variable definition, which is
-- everything except possibly the initializer and semicolon.  Necessary
-- because these kinds of expressions also appear in struct definitions and
-- function arguments.
simpleVariableDeclaration :: SolidityParser SolidityObjDef
simpleVariableDeclaration = do
  variableType <- simpleTypeExpression
  -- We have to remember which variables are "public", because they
  -- generate accessor functions
  (variableVisible, variableIsPublic) <- option (True, False) $
                     (reserved "constant" >> return (False, False)) <|>
                     (reserved "storage" >> return (True, False)) <|>
                     (reserved "memory" >> return (False, False)) <|>
                     (reserved "public" >> return (True, True)) <|>
                     (reserved "private" >> return (False, False)) <|>
                     (reserved "internal" >> return (False, False))
  variableName <- identifier
  let objValueType' =
        if variableVisible
        then SingleValue variableType
        else NoValue
  return ObjDef{
    objName = variableName,
    objValueType = objValueType',
    objArgType = NoValue,
    objDefn = "",
    objIsPublic = variableIsPublic
    }

{- Functions and function-like -}

-- | Parses a function definition.
functionDeclaration :: SolidityParser SolidityObjDef
functionDeclaration = do
  reserved "function"
  functionName <- fromMaybe "" <$> optionMaybe identifier
  functionArgs <- tupleDeclaration
  (functionRet, functionVisible, _, _) <- functionModifiers
  functionBody <- bracedCode <|> (semi >> return "")
  contractName' <- getContractName
  let objValueType' = case () of
        _ | null functionName || not functionVisible -> NoValue
        _ | functionName == contractName' -> SingleValue $ Typedef contractName'
        _ -> functionRet
  return ObjDef{
    objName = functionName,
    objValueType = objValueType',
    objArgType = functionArgs,
    objDefn = functionBody,
    objIsPublic = False -- We only care about public variables
    }

-- | Parses an event definition.  At the moment we don't do anything with
-- it, but this prevents the parser from rejecting contracts that use
-- events.
eventDeclaration :: SolidityParser SolidityObjDef
eventDeclaration = do
  reserved "event"
  name <- identifier
  logs <- tupleDeclaration
  optional $ reserved "anonymous"
  semi
  return ObjDef{
    objName = name,
    objValueType = NoValue,
    objArgType = logs,
    objDefn = "",
    objIsPublic = False -- We only care about public variables
    }

-- | Parses a function modifier definition.  At the moment we don't do
-- anything with it, but this prevents the parser from rejecting contracts
-- that use modifiers.
modifierDeclaration :: SolidityParser SolidityObjDef
modifierDeclaration = do
  reserved "modifier"
  name <- identifier
  args <- option NoValue tupleDeclaration
  defn <- bracedCode
  return ObjDef{
    objName = name,
    objValueType = NoValue,
    objArgType = args,
    objDefn = defn,
    objIsPublic = False -- We only care about public variables
    }

{- Not really declarations -}

-- | Parses a '(x, y, z)'-style tuple, such as appears in function
-- arguments and return values.
tupleDeclaration :: SolidityParser SolidityTuple
tupleDeclaration = fmap TupleValue $ parens $ commaSep $ do
  partType <- simpleTypeExpression
  optional $ reserved "indexed" <|>
             reserved "storage" <|>
             reserved "memory"
  partName <- option "" identifier
  return ObjDef{
    objName = partName,
    objValueType = SingleValue partType,
    objArgType = NoValue,
    objDefn = "",
    objIsPublic = False -- We only care about public variables
    }

-- | Parses all the things that can modify a function declaration,
-- including return value, explicit function modifiers, visibility and
-- constant specifiers, and possibly base construtor arguments, in the case
-- of a constructor.  These can appear in any order, so we have to use
-- a special permutation parser for this.
functionModifiers :: SolidityParser (SolidityTuple, Bool, Bool, String)
functionModifiers =
  permute $
  (\a b c d1 d2 d3 d4 -> (a, b, c, unwords [d1, d2, d3, d4])) <$?>
  (TupleValue [], returnModifier) <|?>
  (True, visibilityModifier) <|?>
  (True, mutabilityModifier) <|?>
  ("", otherModifiers) <|?>
  ("", otherModifiers) <|?>
  ("", otherModifiers) <|?>
  ("", otherModifiers) -- Fenceposts for the explicit modifiers
  where
    returnModifier =
      reserved "returns" >> tupleDeclaration
    visibilityModifier =
      ((reserved "public" <|> reserved "external") >> return True) <|>
      ((reserved "internal" <|> reserved "private") >> return False)
    mutabilityModifier =
      reserved "constant" >> return False
    otherModifiers = fmap unwords $ many $ do
      name <- identifier
      args <- optionMaybe parensCode
      return $ name ++ maybe "" (\s -> "(" ++ s ++ ")") args
