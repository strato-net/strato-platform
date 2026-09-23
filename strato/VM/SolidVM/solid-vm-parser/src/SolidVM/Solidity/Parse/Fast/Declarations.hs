{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

-- |
-- Module: Fast.Declarations
-- Description: Contracts and what they declare, over tokens
module SolidVM.Solidity.Parse.Fast.Declarations
  ( solidityContract,
    functionDeclaration,
    usingDeclaration,
    structFields,
    mkStruct,
    enumFields,
    mkEnum,
    errorArgs,
    mkError,
    stateVariable,
  )
where

import Blockchain.VM.SolidException (invalidArguments, parseError)
import Control.Monad (when)
import Data.List (nub, uncons)
import qualified Data.Map as Map
import Data.Maybe (fromMaybe, isJust, listToMaybe)
import Data.Source (SourceAnnotation (..))
import Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection as SolidVM
import qualified SolidVM.Model.CodeCollection.Def as SolidVM
import SolidVM.Model.CodeCollection.Statement (Location (..))
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Declarations (Declaration (..), SourceUnit, SourceUnitF (..))
import SolidVM.Solidity.Parse.Fast.Expression
import SolidVM.Solidity.Parse.Fast.Lexer (Token (..))
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Fast.Statement
import SolidVM.Solidity.Parse.Fast.Types
import qualified SolidVM.Solidity.Xabi as Xabi

------------------------------------------------------------------------------
-- Contracts

solidityContract :: P SourceUnit
solidityContract = do
  ~(a, (kind, name, parents)) <- withPosition $ do
    kind <-
      (SolidVM.ContractType <$ reserved "contract")
        <|> (SolidVM.InterfaceType <$ reserved "interface")
        <|> (SolidVM.AbstractType <$ (reserved "abstract" *> reserved "contract"))
        <|> (SolidVM.LibraryType <$ reserved "library")
    optional (reserved "record")
    name <- identifier
    modifySt (\s -> s {contractName = name})
    -- constructor arguments given to a parent here are not kept
    parents <- option [] $ reserved "is" *> commaSep1 (dotted <* optional (parens (commaSep expression)))
    pure (kind, name, parents)
  declarations <- braces (many (declaration False))
  constructor <- case [c | (_, ConstructorDeclaration c) <- declarations] of
    [] -> pure Nothing
    [c] -> pure (Just c)
    _ -> empty
  pure . FLContract $
    SolidVM.Contract
      { SolidVM._contractName = stringToLabel name,
        SolidVM._parents = parents,
        SolidVM._storageDefs = Map.fromList [(stringToLabel n, v) | (n, VariableDeclaration v) <- declarations],
        SolidVM._userDefined = Map.empty,
        SolidVM._constants = Map.fromList [(stringToLabel n, c) | (n, ConstantDeclaration c) <- declarations],
        SolidVM._enums = Map.fromList [(stringToLabel n, (vals, x)) | (n, EnumDeclaration (SolidVM.Enum vals _ x)) <- declarations],
        SolidVM._structs = Map.fromList [(n, (\(k, v) -> (k, v, x)) <$> vals) | (n, StructDeclaration (SolidVM.Struct vals _ x)) <- declarations],
        SolidVM._errors = Map.fromList [(n, (\(k, v) -> (k, v, x)) <$> vals) | (n, ErrorDeclaration (SolidVM.Error vals _ x)) <- declarations],
        SolidVM._events = Map.fromList [(stringToLabel n, e) | (n, EventDeclaration e) <- declarations],
        SolidVM._functions = Map.fromListWith overload [(stringToLabel n, f) | (n, FuncDeclaration f) <- declarations],
        SolidVM._modifiers = Map.fromList [(stringToLabel n, m) | (n, ModifierDeclaration m) <- declarations],
        SolidVM._usings = [u | (_, UsingDeclaration u) <- declarations],
        SolidVM._constructor = constructor,
        SolidVM._contractType = kind,
        SolidVM._importedFrom = Nothing,
        SolidVM._contractContext = a
      }
  where
    dotted = T.unpack . T.intercalate "." . map T.pack <$> sepBy1 identifier (sym ".")
    overload new old =
      let params f = map snd (SolidVM._funcArgs f)
       in if params old == params new || params new `elem` map params (SolidVM._funcOverload old)
            then invalidArguments "Function is already defined with similar params." (SolidVM._funcArgs new)
            else old {SolidVM._funcOverload = SolidVM._funcOverload old ++ [new]}

-- | Anything a contract declares; @free@ for a declaration at file level.
declaration :: Bool -> P (String, Declaration)
declaration free = do
  t <- peek
  case tText t of
    "struct" -> structDeclaration
    "enum" -> enumDeclaration
    "using" -> ("using",) . UsingDeclaration <$> usingDeclaration free
    "error" -> errorDeclaration
    "function" -> functionDeclaration free
    "constructor" -> functionDeclaration free
    "receive" -> functionDeclaration free
    "fallback" -> functionDeclaration free
    "modifier" -> modifierDeclaration
    "event" -> eventDeclaration
    _ -> stateVariable

------------------------------------------------------------------------------
-- Types

structFields :: P (String, [(String, SVMType.Type)])
structFields = do
  reserved "struct"
  name <- identifier
  fields <- braces $
    many1 $ do
      t <- simpleTypeExpression
      field <- identifier
      semi
      pure (field, t)
  pure (name, fields)

mkStruct :: SourceAnnotation () -> [(String, SVMType.Type)] -> SolidVM.Def
mkStruct a fields =
  SolidVM.Struct
    { SolidVM.fields = zipWith (\(n, v) i -> (stringToLabel n, SolidVM.FieldType i v)) fields [0 ..],
      SolidVM.bytes = 0,
      SolidVM.context = a
    }

structDeclaration :: P (String, Declaration)
structDeclaration = do
  ~(a, (name, fields)) <- withPosition structFields
  pure (name, StructDeclaration (mkStruct a fields))

enumFields :: P (String, [String])
enumFields = do
  reserved "enum"
  name <- identifier
  fields <- braces (commaSep1 identifier)
  pure (name, fields)

mkEnum :: SourceAnnotation () -> [String] -> SolidVM.Def
mkEnum a fields = SolidVM.Enum {SolidVM.names = map stringToLabel fields, SolidVM.bytes = 0, SolidVM.context = a}

enumDeclaration :: P (String, Declaration)
enumDeclaration = do
  ~(a, (name, fields)) <- withPosition enumFields
  pure (name, EnumDeclaration (mkEnum a fields))

errorArgs :: P (String, [(Text, SVMType.Type)])
errorArgs = do
  reserved "error"
  name <- identifier
  args <- parens $
    commaSep $ do
      t <- simpleTypeExpression
      arg <- identifier
      pure (T.pack arg, t)
  pure (name, args)

mkError :: SourceAnnotation () -> [(Text, SVMType.Type)] -> SolidVM.Def
mkError a args =
  SolidVM.Error
    { SolidVM.params = zipWith (\(k, v) i -> (textToLabel k, SolidVM.IndexedType i v Nothing)) args [0 ..],
      SolidVM.bytes = 0,
      SolidVM.context = a
    }

errorDeclaration :: P (String, Declaration)
errorDeclaration = do
  ~(a, (name, args)) <- withPosition errorArgs
  semi
  pure (name, ErrorDeclaration (mkError a args))

-- | @using L for T;@ or @using L for *;@; @global@ only at file level.
usingDeclaration :: Bool -> P Xabi.Using
usingDeclaration free = do
  ~(a, (lib, typ, global)) <- withPosition $ do
    reserved "using"
    lib <- identifier
    reserved "for"
    typ <- (Nothing <$ sym "*") <|> (Just <$> simpleTypeExpression)
    global <- isJust <$> optionMaybe (reserved "global")
    when (global && not free) empty
    semi
    pure (lib, typ, global)
  pure (Xabi.Using lib typ global a)

------------------------------------------------------------------------------
-- State variables

data Keyword = KConstant | KPublic | KPrivate | KInternal | KImmutable | KRecord
  deriving (Eq)

-- | @T [keywords] name [= value];@
stateVariable :: P (String, Declaration)
stateVariable = do
  ~(a, (t, keywords, name, value)) <- withPosition $ do
    t <- simpleTypeExpression
    keywords <-
      many $
        (KConstant <$ reserved "constant")
          <|> (KImmutable <$ reserved "immutable")
          <|> (KPublic <$ reserved "public")
          <|> (KPrivate <$ reserved "private")
          <|> (KInternal <$ reserved "internal")
          <|> (KRecord <$ reserved "record")
    name <- identifier
    value <- optionMaybe (sym "=" *> expression)
    pure (t, keywords, name, value)
  semi
  visibility <- case nub (filter (`elem` [KPublic, KPrivate, KInternal]) keywords) of
    [] -> pure Nothing
    [KPublic] -> pure (Just SolidVM.Public)
    [KInternal] -> pure (Just SolidVM.Internal)
    [KPrivate] -> pure (Just SolidVM.Private)
    _ -> empty
  pure . (name,) $
    if KConstant `elem` keywords
      then ConstantDeclaration (SolidVM.ConstantDecl t visibility (fromMaybe (parseError "constants must be initialized" name) value) a)
      else VariableDeclaration (SolidVM.VariableDecl t visibility value a (KImmutable `elem` keywords))

------------------------------------------------------------------------------
-- Functions

-- | @function name@, @constructor@, @receive@ or @fallback@ with its
-- parameters, modifiers and body. In a contract, a function named like it is
-- its constructor.
functionDeclaration :: Bool -> P (String, Declaration)
functionDeclaration free = do
  ~(a, (name, func)) <- withPosition $ do
    name <-
      (reserved "function" *> option "fallback" identifier)
        <|> (reserved "constructor" *> (contractName <$> getSt))
        <|> ("receive" <$ reserved "receive")
        <|> ("fallback" <$ reserved "fallback")
    func <- functionBody free
    pure (name, func)
  contract <- contractName <$> getSt
  let kind = if not free && name == contract then ConstructorDeclaration else FuncDeclaration
  pure (name, kind func {SolidVM._funcContext = a <> SolidVM._funcContext func})

functionBody :: Bool -> P SolidVM.Func
functionBody free = do
  start <- getPos
  args <- map (\(name, (_, loc, t)) -> (name, (loc, t))) <$> parameters
  let variadic = (== SVMType.Variadic) . snd . snd
      lastIsVariadic = maybe False (variadic . fst) (uncons (reverse args))
      oneVariadic = length (filter variadic args) == 1
  when (lastIsVariadic /= oneVariadic) empty
  (returns, visibility, mutability, virtual, overrides, modifiers) <- functionModifiers
  end <- getPos
  contents <- (Just <$> statements) <|> (Nothing <$ semi)
  when (free && (virtual || isJust overrides)) empty
  let indexed xs = zipWith (\(name, (loc, t)) i -> (if T.null name then Nothing else Just (textToLabel name), SolidVM.IndexedType i t loc)) xs [0 ..]
  pure
    SolidVM.Func
      { SolidVM._funcArgs = indexed args,
        SolidVM._funcVals = indexed returns,
        SolidVM._funcContents = contents,
        SolidVM._funcVisibility = Just (fromMaybe (if free then SolidVM.Internal else SolidVM.Public) visibility),
        SolidVM._funcStateMutability = mutability,
        SolidVM._funcVirtual = virtual,
        SolidVM._funcOverrides = overrides,
        SolidVM._funcConstructorCalls = Map.fromList modifiers,
        SolidVM._funcModifiers = modifiers,
        SolidVM._funcContext = SourceAnnotation start end (),
        SolidVM._funcIsFree = free,
        SolidVM._funcOverload = []
      }

-- | @(T [indexed|storage|memory|calldata] [name], ...)@
parameters :: P [(Text, (Bool, Maybe Location, SVMType.Type))]
parameters = parens $
  commaSep $ do
    t <- simpleTypeExpression
    (indexed, loc) <-
      option (False, Nothing) $
        ((True, Nothing) <$ reserved "indexed")
          <|> ((False, Just Storage) <$ reserved "storage")
          <|> ((False, Just Memory) <$ reserved "memory")
          <|> ((False, Just Calldata) <$ reserved "calldata")
    name <- option "" identifier
    pure (T.pack name, (indexed, loc, t))

data Modifier
  = ReturnsMod [(Text, (Maybe Location, SVMType.Type))]
  | VisibilityMod SolidVM.Visibility
  | MutabilityMod SolidVM.StateMutability
  | VirtualMod
  | OverrideMod [SolidString]
  | CallMod (SolidString, [SolidVM.Expression])

-- | Everything between a function's parameters and its body, in any order.
functionModifiers ::
  P
    ( [(Text, (Maybe Location, SVMType.Type))],
      Maybe SolidVM.Visibility,
      Maybe SolidVM.StateMutability,
      Bool,
      Maybe [SolidString],
      [(SolidString, [SolidVM.Expression])]
    )
functionModifiers = do
  mods <-
    many $
      (ReturnsMod . map (\(name, (_, loc, t)) -> (name, (loc, t))) <$> (reserved "returns" *> parameters))
        <|> (VisibilityMod SolidVM.Public <$ reserved "public")
        <|> (VisibilityMod SolidVM.Private <$ reserved "private")
        <|> (VisibilityMod SolidVM.External <$ reserved "external")
        <|> (VisibilityMod SolidVM.Internal <$ reserved "internal")
        <|> (MutabilityMod SolidVM.Constant <$ reserved "constant")
        <|> (MutabilityMod SolidVM.Pure <$ reserved "pure")
        <|> (MutabilityMod SolidVM.View <$ reserved "view")
        <|> (MutabilityMod SolidVM.Payable <$ reserved "payable")
        <|> (VirtualMod <$ reserved "virtual")
        <|> (OverrideMod <$> (reserved "override" *> option [] (parens (commaSep identifier))))
        <|> (CallMod <$> ((,) <$> (stringToLabel <$> identifier) <*> option [] (parens (commaSep expression))))
  pure
    ( concat [v | ReturnsMod v <- mods],
      listToMaybe [v | VisibilityMod v <- mods],
      listToMaybe [v | MutabilityMod v <- mods],
      not (null [() | VirtualMod <- mods]),
      listToMaybe [v | OverrideMod v <- mods],
      [v | CallMod v <- mods]
    )

eventDeclaration :: P (String, Declaration)
eventDeclaration = do
  ~(a, (name, logs, anonymous)) <- withPosition $ do
    reserved "event"
    name <- identifier
    logs <- parameters
    anonymous <- option False (True <$ reserved "anonymous")
    pure (name, logs, anonymous)
  semi
  pure
    ( name,
      EventDeclaration
        SolidVM.Event
          { SolidVM._eventAnonymous = anonymous,
            SolidVM._eventLogs = zipWith (\i (n, (indexed, _, t)) -> SolidVM.EventLog n indexed (SolidVM.IndexedType i t Nothing)) [0 ..] logs,
            SolidVM._eventContext = a
          }
    )

modifierDeclaration :: P (String, Declaration)
modifierDeclaration = do
  ~(a, (name, args, contents)) <- withPosition $ do
    reserved "modifier"
    name <- identifier
    args <- option [] parameters
    contents <- (Just <$> statements) <|> (Nothing <$ semi)
    pure (name, args, contents)
  let named (n, (_, loc, t)) i = (if T.null n then T.pack ('#' : show i) else n, SolidVM.IndexedType i t loc)
  pure
    ( name,
      ModifierDeclaration
        Xabi.Modifier
          { Xabi._modifierArgs = zipWith named args [0 ..],
            Xabi._modifierSelector = T.pack name,
            Xabi._modifierContents = contents,
            Xabi._modifierContext = a
          }
    )
