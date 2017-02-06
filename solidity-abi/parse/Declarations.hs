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

solidityContract :: SolidityParser SolidityContract
solidityContract = do
  reserved "contract" <|> reserved "library"
  contractName' <- identifier
  setContractName contractName'
  baseConstrs <- option [] $ do
    reserved "is"
    commaSep1 $ do
      name <- identifier
      consArgs <- option "" parensCode
      return (name, consArgs)
  (contractTypes', contractObjs') <-
    partitionEithers <$> (braces $ many solidityDeclaration)
  return $ Contract {
    contractName = contractName',
    contractObjs = filter (tupleHasValue . objValueType) contractObjs',
    contractTypes = contractTypes',
    contractBaseNames = baseConstrs
    }

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

structDeclaration :: SolidityParser SolidityTypeDef
structDeclaration = do
  reserved "struct"
  structName <- identifier
  structFields <- braces $ many1 $ do
    decl <- simpleVariableDeclaration
    semi
    return decl
  return $ TypeDef {
    typeName = structName,
    typeDecl = Struct { fields = structFields }
    }

enumDeclaration :: SolidityParser SolidityTypeDef
enumDeclaration = do
  reserved "enum"
  enumName <- identifier
  enumFields <- braces $ commaSep1 identifier
  return $ TypeDef {
    typeName = enumName,
    typeDecl = Enum { names = enumFields}
    }

usingDeclaration :: SolidityParser SolidityTypeDef
usingDeclaration = do
  reserved "using"
  usingContract' <- identifier
  reserved "for"
  string usingContract'
  dot
  usingName <- identifier
  semi
  return $ TypeDef {
    typeName = usingContract' ++ "." ++ usingName,
    typeDecl = Using { usingContract = usingContract', usingType = usingName }
    }

{- Variables -}

variableDeclaration :: SolidityParser SolidityObjDef
variableDeclaration = do
  vDecl <- simpleVariableDeclaration
  vDefn <- optionMaybe $ do
    reservedOp "="
    many $ noneOf ";"
  semi
  return $ maybe vDecl (\vD -> vDecl{objDefn = vD}) vDefn

simpleVariableDeclaration :: SolidityParser SolidityObjDef
simpleVariableDeclaration = do
  variableType <- simpleTypeExpression
  variableVisible <- option True $
                     (reserved "constant" >> return False) <|>
                     (reserved "storage" >> return True) <|>
                     (reserved "memory" >> return False) <|>
                     (reserved "public" >> return True) <|>
                     (reserved "private" >> return False) <|>
                     (reserved "internal" >> return False)
  variableName <- identifier
  let objValueType' =
        if variableVisible
        then SingleValue variableType
        else NoValue
  return $ ObjDef {
    objName = variableName,
    objValueType = objValueType',
    objArgType = NoValue,
    objDefn = ""
    }

{- Functions and function-like -}

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
        _ | otherwise -> functionRet
  return $ ObjDef {
    objName = functionName,
    objValueType = objValueType',
    objArgType = functionArgs,
    objDefn = functionBody
    }

eventDeclaration :: SolidityParser SolidityObjDef
eventDeclaration = do
  reserved "event"
  name <- identifier
  logs <- tupleDeclaration
  optional $ reserved "anonymous"
  semi
  return $ ObjDef {
    objName = name,
    objValueType = NoValue,
    objArgType = logs,
    objDefn = ""
    }

modifierDeclaration :: SolidityParser SolidityObjDef
modifierDeclaration = do
  reserved "modifier"
  name <- identifier
  args <- option NoValue tupleDeclaration
  defn <- bracedCode
  return $ ObjDef {
    objName = name,
    objValueType = NoValue,
    objArgType = args,
    objDefn = defn
    }

{- Not really declarations -}

tupleDeclaration :: SolidityParser SolidityTuple
tupleDeclaration = fmap TupleValue $ parens $ commaSep $ do
  partType <- simpleTypeExpression
  optional $ reserved "indexed"
  partName <- option "" identifier
  return $ ObjDef {
    objName = partName,
    objValueType = SingleValue partType,
    objArgType = NoValue,
    objDefn = ""
    }

functionModifiers :: SolidityParser (SolidityTuple, Bool, Bool, String)
functionModifiers =
  permute $
  (\a b c d1 d2 d3 d4 -> (a, b, c, intercalate " " [d1, d2, d3, d4])) <$?>
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
    otherModifiers = fmap (intercalate " ") $ many $ do
      name <- identifier
      args <- optionMaybe parensCode
      return $ name ++ maybe "" (\s -> "(" ++ s ++ ")") args
