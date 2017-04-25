-- |
-- Module: Declarations
-- Description: Parsers for top-level Solidity declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Declarations (solidityContract) where

--import Data.Either
import           Data.List
import qualified Data.Map                             as Map
--import Data.Map (Map)
import           Data.Maybe
import           Data.Text                            (Text)
import qualified Data.Text                            as Text

import           Text.Parsec
import           Text.Parsec.Perm

import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes
import           BlockApps.Solidity.Parse.Types

import           BlockApps.Solidity.Xabi              (Xabi (..))
import qualified BlockApps.Solidity.Xabi              as Xabi
import qualified BlockApps.Solidity.Xabi.Def          as Xabi
import qualified BlockApps.Solidity.Xabi.Type         as Xabitype


-- | Parses an entire Solidity contract
solidityContract :: SolidityParser (Text, Xabi)
solidityContract = do
  reserved "contract" <|> reserved "library"
  contractName' <- identifier
  setContractName contractName'
--  baseConstrs <- option [] $ do
  _ <- option [] $ do
    reserved "is"
    commaSep1 $ do
      name <- intercalate "." <$> sepBy1 identifier dot
      consArgs <- option "" parensCode
      return (name, consArgs)
  declarations <-
    braces (many solidityDeclaration)
  return
    (
      Text.pack contractName',
      Xabi{
        xabiFuncs =
           Map.fromList
           [ (Text.pack n, f) | (n, FuncDeclaration f) <- declarations]
      , xabiConstr = Map.fromList [] --undefined -- :: Map Text Xabi.IndexedType
      , xabiVars =
             Map.fromList $
             zipWith (\v i -> fmap (Xabitype.VarType i Nothing) v)
             [ (Text.pack n, v) | (n, VariableDeclaration v) <- declarations]
             [0..]
      , xabiTypes =
          Map.fromList $
          [ (Text.pack name, enum) | (name, EnumDeclaration enum) <- declarations]
          ++ [ (Text.pack name, struct) | (name, StructDeclaration struct) <- declarations]

--    contractName = contractName',
--    contractObjs = filter (tupleHasValue . objValueType) contractObjs',
--    contractTypes = contractTypes',
--    contractBaseNames = baseConstrs
      }
    )




data Declaration =
  FuncDeclaration Xabi.Func
  | ModifierDeclaration Xabi.Modifier
  | StructDeclaration Xabi.Def
  | EnumDeclaration Xabi.Def
  | UsingDeclaration Xabi.Using
  | EventDeclaration Xabi.Event
  | VariableDeclaration Xabitype.Type

-- | Parses anything that a contract can declare at the top level: new types,
-- variables, functions primarily, also events and function modifiers.
solidityDeclaration :: SolidityParser (String, Declaration)
solidityDeclaration =
  structDeclaration <|>
  enumDeclaration <|>
  usingDeclaration <|>
  functionDeclaration <|>
  modifierDeclaration <|>
  eventDeclaration <|>
  variableDeclaration

{- New types -}

-- | Parses a struct definition
structDeclaration :: SolidityParser (String, Declaration)
structDeclaration = do
  reserved "struct"
  structName <- identifier
  structFields <- braces $ many1 $ do
    (fieldName, VariableDeclaration decl) <- simpleVariableDeclaration
    semi
    return (fieldName, decl)
  return
    (
      structName,
      StructDeclaration Xabi.Struct{
        Xabi.fields =
           Map.fromList $ zipWith (\(n, v) i -> (Text.pack n, Xabitype.FieldType i v)) structFields [0..],
        Xabi.bytes = 0
        }
    )

-- | Parses an enum definition
enumDeclaration :: SolidityParser (String, Declaration)
enumDeclaration = do
  reserved "enum"
  enumName <- identifier
  enumFields <- braces $ commaSep1 identifier
  return
    (
      enumName,
      EnumDeclaration Xabi.Enum {
        Xabi.names = map Text.pack enumFields,
        Xabi.bytes = 0
        }
    )

-- | Erroneous; will be removed
usingDeclaration :: SolidityParser (String, Declaration)
usingDeclaration = do
  reserved "using"
  usingContract' <- identifier
  reserved "for"
  string usingContract'
  dot
--  usingName <- identifier
  _ <- identifier
  semi
  return
    (
      undefined,
      UsingDeclaration Xabi.Using{}

--      TypeDef{
--        typeName = usingContract' ++ "." ++ usingName,
--        typeDecl = Using { usingContract = usingContract', usingType = usingName }
--        }
    )

{- Variables -}

-- | Parses a variable definition
variableDeclaration :: SolidityParser (String, Declaration)
variableDeclaration = do
  vDecl <- simpleVariableDeclaration
  _ <- optionMaybe $ do
    reservedOp "="
    many $ noneOf ";"
  semi
  return vDecl

-- | Parses the declaration part of a variable definition, which is
-- everything except possibly the initializer and semicolon.  Necessary
-- because these kinds of expressions also appear in struct definitions and
-- function arguments.
simpleVariableDeclaration :: SolidityParser (String, Declaration)
simpleVariableDeclaration = do
  variableType <- simpleTypeExpression
  -- We have to remember which variables are "public", because they
  -- generate accessor functions
  --TODO - deal with the variableVisible flag
--  (variableVisible, variableIsPublic) <- option (True, False) $
  (_, _) <- option (True, False) $
                     (reserved "constant" >> return (False, False)) <|>
                     (reserved "storage" >> return (True, False)) <|>
                     (reserved "memory" >> return (False, False)) <|>
                     (reserved "public" >> return (True, True)) <|>
                     (reserved "private" >> return (False, False)) <|>
                     (reserved "internal" >> return (False, False))
  variableName <- identifier
--  let objValueType' =
--        if variableVisible
--        then SingleValue variableType
--        else NoValue

  return (variableName, VariableDeclaration variableType)

--  ObjDef{
--    objName = variableName,
--    objValueType = objValueType',
--    objArgType = NoValue,
--    objDefn = "",
--    objIsPublic = variableIsPublic
--    }

{- Functions and function-like -}

-- | Parses a function definition.
functionDeclaration :: SolidityParser (String, Declaration)
functionDeclaration = do
  reserved "function"
  functionName <- fromMaybe "" <$> optionMaybe identifier
  functionArgs <- tupleDeclaration
--  (functionRet, functionVisible, _, _) <- functionModifiers
  -- TODO - deal with funcitonVisible
  (functionRet, _, _, _) <- functionModifiers
--  functionBody <- bracedCode <|> (semi >> return "")
  _ <- bracedCode <|> (semi >> return "")
  --TODO - deal with contractName
--  contractName' <- getContractName
  _ <- getContractName
--  let objValueType' = case () of
--  let _ = case () of
--        _ | null functionName || not functionVisible -> NoValue
--        _ | functionName == contractName' -> SingleValue $ Typedef contractName'
--        _ -> functionRet

  return
    (
      functionName,
      FuncDeclaration Xabi.Func{
        Xabi.funcArgs =
           Map.fromList $
           zipWith (\x i -> fmap (Xabitype.IndexedType i) x) functionArgs [0..]
      , Xabi.funcVals =
           Map.fromList $
           zipWith (\v i -> fmap (Xabitype.IndexedType i) v) functionRet [0..]


--    objName = functionName,
--    objValueType = objValueType',
--    objArgType = functionArgs,
--    objDefn = functionBody,
--    objIsPublic = False -- We only care about public variables
      }
    )

-- | Parses an event definition.  At the moment we don't do anything with
-- it, but this prevents the parser from rejecting contracts that use
-- events.
eventDeclaration :: SolidityParser (String, Declaration)
eventDeclaration = do
  reserved "event"
  name <- identifier
  logs <- tupleDeclaration
  optional $ reserved "anonymous"
  semi
  return
    (
      name,
      EventDeclaration Xabi.Event{
        Xabi.eventLogs = undefined logs
--         objName = name,
--         objValueType = NoValue,
--         objArgType = logs,
--         objDefn = "",
--         objIsPublic = False -- We only care about public variables
         }
    )

-- | Parses a function modifier definition.  At the moment we don't do
-- anything with it, but this prevents the parser from rejecting contracts
-- that use modifiers.
modifierDeclaration :: SolidityParser (String, Declaration)
modifierDeclaration = do
  reserved "modifier"
  name <- identifier
  args <- option [] tupleDeclaration
--  defn <- bracedCode
  _ <- bracedCode
  return
    (
      name,
      ModifierDeclaration Xabi.Modifier{
        Xabi.modifierArgs = undefined args -- :: Map Text Xabi.IndexedType
      , Xabi.modifierSelector = undefined -- :: Text
      , Xabi.modifierVals = undefined -- :: Map Text Xabi.IndexedType
--        objName = name,
--        objValueType = NoValue,
--        objArgType = args,
--        objDefn = defn,
--        objIsPublic = False -- We only care about public variables
      }
    )

{- Not really declarations -}

-- | Parses a '(x, y, z)'-style tuple, such as appears in function
-- arguments and return values.
tupleDeclaration :: SolidityParser [(Text, Xabitype.Type)]
tupleDeclaration = parens $ commaSep $ do
  partType <- simpleTypeExpression
  optional $ reserved "indexed" <|>
             reserved "storage" <|>
             reserved "memory"
  partName <- option "" identifier
  return (Text.pack partName, partType)

--  ObjDef{
--    objName = partName,
--    objValueType = SingleValue partType,
--    objArgType = NoValue,
--    objDefn = "",
--    objIsPublic = False -- We only care about public variables
--    }


-- | Parses all the things that can modify a function declaration,
-- including return value, explicit function modifiers, visibility and
-- constant specifiers, and possibly base construtor arguments, in the case
-- of a constructor.  These can appear in any order, so we have to use
-- a special permutation parser for this.
functionModifiers :: SolidityParser ([(Text, Xabitype.Type)], Bool, Bool, String)
functionModifiers =
  permute $
  (\a b c d1 d2 d3 d4 -> (a, b, c, unwords [d1, d2, d3, d4])) <$?>
  ([], returnModifier) <|?>
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
