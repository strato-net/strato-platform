{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

-- |
-- Module: Declarations
-- Description: Parsers for top-level Solidity declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net
-- Maintainer: Charles Crain <charles@blockapps.net>
module BlockApps.Solidity.Parse.Declarations where

import BlockApps.Solidity.Parse.Lexer
import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Parse.Types
import BlockApps.Solidity.Xabi (Xabi (..))
import qualified BlockApps.Solidity.Xabi as Xabi
import qualified BlockApps.Solidity.Xabi.Def as Xabi
import qualified BlockApps.Solidity.Xabi.Type as Xabitype
import Data.Function (on)
import Data.List
import qualified Data.Map as Map
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as Text
import Text.Parsec
import Text.Parsec.Token (GenLanguageDef (..))
import Text.Printf (printf)

-- | Parses an entire Solidity contract
solidityContract :: SolidityParser SourceUnit
solidityContract = do
  kind <-
    (reserved "contract" >> return Xabi.ContractKind)
      <|> (reserved "interface" >> return Xabi.InterfaceKind)
      <|> (reserved "abstract" >> return Xabi.AbstractKind)
      <|> (reserved "library" >> return Xabi.LibraryKind)
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

  let allFunctions = Map.fromList [(Text.pack n, f) | (n, FuncDeclaration f) <- declarations]
  let ctorList = [(Text.pack n, c) | (n, ConstructorDeclaration c) <- declarations]
  let events = [(Text.pack n, e) | (n, EventDeclaration e) <- declarations]
  let using = [(Text.pack n, u) | (n, UsingDeclaration u) <- declarations]
  mCtor <-
    if length ctorList > 1
      then fail "multiple constructors defined"
      else return . fmap snd . listToMaybe $ ctorList

  return $
    NamedXabi
      (Text.pack contractName')
      ( Xabi
          { xabiFuncs = allFunctions,
            xabiConstr = mCtor,
            xabiVars = (constants declarations) `Map.union` (variables declarations),
            xabiTypes =
              Map.fromList $
                [(Text.pack name, enum) | (name, EnumDeclaration enum) <- declarations]
                  ++ [(Text.pack name, struct) | (name, StructDeclaration struct) <- declarations],
            xabiModifiers = Map.fromList [(Text.pack name, modifier) | (name, ModifierDeclaration modifier) <- declarations],
            xabiEvents = Map.fromList events,
            xabiKind = kind,
            xabiUsing = Map.fromList using
          },
        map (Text.pack . fst) baseConstrs
      )
  where
    constants = byMutability True (repeat 0)

    variables = byMutability False [0, 32 ..]

    byMutability isConst ns = Map.fromList . flip (zipWith mapVarTypes) ns . varTypesOf isConst

    mapVarTypes (v, isPub, isConst, val) i =
      fmap (Xabitype.VarType i (visibility isPub) (Just isConst) val) v

    varTypesOf isConstant =
      map
        ( \(n, decl) -> case decl of
            (VariableDeclaration v isPub isConst val) -> ((Text.pack n, v), isPub, isConst, val)
            _ -> error "varTypesOf: not a variable declaration Should've been filtered out"
        )
        . filter
          ( \(_, decl) -> case decl of
              (VariableDeclaration _ _ c _) -> isConstant == c
              _ -> False
          )

    visibility isPub = if isPub then Just True else Nothing

data Declaration
  = FuncDeclaration Xabi.Func
  | ConstructorDeclaration Xabi.Func
  | ModifierDeclaration Xabi.Modifier
  | StructDeclaration Xabi.Def
  | EnumDeclaration Xabi.Def
  | UsingDeclaration Xabi.Using
  | EventDeclaration Xabi.Event
  | VariableDeclaration Xabitype.Type Bool Bool (Maybe String)
  deriving (Eq, Show)

-- | Parses anything that a contract can declare at the top level: new types,
-- variables, functions primarily, also events and function modifiers.
solidityDeclaration :: SolidityParser (String, Declaration)
solidityDeclaration =
  structDeclaration
    <|> enumDeclaration
    <|> usingDeclaration
    <|> functionDeclaration
    <|> modifierDeclaration
    <|> eventDeclaration
    <|> variableDeclaration

{- New types -}

-- | Parses a struct definition
structDeclaration :: SolidityParser (String, Declaration)
structDeclaration = do
  reserved "struct"
  structName <- identifier
  structFields <- braces $
    many1 $ do
      (fieldName, VariableDeclaration decl _ _ _) <- simpleVariableDeclaration
      return (fieldName, decl)
  return
    ( structName,
      StructDeclaration
        Xabi.Struct
          { Xabi.fields =
              zipWith (\(n, v) i -> (Text.pack n, Xabitype.FieldType i v)) structFields [0 ..],
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
    ( enumName,
      EnumDeclaration
        Xabi.Enum
          { Xabi.names = map Text.pack enumFields,
            Xabi.bytes = 0
          }
    )

usingDeclaration :: SolidityParser (String, Declaration)
usingDeclaration = do
  reserved "using"
  usingContract' <- identifier
  rest <- many1 (noneOf ";")
  semi
  return
    ( usingContract',
      UsingDeclaration (Xabi.Using rest)
    )

{- Variables -}

-- | Parses a variable definition
variableDeclaration :: SolidityParser (String, Declaration)
variableDeclaration = simpleVariableDeclaration

data StateVariableKeyword = KConstant | KPublic | KPrivate | KInternal
  deriving (Eq, Show, Enum, Ord)

stateVariableKeyword :: SolidityParser StateVariableKeyword
stateVariableKeyword =
  (try (reserved "constant") >> return KConstant)
    <|> (try (reserved "public") >> return KPublic)
    <|> (try (reserved "private") >> return KPrivate)
    <|> (try (reserved "internal") >> return KInternal)

public :: [StateVariableKeyword] -> SolidityParser Bool
public keywords =
  let visibilities = nub . filter (/= KConstant) $ keywords
   in case visibilities of
        (v1 : v2 : _) -> fail $ printf "multiple visibilities declared: %s vs %s" (show v1) (show v2)
        [KPublic] -> return True
        _ -> return False

constant :: [StateVariableKeyword] -> Bool
constant = any (KConstant ==)

-- | Parses the declaration part of a variable definition, which is
-- everything except possibly the initializer and semicolon.  Necessary
-- because these kinds of expressions also appear in struct definitions and
-- function arguments.
simpleVariableDeclaration :: SolidityParser (String, Declaration)
simpleVariableDeclaration = do
  variableType <- simpleTypeExpression
  -- We have to remember which variables are "public", because they
  -- generate accessor functions
  keywords <- many stateVariableKeyword
  let isConstant = constant keywords
  isPublic <- public keywords
  variableName <- identifier
  value <- optionMaybe $ do
    reservedOp "="
    many $ noneOf ";"
  semi

  return (variableName, VariableDeclaration variableType isPublic isConstant value)

{- Functions and function-like -}

constructorName :: String
constructorName = "constructor"

-- | Parses a function definition.
functionDeclaration :: SolidityParser (String, Declaration)
functionDeclaration = do
  functionName <-
    (reserved "function" >> fromMaybe "" <$> optionMaybe identifier)
      <|>
      -- Starting with 0.4.22, constructor() <mods> { <body> } is
      -- the preferred syntax for defining a constructor
      (reserved constructorName >> return constructorName)
  cName <- getContractName
  xabi <- functionXabi
  let tipe =
        if ((||) `on` (== functionName)) cName constructorName
          then ConstructorDeclaration
          else FuncDeclaration
  return (functionName, tipe xabi)

functionXabi :: SolidityParser Xabi.Func
functionXabi = do
  functionArgs <- tupleDeclaration
  (functionRet, visibility, mutability, modifiers) <- functionModifiers
  contents <- bracedCode <|> (semi >> return "")
  let nameUnnamed (name, ty) i = if Text.null name then (Text.pack ('#' : show i), ty) else (name, ty)
  return
    Xabi.Func
      { Xabi.funcArgs =
          Map.fromList $
            zipWith (\x i -> fmap (Xabitype.IndexedType i) (nameUnnamed x i)) functionArgs [0 ..],
        Xabi.funcVals =
          Map.fromList $
            zipWith (\v i -> fmap (Xabitype.IndexedType i) (nameUnnamed v i)) functionRet [0 ..],
        Xabi.funcContents = Just $ Text.pack contents,
        Xabi.funcVisibility = Just visibility,
        Xabi.funcStateMutability = mutability,
        Xabi.funcModifiers = Just modifiers
      }

-- | Parses an event definition.  At the moment we don't do anything with
-- it, but this prevents the parser from rejecting contracts that use
-- events.
eventDeclaration :: SolidityParser (String, Declaration)
eventDeclaration = do
  reserved "event"
  name <- identifier
  logs <- tupleDeclaration
  anon <- option False (reserved "anonymous" >> return True)
  semi
  return
    ( name,
      EventDeclaration
        Xabi.Event
          { Xabi.eventAnonymous = anon,
            Xabi.eventLogs = zipWith (\i -> fmap (Xabitype.IndexedType i)) [0 ..] logs
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
  let nameUnnamed (_name, ty) i = if Text.null _name then (Text.pack ('#' : show i), ty) else (_name, ty)
  return
    ( name,
      ModifierDeclaration
        Xabi.Modifier
          { Xabi.modifierArgs -- undefined args -- :: Map Text Xabi.IndexedType
            =
              Map.fromList $
                zipWith (\x i -> fmap (Xabitype.IndexedType i) (nameUnnamed x i)) args [0 ..],
            Xabi.modifierSelector = Text.pack name, -- ? -- undefined -- :: Text
            Xabi.modifierVals = Map.fromList [], -- undefined -- :: Map Text Xabi.IndexedType
            Xabi.modifierContents = if null contents then Nothing else Just $ Text.pack contents
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
tupleDeclaration = parens $
  commaSep $ do
    partType <- simpleTypeExpression
    optional $
      reserved "indexed"
        <|> reserved "storage"
        <|> reserved "memory"
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
data FuncModifiers
  = ReturnsMod [(Text, Xabitype.Type)]
  | VisibilityMod Xabi.Visibility
  | MutabilityMod Xabi.StateMutability
  | OtherMod String

functionModifiers :: SolidityParser ([(Text, Xabitype.Type)], Xabi.Visibility, Maybe Xabi.StateMutability, [String])
functionModifiers = do
  vals <-
    many $
      (ReturnsMod <$> returnModifier)
        <|> (VisibilityMod <$> visibilityModifier)
        <|> (MutabilityMod <$> mutabilityModifier)
        <|> (OtherMod <$> otherModifiers)
  return $ formatVals vals
  where
    formatVals vals =
      let returns = concat [v | ReturnsMod v <- vals]
          visibility = fromMaybe Xabi.Public $ listToMaybe [v | VisibilityMod v <- vals]
          mutability = listToMaybe [v | MutabilityMod v <- vals]
          otherMods = [v | OtherMod v <- vals]
       in (returns, visibility, mutability, otherMods)
    returnModifier =
      reserved "returns" >> tupleDeclaration
    visibilityModifier =
      ( (reserved "public" >> return Xabi.Public)
          <|> (reserved "private" >> return Xabi.Private)
          <|> (reserved "external" >> return Xabi.External)
          <|> (reserved "internal" >> return Xabi.Internal)
      )
    mutabilityModifier =
      ( (reserved "constant" >> return Xabi.Constant)
          <|> (reserved "pure" >> return Xabi.Pure)
          <|> (reserved "view" >> return Xabi.View)
          <|> (reserved "payable" >> return Xabi.Payable)
      )
    otherModifiers = do
      name <- identifier
      args <- optionMaybe parensCode
      return $ name ++ maybe "" (\s -> "(" ++ s ++ ")") args

-- | A common pattern: code enclosed in braces, allowing nested braces.
bracedCode :: SolidityParser String
bracedCode =
  braces . fmap concat . many $
    (show <$> try stringLiteral)
      <|> (comment >> return "")
      <|> ((: []) <$> noneOf "{}\"")
      <|> do
        innerBraces <- bracedCode
        return $ "{" ++ innerBraces ++ "}"

-- | Parses arguments and their types in parentheses.
parensCode :: SolidityParser String
parensCode =
  parens . fmap concat . many $
    (comment >> return "")
      <|> ((: []) <$> noneOf "()/")

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
  do
    try (string (commentLine solidityLanguage))
    skipMany (satisfy (/= '\n'))
    return ()

multiLineComment :: SolidityParser ()
multiLineComment =
  do
    try (string (commentStart solidityLanguage))
    inComment

inComment :: SolidityParser ()
inComment
  | nestedComments solidityLanguage = inCommentMulti
  | otherwise = inCommentSingle

inCommentMulti :: SolidityParser ()
inCommentMulti =
  do try (string (commentEnd solidityLanguage)); return ()
    <|> do multiLineComment; inCommentMulti
    <|> do skipMany1 (noneOf startEnd); inCommentMulti
    <|> do oneOf startEnd; inCommentMulti
    <?> "end of comment"
  where
    startEnd = nub (commentEnd solidityLanguage ++ commentStart solidityLanguage)

inCommentSingle :: SolidityParser ()
inCommentSingle =
  do try (string (commentEnd solidityLanguage)); return ()
    <|> do skipMany1 (noneOf startEnd); inCommentSingle
    <|> do oneOf startEnd; inCommentSingle
    <?> "end of comment"
  where
    startEnd = nub (commentEnd solidityLanguage ++ commentStart solidityLanguage)
