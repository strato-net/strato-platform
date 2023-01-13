{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass    #-}
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

import           Control.DeepSeq

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
                   | Alias a String String
                   | NamedXabi Text.Text (XabiF a, [Text.Text])
                   | FLFunc String SolidVM.Func
                   | FLConstant Text.Text SolidVM.ConstantDecl
                   | FLStruct Text.Text SolidVM.Def
                   | FLEnum Text.Text SolidVM.Def
                   | FLError Text.Text SolidVM.Def
                   | DummySourceUnit
                   deriving (Eq, Show, Generic, NFData, Functor)

type SourceUnit = Positioned SourceUnitF

-- | Parses an entire Solidity contract
solidityContract :: SolidityParser SourceUnit
solidityContract = do
  pragmaVersion' <- getPragmaVersion
  ~(a, (kind, contractName', baseConstrs)) <- withPosition $ do
    kind <- (reserved "contract" >> return Xabi.ContractKind)
          <|> (reserved "interface" >> return Xabi.InterfaceKind)
          <|> (reserved "library" >> return Xabi.LibraryKind)
    contractName' <- fmap stringToLabel identifier
    --Throw an error if 'account' is used.
    when (isReservedWord pragmaVersion' contractName') $ reservedWordError pragmaVersion' contractName'
    modifyState(\s -> s { contractName = (labelToString contractName') })
    baseConstrs <- option [] $ do
      reserved "is"
      commaSep1 $ do
        name <- intercalate "." <$> sepBy1 identifier dot
        consArgs <- option "" parensCode
        return (name, consArgs)
    pure (kind, contractName', baseConstrs)
  declarations <-
    braces (many $ solidityDeclaration False)

  let allFunctions = Map.fromListWith (parseOverloads pragmaVersion') [ (stringToLabel n, f) | (n, FuncDeclaration f) <- declarations ]
  let ctorList = [(stringToLabel n, c) | (n, ConstructorDeclaration c) <- declarations]
  let events = [(stringToLabel n, e) | (n, EventDeclaration e) <- declarations]
  let using = [(Text.pack n, u) | (n, UsingDeclaration u) <- declarations]
  allCtors <- if length ctorList > 1
                  then fail "multiple constructors defined"
                  else return . Map.fromList $ ctorList

  return $ NamedXabi (labelToText contractName') (
        Xabi { _xabiFuncs = allFunctions
             , _xabiConstr = allCtors
--             , xabiVars = variables declarations
             , _xabiVars = Map.fromList [(stringToLabel n, varDecl) | (n, VariableDeclaration varDecl) <- declarations]
             , _xabiConstants = Map.fromList [(stringToLabel n, constDecl) | (n, ConstantDeclaration constDecl) <- declarations]
             , _xabiTypes =
               Map.fromList $
               [ (stringToLabel name, enum) | (name, EnumDeclaration enum) <- declarations]
               ++ [ (stringToLabel name, struct) | (name, StructDeclaration struct) <- declarations]
               ++ [ (stringToLabel n, e) | (n, ErrorDeclaration e) <- declarations]
             , _xabiModifiers = Map.fromList [(stringToLabel name, modifier) | (name, ModifierDeclaration modifier) <- declarations]
             , _xabiEvents = Map.fromList events
             , _xabiKind = kind
             , _xabiUsing = Map.fromList using
             , _xabiContext = a
           },
        map (Text.pack . fst) baseConstrs
      )
  where
    parseOverloads :: String -> SolidVM.Func -> SolidVM.Func -> SolidVM.Func
    parseOverloads _ new old = do
      let oldParamTypes = fmap snd $ SolidVM._funcArgs old
          newParamTypes = fmap snd $ SolidVM._funcArgs new
          overloadParamTypes = concatMap (\x -> [fmap snd $ SolidVM._funcArgs x]) $ SolidVM._funcOverload old
       in if ((oldParamTypes == newParamTypes) || (newParamTypes `elem` overloadParamTypes))
            then invalidArguments ("Function is already defined with similar params.") $ SolidVM._funcArgs new
            else
              old{SolidVM._funcOverload = SolidVM._funcOverload old ++ [new]}


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

-- | Parses a free function
solidityFreeFunction :: SolidityParser SourceUnit
solidityFreeFunction = do
  (fname, (FuncDeclaration a)) <- functionDeclaration True
  when (SolidVM._funcVisibility a /= Just SolidVM.Internal) $ fail "Free functions always have implicit Internal visibility."
  return $ FLFunc fname $ SolidVM.Func 
    { SolidVM._funcArgs = SolidVM._funcArgs a
    , SolidVM._funcVals = SolidVM._funcVals a
    , SolidVM._funcStateMutability = SolidVM._funcStateMutability a
    , SolidVM._funcContents = SolidVM._funcContents a
    , SolidVM._funcVisibility = SolidVM._funcVisibility a
    , SolidVM._funcConstructorCalls = SolidVM._funcConstructorCalls a
    , SolidVM._funcModifiers = SolidVM._funcModifiers a
    , SolidVM._funcContext = SolidVM._funcContext a
    , SolidVM._funcIsFree = True
    , SolidVM._funcOverload = SolidVM._funcOverload a
    }

data Declaration =
  FuncDeclaration SolidVM.Func
  | ConstructorDeclaration SolidVM.Func
  | ModifierDeclaration Xabi.Modifier
  | StructDeclaration SolidVM.Def
  | ErrorDeclaration SolidVM.Def
  | EnumDeclaration SolidVM.Def
  | UsingDeclaration Xabi.Using
  | EventDeclaration SolidVM.Event
  | VariableDeclaration SolidVM.VariableDecl
  | ConstantDeclaration SolidVM.ConstantDecl
  | DummyDeclaration
--  | VariableDeclaration SVMType.Type Bool Bool (Maybe Expression)
  deriving (Eq, Show)

-- | Parses anything that a contract can declare at the top level: new types,
-- variables, functions primarily, also events and function modifiers.
solidityDeclaration :: Bool -> SolidityParser (String, Declaration)
solidityDeclaration free =
  structDeclaration <|>
  enumDeclaration <|>
  usingDeclaration <|>
  errorDeclaration <|>
  functionDeclaration free<|>
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
      (fieldName, VariableDeclaration (SolidVM.VariableDecl decl _ _ _ _)) <- simpleVariableDeclaration
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

solidityFLStruct :: SolidityParser SourceUnit
solidityFLStruct = do
  ~(a, (structName, structFields)) <- withPosition $ do
    reserved "struct"
    structName <- identifier
    structFields <- braces $ many1 $ do
      (fieldName, VariableDeclaration (SolidVM.VariableDecl decl _ _ _ _)) <- simpleVariableDeclaration
      return (fieldName, decl)
    pure (structName, structFields)
  return $ FLStruct (Text.pack structName) (SolidVM.Struct{ SolidVM.fields = zipWith (\(n, v) i -> (stringToLabel n, SolidVM.FieldType i v)) structFields [0..], SolidVM.bytes = 0, SolidVM.context = a})
    -- (
    --   structName,
    --   StructDeclaration SolidVM.Struct{
    --     SolidVM.fields =
    --        zipWith (\(n, v) i -> (stringToLabel n, SolidVM.FieldType i v)) structFields [0..],
    --     SolidVM.bytes = 0,
    --     SolidVM.context = a
    --     }
    -- )

solidityFLEnum :: SolidityParser SourceUnit
solidityFLEnum = do
  ~(a, (enumName, enumFields)) <- withPosition $ do
    reserved "enum"
    enumName <- identifier
    enumFields <- braces $ commaSep1 identifier
    pure (enumName, enumFields)
  return $ FLEnum (Text.pack enumName) (SolidVM.Enum {SolidVM.names = map stringToLabel enumFields, SolidVM.bytes = 0, SolidVM.context = a})
    -- (
    --   enumName,
    --   EnumDeclaration SolidVM.Enum {
    --     SolidVM.names = map stringToLabel enumFields,
    --     SolidVM.bytes = 0,
    --     SolidVM.context = a
    --     }
    -- )

solidityFLError :: SolidityParser SourceUnit
solidityFLError = do
  pragmaVersion' <- getPragmaVersion
  ~(a, (errorName, errorArgs)) <- withPosition $ do
    reserved "error"
    errorName <- identifier
    when (isReservedWord pragmaVersion' errorName) $ reservedWordError pragmaVersion' errorName
    errorArgs <- parens $ commaSep $ do
      partType <- simpleTypeExpression
      partName <- identifier
      return (Text.pack partName, partType)
    semi
    pure (errorName, errorArgs)
  return $ FLError (Text.pack errorName) (SolidVM.Error {
      SolidVM.params = map (\(k, v) -> (textToLabel k, v)) $
          zipWith (\x i -> fmap (SolidVM.IndexedType i) x) errorArgs [0..]
    , SolidVM.bytes = 0
    , SolidVM.context = a
  })

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

data StateVariableKeyword = KConstant | KPublic | KPrivate | KInternal | KImmutable
  deriving (Eq, Show, Enum, Ord)

stateVariableKeyword :: SolidityParser StateVariableKeyword
stateVariableKeyword =
     (try (reserved "constant") >> return KConstant) <|>
     (try (reserved "immutable") >> return KImmutable) <|>
     (try (reserved "public") >> return KPublic) <|>
     (try (reserved "private") >> return KPrivate) <|>
     (try (reserved "internal") >> return KInternal)

public :: [StateVariableKeyword] -> SolidityParser Bool
public keywords =
  let visibilities = nub . filter (\x -> (x /= KConstant) && (x /= KImmutable) ) $ keywords
  in case visibilities of
        (v1:v2:_) -> fail $ printf "multiple visibilities declared: %s vs %s" (show v1) (show v2)
        [KPublic] -> return True
        _ -> return False


solidityFLConstant :: SolidityParser SourceUnit
solidityFLConstant = do
  pragmaVersion' <- getPragmaVersion
  start <- getSourcePosition
  variableType <- simpleTypeExpression
  -- We have to remember which variables are "public", because they
  -- generate accessor functions
  keywords <- many stateVariableKeyword
  let isConstant = KConstant `elem` keywords
  isPublic <- public keywords
  -- check to see if the "account" variable is being used
  variableName <- identifier
  when (isReservedWord pragmaVersion' variableName) $ reservedWordError pragmaVersion' variableName
  value <- optionMaybe $ do
    reservedOp "="
    expression
  end <- getSourcePosition
  semi
  let ctx = SourceAnnotation start end ()
  if isConstant
    then return $ FLConstant (labelToText variableName) (SolidVM.ConstantDecl variableType isPublic (fromMaybe (parseError "constants must be initialized" variableName) value) ctx)
    else fail "only constants can be declared in the top level"




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
  let isImmutable  = KImmutable  `elem` keywords
  let isConstant   = KConstant  `elem` keywords
  if isConstant
    then return (variableName, ConstantDeclaration $ SolidVM.ConstantDecl variableType isPublic (fromMaybe (parseError "constants must be initialized" variableName) value) ctx)
    else return (variableName, VariableDeclaration $ SolidVM.VariableDecl variableType isPublic value ctx isImmutable)

errorDeclaration :: SolidityParser (String, Declaration)
errorDeclaration = do
  pragmaVersion' <- getPragmaVersion
  start <- getSourcePosition
  reserved "error"
  errorName <- identifier
  when (isReservedWord pragmaVersion' errorName) $ reservedWordError pragmaVersion' errorName
  errorArgs <- parens $ commaSep $ do
      partType <- simpleTypeExpression
      partName <- identifier
      return (Text.pack partName, partType)
  end <- getSourcePosition
  semi
  return (errorName, ErrorDeclaration SolidVM.Error {
      SolidVM.params = map (\(k, v) -> (textToLabel k, v)) $
          zipWith (\x i -> fmap (SolidVM.IndexedType i) x) errorArgs [0..]
    , SolidVM.bytes = 0
    , SolidVM.context = SourceAnnotation start end ()
  })

-- | Parses a function definition.
--
functionDeclaration :: Bool -> SolidityParser (String, Declaration)
functionDeclaration free = do
  ~(a, (functionName, xabi')) <- withPosition $ do
    functionName <- (reserved "function" >> fromMaybe "" <$> optionMaybe identifier)  <|>
                    -- Starting with 0.4.22, constructor() <mods> { <body> } is
                    -- the preferred syntax for defining a constructor
                    (reserved "constructor" >> getContractName) <|>
                    ("receive" <$ reserved "receive") <|>
                    ("fallback" <$ reserved "fallback")

    -- Throw an error if the function name is part of secondary reservered words.
    pragmaVersion' <- getPragmaVersion
    when (isReservedWord pragmaVersion' functionName) $ reservedWordError pragmaVersion' functionName
    xabi <- functionXabi free
    pure (functionName, xabi)
  cName <- getContractName
  let xabi = xabi'{SolidVM._funcContext = a <> SolidVM._funcContext xabi'}
      tipe = if cName == functionName
                then ConstructorDeclaration 
                else FuncDeclaration 
  return (functionName, tipe xabi)

functionXabi :: Bool -> SolidityParser SolidVM.Func
functionXabi free = do
  start <- getSourcePosition
  functionArgs <- tupleDeclaration
  (functionRet, visibility, freevisibility, mutability, funcConstructorCallsOrModifiers) <- functionModifiers
  end <- getSourcePosition
  contents <- Just <$> statements <|> (reservedOp ";" >> return Nothing)
  let nameUnnamed (name,ty) = if Text.null name then (Nothing, ty) else (Just name,ty)
      ctx = SourceAnnotation start end ()
  -- TODO: use Lenses instead?
  return SolidVM.Func{
        SolidVM._funcArgs = map (\(k, v) -> (fmap textToLabel k, v)) $
           zipWith (\x i -> fmap (SolidVM.IndexedType i) (nameUnnamed x)) functionArgs [0..]
      , SolidVM._funcVals = map (\(k, v) -> (fmap textToLabel k, v)) $
           zipWith (\v i -> fmap (SolidVM.IndexedType i) (nameUnnamed v)) functionRet [0..]
      , SolidVM._funcContents = contents
      , SolidVM._funcVisibility = if (free) then Just freevisibility else Just visibility
      , SolidVM._funcStateMutability = mutability
      , SolidVM._funcConstructorCalls = Map.fromList funcConstructorCallsOrModifiers
      , SolidVM._funcModifiers = funcConstructorCallsOrModifiers
      , SolidVM._funcContext = ctx
      , SolidVM._funcIsFree = False
      , SolidVM._funcOverload = []
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
  contents <- Just <$> statements <|> (reservedOp ";" >> return Nothing)
  end <- getSourcePosition
  let ctx = SourceAnnotation start end ()
      nameUnnamed (_name,ty) i = if Text.null _name then (Text.pack ('#' : show i),ty) else (_name,ty)
  return
    (
      name,
      ModifierDeclaration Xabi.Modifier{
        Xabi._modifierArgs = -- undefined args -- :: Map Text SolidVM.IndexedType
          Map.fromList $
            zipWith (\x i -> fmap (SolidVM.IndexedType i) (nameUnnamed x i)) args [0..]
      , Xabi._modifierSelector = Text.pack name -- ? -- undefined -- :: Text
      , Xabi._modifierContents = contents -- :: Maybe [Statement]
      , Xabi._modifierContext = ctx
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
             reserved "memory" <|>
             reserved "calldata"
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
                   | ConstructorCallModsOrOtherMod (SolidString, [SolidVM.Expression])
--                   | OtherMod String

functionModifiers :: SolidityParser ([(Text, SVMType.Type)], SolidVM.Visibility, SolidVM.Visibility, Maybe SolidVM.StateMutability, [(SolidString, [SolidVM.Expression])])
functionModifiers = do
  vals <- many $ (ReturnsMod <$> returnModifier)
             <|>  (VisibilityMod <$> visibilityModifier)
             <|>  (MutabilityMod <$> mutabilityModifier)
             <|>  (ConstructorCallModsOrOtherMod <$> constructorCallModifiersOrOtherModifiers)
--             <|>  (OtherMod <$> otherModifiers)-- (lookAhead (reserved "{"))
  return $ formatVals vals
  where
    formatVals vals =
      let returns = concat [v | ReturnsMod v <- vals]
          visibility = fromMaybe SolidVM.Public $ listToMaybe [v | VisibilityMod v <- vals]
          freevisibility = fromMaybe SolidVM.Internal $ listToMaybe [v | VisibilityMod v <- vals]
          mutability = listToMaybe [v | MutabilityMod v <- vals]
      --    otherMods = [v | OtherMod v <- vals]
          constructorCallModsOrOtherMods = [v | ConstructorCallModsOrOtherMod v <- vals]
      in (returns, visibility, freevisibility, mutability, constructorCallModsOrOtherMods)
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
    constructorCallModifiersOrOtherModifiers = do 
      name <- stringToLabel <$> identifier
      exps <- optionMaybe (parens $ commaSep expression)
      return (name, fromMaybe [] exps) 

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
isReservedWord version _ = do
  case version of
    _ -> False