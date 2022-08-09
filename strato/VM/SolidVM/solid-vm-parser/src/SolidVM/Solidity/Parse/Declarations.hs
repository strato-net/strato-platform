{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
-- |
-- Module: Declarations
-- Description: Parsers for top-level Solidity declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net
-- Maintainer: Charles Crain <charles@blockapps.net>
-- Maintainer: Steven Glasford <steven_glasford@blockapps.net>
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Declarations where

import           Control.Monad                     (when)
import           Data.List
import qualified Data.Map as Map
import           Data.Maybe
import           Data.Text                            (Text)
import qualified Data.Text                            as Text
import           Data.Source

import           GHC.Generics

import           Text.Parsec
import           Text.Parsec.Token                    (GenLanguageDef(..))
import           Text.Printf                          (printf)

import qualified SolidVM.Model.CodeCollection              as SolidVM
import qualified SolidVM.Model.CodeCollection.Def          as SolidVM
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type                        as SVMType

import           SolidVM.Solidity.Parse.Statement
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Types

import           SolidVM.Solidity.Xabi              (XabiF (..))
import qualified SolidVM.Solidity.Xabi              as Xabi

import           Blockchain.VM.SolidException

data SourceUnitF a = Pragma a Identifier String
                   | Import a Text.Text
                   | NamedXabi Text.Text (XabiF a, [Text.Text])
                   deriving (Eq, Show, Generic, Functor)

type SourceUnit = Positioned SourceUnitF

-- | Parses an entire Solidity contract
solidityContract :: SolidityParser SourceUnit
solidityContract = do
  ~(a, (kind, contractName', baseConstrs)) <- withPosition $ do
    kind <- (reserved "contract" >> return Xabi.ContractKind)
          <|> (reserved "interface" >> return Xabi.InterfaceKind)
          <|> (reserved "library" >> return Xabi.LibraryKind)
    contractName' <- fmap stringToLabel identifier
    --Throw an error if 'account' is used.
    pragmaVersion' <- getPragmaVersion
    when (isReservedWord pragmaVersion' contractName') $ reservedWordError pragmaVersion' contractName'
    setContractName $ labelToString contractName'
    baseConstrs <- option [] $ do
      reserved "is"
      commaSep1 $ do
        name <- intercalate "." <$> sepBy1 identifier dot
        consArgs <- option "" parensCode
        return (name, consArgs)
    pure (kind, contractName', baseConstrs)
  declarations <-
    braces (many solidityDeclaration)

  let allFunctions = Map.fromList [ (stringToLabel n, f) | (n, FuncDeclaration f) <- declarations]
  let ctorList = [(stringToLabel n, c) | (n, ConstructorDeclaration c) <- declarations]
  let events = [(stringToLabel n, e) | (n, EventDeclaration e) <- declarations]
  let using = [(Text.pack n, u) | (n, UsingDeclaration u) <- declarations]
  allCtors <- if length ctorList > 1
                  then fail "multiple constructors defined"
                  else return . Map.fromList $ ctorList

  return $ NamedXabi (labelToText contractName') (
        Xabi { xabiFuncs = allFunctions
             , xabiConstr = allCtors
--             , xabiVars = variables declarations
             , xabiVars = Map.fromList [(stringToLabel n, varDecl) | (n, VariableDeclaration varDecl) <- declarations]
             , xabiConstants = Map.fromList [(stringToLabel n, constDecl) | (n, ConstantDeclaration constDecl) <- declarations]
             , xabiTypes =
               Map.fromList $
               [ (stringToLabel name, enum) | (name, EnumDeclaration enum) <- declarations]
               ++ [ (stringToLabel name, struct) | (name, StructDeclaration struct) <- declarations]
             , xabiModifiers = Map.fromList [(stringToLabel name, modifier) | (name, ModifierDeclaration modifier) <- declarations]
             , xabiEvents = Map.fromList events
             , xabiKind = kind
             , xabiUsing = Map.fromList using
             , xabiContext = a
           },
        map (Text.pack . fst) baseConstrs
      )

--  where -- constants = byMutability True (repeat 0)

--        variables = byMutability False [0,32..]

--        byMutability :: Bool -> [Int] -> [(String, Declaration)] -> [((Text, SVMType.Type), Bool, Bool, Maybe Expression)]
--        byMutability isConst ns = Map.fromList . flip (zipWith mapVarTypes) ns . varTypesOf isConst

--        mapVarTypes (v, isPub, isConst, val) i =
--          fmap (SVMType.VarType i (visibility isPub) (Just isConst) val) v

--        varTypesOf :: Bool
--                   -> [(String, Declaration)]
--                   -> [((Text, SVMType.Type), Bool, Bool, Maybe Expression)]
--        varTypesOf isConstant = map (\(n, VariableDeclaration v isPub isConst val) ->
--                                   ((Text.pack n, v), isPub, isConst, val))
--                           . filter (\(_, decl) -> case decl of
--                                        (VariableDeclaration _ _ c _) -> isConstant == c
--                                        _ -> False)

--        visibility isPub = if isPub then Just True else Nothing



data Declaration =
  FuncDeclaration SolidVM.Func
  | ConstructorDeclaration SolidVM.Func
  | ModifierDeclaration Xabi.Modifier
  | StructDeclaration SolidVM.Def
  | EnumDeclaration SolidVM.Def
  | UsingDeclaration Xabi.Using
  | EventDeclaration SolidVM.Event
  | VariableDeclaration SolidVM.VariableDecl
  | ConstantDeclaration SolidVM.ConstantDecl
--  | VariableDeclaration SVMType.Type Bool Bool (Maybe Expression)
  deriving (Eq, Show)

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
  ~(a, (structName, structFields)) <- withPosition $ do
    reserved "struct"
    structName <- identifier
    structFields <- braces $ many1 $ do
      (fieldName, VariableDeclaration (SolidVM.VariableDecl decl _ _ _)) <- simpleVariableDeclaration
      return (fieldName, decl)
    pure (structName, structFields)
  return
    (
      structName,
      StructDeclaration SolidVM.Struct{
        SolidVM.fields =
           zipWith (\(n, v) i -> (stringToLabel n, SolidVM.FieldType i v)) structFields [0..],
        SolidVM.bytes = 0,
        SolidVM.context = a
        }
    )

-- | Parses an enum definition
enumDeclaration :: SolidityParser (String, Declaration)
enumDeclaration = do
  ~(a, (enumName, enumFields)) <- withPosition $ do
    reserved "enum"
    enumName <- identifier
    enumFields <- braces $ commaSep1 identifier
    pure (enumName, enumFields)
  return
    (
      enumName,
      EnumDeclaration SolidVM.Enum {
        SolidVM.names = map stringToLabel enumFields,
        SolidVM.bytes = 0,
        SolidVM.context = a
        }
    )

usingDeclaration :: SolidityParser (String, Declaration)
usingDeclaration = do
  ~(a, (usingContract', rest)) <- withPosition $ do
    reserved "using"
    usingContract' <- identifier
    rest <- many1 (noneOf ";")
    semi
    pure (usingContract', rest)
  return
    (
      usingContract',
      UsingDeclaration (Xabi.Using rest a)
    )

{- Variables -}

-- | Parses a variable definition
variableDeclaration :: SolidityParser (String, Declaration)
variableDeclaration = simpleVariableDeclaration

data StateVariableKeyword = KConstant | KPublic | KPrivate | KInternal
  deriving (Eq, Show, Enum, Ord)

stateVariableKeyword :: SolidityParser StateVariableKeyword
stateVariableKeyword =
     (try (reserved "constant") >> return KConstant) <|>
     (try (reserved "public") >> return KPublic) <|>
     (try (reserved "private") >> return KPrivate) <|>
     (try (reserved "internal") >> return KInternal)

public :: [StateVariableKeyword] -> SolidityParser Bool
public keywords =
  let visibilities = nub . filter (/= KConstant) $ keywords
  in case visibilities of
        (v1:v2:_) -> fail $ printf "multiple visibilities declared: %s vs %s" (show v1) (show v2)
        [KPublic] -> return True
        _ -> return False


-- | Parses the declaration part of a variable definition, which is
-- everything except possibly the initializer and semicolon.  Necessary
-- because these kinds of expressions also appear in struct definitions and
-- function arguments.
simpleVariableDeclaration :: SolidityParser (String, Declaration) -- , Maybe Expression)
simpleVariableDeclaration = do
  start <- getSourcePosition
  variableType <- simpleTypeExpression
  -- We have to remember which variables are "public", because they
  -- generate accessor functions
  keywords <- many stateVariableKeyword
  let isConstant = KConstant `elem` keywords
  isPublic <- public keywords
  -- check to see if the "account" variable is being used
  variableName <- identifier
  pragmaVersion' <- getPragmaVersion
  when (isReservedWord pragmaVersion' variableName) $ reservedWordError pragmaVersion' variableName
  value <- optionMaybe $ do
    reservedOp "="
    expression
  end <- getSourcePosition
  semi
  let ctx = SourceAnnotation start end ()

  if isConstant
    then return (variableName, ConstantDeclaration $ SolidVM.ConstantDecl variableType isPublic (fromMaybe (parseError "constants must be initialized" variableName) value) ctx)
    else return (variableName, VariableDeclaration $ SolidVM.VariableDecl variableType isPublic value ctx)


-- | Parses a function definition.
--
functionDeclaration :: SolidityParser (String, Declaration)
functionDeclaration = do
  ~(a, (functionName, xabi')) <- withPosition $ do
    functionName <- (reserved "function" >> fromMaybe "" <$> optionMaybe identifier)  <|>
                    -- Starting with 0.4.22, constructor() <mods> { <body> } is
                    -- the preferred syntax for defining a constructor
                    (reserved "constructor" >> getContractName)
    -- Throw an error if the function name is part of secondary reservered words.
    pragmaVersion' <- getPragmaVersion
    when (isReservedWord pragmaVersion' functionName) $ reservedWordError pragmaVersion' functionName
    xabi <- functionXabi
    pure (functionName, xabi)
  cName <- getContractName
  let xabi = xabi'{SolidVM._funcContext = a <> SolidVM._funcContext xabi'}
      tipe = if cName == functionName
                then ConstructorDeclaration
                else FuncDeclaration
  return (functionName, tipe xabi)

functionXabi :: SolidityParser SolidVM.Func
functionXabi = do
  start <- getSourcePosition
  functionArgs <- tupleDeclaration
  (functionRet, visibility, mutability, constructorCalls, modifiers) <- functionModifiers
-- This end statment is not in the right spot.

  contents <- Just <$> statements <|> (reservedOp ";" >> return Nothing)
  end <- getSourcePosition
  -- (contents, end) <- pure (,) <*> (Just <$> statements <|> (reservedOp ";" >> return Nothing)) <*> getSourcePosition
  -- end <- getSourcePosition
  let nameUnnamed (name,ty) = if Text.null name then (Nothing, ty) else (Just name,ty)
      ctx = SourceAnnotation start end ()
  -- TODO: use Lenses instead?
  return SolidVM.Func{
        SolidVM._funcArgs = map (\(k, v) -> (fmap textToLabel k, v)) $
           zipWith (\x i -> fmap (SolidVM.IndexedType i) (nameUnnamed x)) functionArgs [0..]
      , SolidVM._funcVals = map (\(k, v) -> (fmap textToLabel k, v)) $
           zipWith (\v i -> fmap (SolidVM.IndexedType i) (nameUnnamed v)) functionRet [0..]
      , SolidVM._funcContents = contents
      , SolidVM._funcVisibility = Just visibility
      , SolidVM._funcStateMutability = mutability
      , SolidVM._funcConstructorCalls = Map.fromList constructorCalls
      , SolidVM._funcModifiers = Just modifiers
      , SolidVM._funcContext = ctx
      }

eventDeclaration :: SolidityParser (String, Declaration)
eventDeclaration = do
  start <- getSourcePosition
  reserved "event"
  name <- identifier
  logs <- tupleDeclaration
  anon <- option False (reserved "anonymous" >> return True)
  end <- getSourcePosition
  semi

  let ctx = SourceAnnotation start end ()
  return
    (
      name,
      --TODO: use lenses?
      EventDeclaration SolidVM.Event{
          SolidVM._eventAnonymous = anon
        , SolidVM._eventLogs = zipWith (\i -> fmap (SolidVM.IndexedType i)) [0..] logs
        , SolidVM._eventContext = ctx
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
  start <- getSourcePosition
  reserved "modifier"
  name <- identifier
  args <- option [] tupleDeclaration
--  defn <- bracedCode
  contents <- bracedCode
  end <- getSourcePosition
  let ctx = SourceAnnotation start end ()
      nameUnnamed (_name,ty) i = if Text.null _name then (Text.pack ('#' : show i),ty) else (_name,ty)
  return
    (
      name,
      ModifierDeclaration Xabi.Modifier{
        Xabi.modifierArgs = -- undefined args -- :: Map Text SolidVM.IndexedType
           Map.fromList $
             zipWith (\x i -> fmap (SolidVM.IndexedType i) (nameUnnamed x i)) args [0..]
      , Xabi.modifierSelector = Text.pack name -- ? -- undefined -- :: Text
      , Xabi.modifierVals = Map.fromList [] -- undefined -- :: Map Text SolidVM.IndexedType
      , Xabi.modifierContents = if null contents then Nothing else Just $ Text.pack contents
      , Xabi.modifierContext = ctx
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
tupleDeclaration :: SolidityParser [(Text, SVMType.Type)]
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

data FuncModifiers = ReturnsMod [(Text, SVMType.Type)]
                   | VisibilityMod SolidVM.Visibility
                   | MutabilityMod SolidVM.StateMutability
                   | ConstructorCallMod (SolidString, [SolidVM.Expression])
                   | OtherMod String

functionModifiers :: SolidityParser ([(Text, SVMType.Type)], SolidVM.Visibility, Maybe SolidVM.StateMutability, [(SolidString, [SolidVM.Expression])], [String])
functionModifiers = do
  vals <- many $ (ReturnsMod <$> returnModifier)
             <|>  (VisibilityMod <$> visibilityModifier)
             <|>  (MutabilityMod <$> mutabilityModifier)
             <|>  (ConstructorCallMod <$> constructorCallModifiers)
             <|>  (OtherMod <$> otherModifiers)
  return $ formatVals vals
  where
    formatVals vals =
      let returns = concat [v | ReturnsMod v <- vals]
          visibility = fromMaybe SolidVM.Public $ listToMaybe [v | VisibilityMod v <- vals]
          mutability = listToMaybe [v | MutabilityMod v <- vals]
          otherMods = [v | OtherMod v <- vals]
          constructorCallMods = [v | ConstructorCallMod v <- vals]
      in (returns, visibility, mutability, constructorCallMods, otherMods)
    returnModifier =
      reserved "returns" >> tupleDeclaration
    visibilityModifier =
      (   (reserved "public"   >> return SolidVM.Public)
      <|> (reserved "private"  >> return SolidVM.Private)
      <|> (reserved "external" >> return SolidVM.External)
      <|> (reserved "internal" >> return SolidVM.Internal)
      )
    mutabilityModifier =
      (
          (reserved "constant" >> return SolidVM.Constant)
      <|> (reserved "pure"     >> return SolidVM.Pure)
      <|> (reserved "view"     >> return SolidVM.View)
      <|> (reserved "payable"  >> return SolidVM.Payable)
      )
    constructorCallModifiers = do
      name <- stringToLabel <$> identifier
      exps <- parens $ commaSep expression
      return (name, exps)
    otherModifiers = do
      name <- identifier
      args <- optionMaybe parensCode
      return $ name ++ maybe "" (\s -> "(" ++ s ++ ")") args

-- | A common pattern: code enclosed in braces, allowing nested braces.
bracedCode :: SolidityParser String
bracedCode = braces . fmap concat . many $
        (show <$> try stringLiteral)
    <|> (comment >> return "")
    <|> ((:[]) <$> noneOf "{}\"")
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

--To make a new reserved word with a specific pragma version please add to the following function list, 
  -- This assumes that only the solidvm pragma name is used. Please change if new pragmaNames are added.
isReservedWord :: String -> String -> Bool
isReservedWord version reservedWord = do
  case version of
    "3.2" -> do 
      case reservedWord of
        "account" -> True
        _ -> False
    _ -> False