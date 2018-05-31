-- |
-- Module: Declarations
-- Description: Parsers for top-level Solidity declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net
-- Maintainer: Charles Crain <charles@blockapps.net>
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Declarations where

--import Data.Either
import           Data.List
import qualified Data.Map as Map
--import Data.Map (Map)
import           Data.Maybe
import           Data.Text                            (Text)
import qualified Data.Text                            as Text
--import           Data.Char

import           Text.Parsec
import           Text.Parsec.Token                    (GenLanguageDef(..))
-- import           Text.Parsec.Perm
--import           Text.Parsec.Number

import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes
import           BlockApps.Solidity.Parse.Types

import           BlockApps.Solidity.Xabi              (Xabi (..))
import qualified BlockApps.Solidity.Xabi              as Xabi
import qualified BlockApps.Solidity.Xabi.Def          as Xabi
import qualified BlockApps.Solidity.Xabi.Type         as Xabitype




-- | Parses an entire Solidity contract
solidityContract :: SolidityParser (Text, (Xabi, [Text]))
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
  declarations <-
    braces (many solidityDeclaration)

  let allFunctions = Map.fromList
                     [ (Text.pack n, f) | (n, FuncDeclaration f) <- declarations]

  return
    (
      Text.pack contractName',
      (
        Xabi { xabiFuncs = Map.delete (Text.pack contractName') allFunctions
             , xabiConstr = if Map.member (Text.pack contractName') allFunctions
                            then Map.singleton
                                 (Text.pack contractName')
                                 (allFunctions Map.! (Text.pack contractName'))
                            else Map.empty
               -- maybe Map.empty Xabi.funcArgs (Map.lookup (Text.pack contractName') allFunctions)
           , xabiVars = (constants declarations) `Map.union`(variables declarations)
           , xabiTypes =
             Map.fromList $
             [ (Text.pack name, enum) | (name, EnumDeclaration enum) <- declarations]
             ++ [ (Text.pack name, struct) | (name, StructDeclaration struct) <- declarations]
           , xabiModifiers = Map.fromList [(Text.pack name, modifier) | (name, ModifierDeclaration modifier) <- declarations]

--    contractName = contractName',
--    contractObjs = filter (tupleHasValue . objValueType) contractObjs',
--    contractTypes = contractTypes',
--    contractBaseNames = baseConstrs
           },
        map (Text.pack . fst) baseConstrs
      )
    )
  where constants = byMutability True (repeat 0)

        variables = byMutability False [0,32..]

        byMutability isConst ns = Map.fromList . flip (zipWith mapVarTypes) ns . varTypesOf isConst

        mapVarTypes (v, isPub, isConst, val) i =
          fmap (Xabitype.VarType i (visibility isPub) (Just isConst) val) v

        varTypesOf isConstant = map (\(n, VariableDeclaration v isPub isConst val) ->
                                   ((Text.pack n, v), isPub, isConst, val))
                           . filter (\(_, decl) -> case decl of
                                        (VariableDeclaration _ _ c _) -> isConstant == c
                                        _ -> False)

        visibility isPub = if isPub then Just True else Nothing



data Declaration =
  FuncDeclaration Xabi.Func
  | ModifierDeclaration Xabi.Modifier
  | StructDeclaration Xabi.Def
  | EnumDeclaration Xabi.Def
  | UsingDeclaration Xabi.Using
  | EventDeclaration Xabi.Event
  | VariableDeclaration Xabitype.Type Bool Bool (Maybe String)
  deriving Show

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
    (fieldName, VariableDeclaration decl _ _ _) <- simpleVariableDeclaration
    return (fieldName, decl)
  return
    (
      structName,
      StructDeclaration Xabi.Struct{
        Xabi.fields =
           zipWith (\(n, v) i -> (Text.pack n, Xabitype.FieldType i v)) structFields [0..],
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
  (_, variableIsPublic, variableIsConstant) <- option (True, False, False) $
                     (reserved "constant" >> return (False, False, True)) <|>
                     (reserved "storage" >> return (True, False, False)) <|>
                     (reserved "memory" >> return (False, False, False)) <|>
                     (reserved "public" >> return (True, True, False)) <|>
                     (reserved "private" >> return (False, False, False)) <|>
                     (reserved "internal" >> return (False, False, False))
  variableName <- identifier
  value <- optionMaybe $ do
    reservedOp "="
    many $ noneOf ";"
  semi
--  let objValueType' =
--        if variableVisible
--        then SingleValue variableType
--        else NoValue

  return (variableName, VariableDeclaration variableType variableIsPublic variableIsConstant value)

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
  (functionRet, visibility, mutable, payable, modifiers) <- functionModifiers
--  functionBody <- bracedCode <|> (semi >> return "")
  contents <- bracedCode <|> (semi >> return "")
  --TODO - deal with contractName
--  contractName' <- getContractName
  _ <- getContractName
--  let objValueType' = case () of
--  let _ = case () of
--        _ | null functionName || not functionVisible -> NoValue
--        _ | functionName == contractName' -> SingleValue $ Typedef contractName'
--        _ -> functionRet
  let nameUnnamed (name,ty) i = if Text.null name then (Text.pack ('#' : show i),ty) else (name,ty)

  return
    (
      functionName,
      FuncDeclaration Xabi.Func{
        Xabi.funcArgs =
           Map.fromList $
           zipWith (\x i -> fmap (Xabitype.IndexedType i) (nameUnnamed x i)) functionArgs [0..]
      , Xabi.funcVals =
           Map.fromList $
           zipWith (\v i -> fmap (Xabitype.IndexedType i) (nameUnnamed v i)) functionRet [0..]
      , Xabi.funcContents = Just $ Text.pack contents

      -- TODO: Get these values from parser
      , Xabi.funcMutable  = Just mutable
      , Xabi.funcPayable  = Just payable
      , Xabi.funcVisibility = Just visibility
      , Xabi.funcModifiers = Just modifiers


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
  contents <- bracedCode
  let nameUnnamed (_name,ty) i = if Text.null _name then (Text.pack ('#' : show i),ty) else (_name,ty)
  return
    (
      name,
      ModifierDeclaration Xabi.Modifier{
        Xabi.modifierArgs = -- undefined args -- :: Map Text Xabi.IndexedType
           Map.fromList $
             zipWith (\x i -> fmap (Xabitype.IndexedType i) (nameUnnamed x i)) args [0..]
      , Xabi.modifierSelector = Text.pack name -- ? -- undefined -- :: Text
      , Xabi.modifierVals = Map.fromList [] -- undefined -- :: Map Text Xabi.IndexedType
      , Xabi.modifierContents = if null contents then Nothing else Just $ Text.pack contents
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
-- of a constructor.

data FuncModifiers = ReturnsMod [(Text, Xabitype.Type)]
                   | VisibilityMod Xabi.Visibility
                   | MutableMod Bool
                   | PayableMod Bool
                   | OtherMod String

functionModifiers :: SolidityParser ([(Text, Xabitype.Type)], Xabi.Visibility, Bool, Bool, [String])
functionModifiers = do
  vals <- many $ (ReturnsMod <$> returnModifier)
             <|>  (VisibilityMod <$> visibilityModifier)
             <|>  (MutableMod <$> mutabilityModifier)
             <|>  (PayableMod <$> payableModifier)
             <|>  (OtherMod <$> otherModifiers)
  return $ formatVals vals
  where
    formatVals vals =
      let returns = concat [v | ReturnsMod v <- vals]
          visibility = fromMaybe Xabi.Public $ listToMaybe [v | VisibilityMod v <- vals]
          mutable = fromMaybe True $ listToMaybe [v | MutableMod v <- vals]
          payable = fromMaybe False $ listToMaybe [v | PayableMod v <- vals]
          otherMods = [v | OtherMod v <- vals]
      in (returns, visibility, mutable, payable, otherMods)
    returnModifier =
      reserved "returns" >> tupleDeclaration
    visibilityModifier =
      (   (reserved "public"   >> return Xabi.Public)
      <|> (reserved "private"  >> return Xabi.Private)
      <|> (reserved "external" >> return Xabi.External)
      <|> (reserved "internal" >> return Xabi.Internal)
      )
    mutabilityModifier =
      reserved "constant" >> return False
    payableModifier =
      reserved "payable" >> return True
    otherModifiers = do
      name <- identifier
      args <- optionMaybe parensCode
      return $ name ++ maybe "" (\s -> "(" ++ s ++ ")") args

-- | A common pattern: code enclosed in braces, allowing nested braces.
bracedCode :: SolidityParser String
bracedCode = braces . fmap concat . many $
        (show <$> try stringLiteral)
    <|> (comment >> return "")
    <|> ((:[]) <$> noneOf "{}\"/")
    <|> do
        innerBraces <- bracedCode
        return $ "{" ++ innerBraces ++ "}"

-- | Parses arguments and their types in parentheses.
parensCode :: SolidityParser String
parensCode = parens . fmap concat . many $
        (comment >> return "")
    <|> ((:[]) <$> noneOf "()/")

comment :: SolidityParser ()
comment = oneLineComment <|> multiLineComment

-- Stolen directly from Text.Parsec.Token because those jerks couldn't be
-- bothered to export them.
-- License pertains solely to code beneath this line.
-- Copyright 1999-2000, Daan Leijen; 2007, Paolo Martini. All rights reserved.

-- Redistribution and use in source and binary forms, with or without
-- modification, are permitted provided that the following conditions are met:

-- * Redistributions of source code must retain the above copyright notice,
--   this list of conditions and the following disclaimer.
-- * Redistributions in binary form must reproduce the above copyright
--   notice, this list of conditions and the following disclaimer in the
--   documentation and/or other materials provided with the distribution.

-- This software is provided by the copyright holders "as is" and any express or
-- implied warranties, including, but not limited to, the implied warranties of
-- merchantability and fitness for a particular purpose are disclaimed. In no
-- event shall the copyright holders be liable for any direct, indirect,
-- incidental, special, exemplary, or consequential damages (including, but not
-- limited to, procurement of substitute goods or services; loss of use, data,
-- or profits; or business interruption) however caused and on any theory of
-- liability, whether in contract, strict liability, or tort (including
-- negligence or otherwise) arising in any way out of the use of this software,
-- even if advised of the possibility of such damage.
oneLineComment :: SolidityParser ()
oneLineComment =
        do{ try (string (commentLine solidityLanguage))
          ; skipMany (satisfy (/= '\n'))
          ; return ()
          }

multiLineComment :: SolidityParser ()
multiLineComment =
  do { try (string (commentStart solidityLanguage))
     ; inComment
     }

inComment :: SolidityParser ()
inComment
  | nestedComments solidityLanguage  = inCommentMulti
  | otherwise                = inCommentSingle

inCommentMulti :: SolidityParser ()
inCommentMulti
  =   do{ try (string (commentEnd solidityLanguage)) ; return () }
  <|> do{ multiLineComment                     ; inCommentMulti }
  <|> do{ skipMany1 (noneOf startEnd)          ; inCommentMulti }
  <|> do{ oneOf startEnd                       ; inCommentMulti }
  <?> "end of comment"
  where
    startEnd   = nub (commentEnd solidityLanguage ++ commentStart solidityLanguage)

inCommentSingle :: SolidityParser ()
inCommentSingle
  =   do{ try (string (commentEnd solidityLanguage)); return () }
  <|> do{ skipMany1 (noneOf startEnd)         ; inCommentSingle }
  <|> do{ oneOf startEnd                      ; inCommentSingle }
  <?> "end of comment"
  where
    startEnd   = nub (commentEnd solidityLanguage ++ commentStart solidityLanguage)
