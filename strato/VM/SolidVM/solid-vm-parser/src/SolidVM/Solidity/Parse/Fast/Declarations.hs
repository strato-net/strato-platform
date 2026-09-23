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

import Control.Monad (foldM, when)
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
import SolidVM.Solidity.Parse.Fast.Lexer (Kind (..), Token (..))
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Fast.Statement
import SolidVM.Solidity.Parse.Fast.Types
import qualified SolidVM.Solidity.Xabi as Xabi

------------------------------------------------------------------------------
-- Contracts

solidityContract :: P SourceUnit
solidityContract = do
  (a, (kind, name, parents)) <- withPosition $ do
    t <- peek
    kind <- case tText t of
      "interface" -> SolidVM.InterfaceType <$ skip
      "abstract" -> SolidVM.AbstractType <$ (skip *> reserved "contract")
      "library" -> SolidVM.LibraryType <$ skip
      _ -> SolidVM.ContractType <$ reserved "contract"
    _ <- optionalWord "record"
    name <- identifier
    modifySt (\s -> s {contractName = name})
    -- constructor arguments given to a parent here are not kept
    parents <- fromMaybe [] <$> afterWord "is" (commaSep1 (dotted <* optionalIf (isSym "(") (parens (commaSep expression))))
    pure (kind, name, parents)
  declarations <- sym "{" *> manyTillSym (declaration False) "}"
  constructor <- case [c | (_, ConstructorDeclaration c) <- declarations] of
    [] -> pure Nothing
    [c] -> pure (Just c)
    _ -> failWith "more than one constructor"
  functions <- foldM overload Map.empty [(stringToLabel n, f) | (n, FuncDeclaration f) <- declarations]
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
        SolidVM._functions = functions,
        SolidVM._modifiers = Map.fromList [(stringToLabel n, m) | (n, ModifierDeclaration m) <- declarations],
        SolidVM._usings = [u | (_, UsingDeclaration u) <- declarations],
        SolidVM._constructor = constructor,
        SolidVM._contractType = kind,
        SolidVM._importedFrom = Nothing,
        SolidVM._contractContext = a
      }
  where
    dotted = T.unpack . T.intercalate "." . map T.pack <$> sepBy1Sym identifier "."
    -- a function may be redefined only with different parameter types
    overload fs (name, new) = case Map.lookup name fs of
      Nothing -> pure (Map.insert name new fs)
      Just old
        | params new `elem` map params (old : SolidVM._funcOverload old) ->
            failWith ("function " ++ labelToString name ++ " is already defined with these parameter types")
        | otherwise -> pure (Map.insert name old {SolidVM._funcOverload = SolidVM._funcOverload old ++ [new]} fs)
    params f = map snd (SolidVM._funcArgs f)

-- | Anything a contract declares; @free@ for a declaration at file level.
declaration :: Bool -> P (String, Declaration)
declaration free = declaration' free <?> "declaration"

declaration' :: Bool -> P (String, Declaration)
declaration' free = do
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
  sym "{"
  fields <- (:) <$> field <*> manyTillSym field "}"
  pure (name, fields)
  where
    field = do
      t <- simpleTypeExpression
      name <- identifier
      semi
      pure (name, t)

mkStruct :: SourceAnnotation () -> [(String, SVMType.Type)] -> SolidVM.Def
mkStruct a fields =
  SolidVM.Struct
    { SolidVM.fields = zipWith (\(n, v) i -> (stringToLabel n, SolidVM.FieldType i v)) fields [0 ..],
      SolidVM.bytes = 0,
      SolidVM.context = a
    }

structDeclaration :: P (String, Declaration)
structDeclaration = do
  (a, (name, fields)) <- withPosition structFields
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
  (a, (name, fields)) <- withPosition enumFields
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
  (a, (name, args)) <- withPosition errorArgs
  semi
  pure (name, ErrorDeclaration (mkError a args))

-- | @using L for T;@ or @using L for *;@; @global@ only at file level.
usingDeclaration :: Bool -> P Xabi.Using
usingDeclaration free = do
  (a, (lib, typ, global)) <- withPosition $ do
    reserved "using"
    lib <- identifier
    reserved "for"
    t <- peek
    typ <- if isSym "*" t then Nothing <$ skip else Just <$> simpleTypeExpression
    global <- optionalWord "global"
    when (global && not free) $ failWith "using ... global is only allowed at file level"
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
  (a, (t, keywords, name, value)) <- withPosition $ do
    t <- simpleTypeExpression
    keywords <- manyNext keyword
    name <- identifier
    value <- afterSym "=" expression
    pure (t, keywords, name, value)
  semi
  visibility <- case nub (filter (`elem` [KPublic, KPrivate, KInternal]) keywords) of
    [] -> pure Nothing
    [KPublic] -> pure (Just SolidVM.Public)
    [KInternal] -> pure (Just SolidVM.Internal)
    [KPrivate] -> pure (Just SolidVM.Private)
    _ -> failWith ("more than one visibility for " ++ name)
  if KConstant `elem` keywords
    then case value of
      Just v -> pure (name, ConstantDeclaration (SolidVM.ConstantDecl t visibility v a))
      Nothing -> failWith ("constant " ++ name ++ " must be initialized")
    else pure (name, VariableDeclaration (SolidVM.VariableDecl t visibility value a (KImmutable `elem` keywords)))
  where
    keyword t = case tText t of
      "constant" | tKind t == TWord -> Just KConstant
      "immutable" | tKind t == TWord -> Just KImmutable
      "public" | tKind t == TWord -> Just KPublic
      "private" | tKind t == TWord -> Just KPrivate
      "internal" | tKind t == TWord -> Just KInternal
      "record" | tKind t == TWord -> Just KRecord
      _ -> Nothing

------------------------------------------------------------------------------
-- Functions

-- | @function name@, @constructor@, @receive@ or @fallback@ with its
-- parameters, modifiers and body. In a contract, a function named like it is
-- its constructor.
functionDeclaration :: Bool -> P (String, Declaration)
functionDeclaration free = do
  (a, (name, func)) <- withPosition $ do
    t <- peek
    name <- case tText t of
      "constructor" -> skip *> (contractName <$> getSt)
      "receive" -> "receive" <$ skip
      "fallback" -> "fallback" <$ skip
      _ -> reserved "function" *> (fromMaybe "fallback" <$> optionalIdentifier)
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
  case (lastIsVariadic, oneVariadic) of
    (True, False) -> failWith "only one variadic parameter is allowed"
    (False, True) -> failWith "the variadic parameter must be the last one"
    _ -> pure ()
  (returns, visibility, mutability, virtual, overrides, modifiers) <- functionModifiers
  end <- getPos
  contents <- blockOrSemi
  when (free && (virtual || isJust overrides)) $ failWith "free functions cannot be virtual or override"
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
    (indexed, loc) <- fromMaybe (False, Nothing) <$> optionalNext (\k -> case tText k of
      "indexed" | tKind k == TWord -> Just (True, Nothing)
      "storage" | tKind k == TWord -> Just (False, Just Storage)
      "memory" | tKind k == TWord -> Just (False, Just Memory)
      "calldata" | tKind k == TWord -> Just (False, Just Calldata)
      _ -> Nothing)
    name <- fromMaybe "" <$> optionalIdentifier
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
  mods <- manyWhile (\t -> tKind t == TWord) $ do
    t <- peek
    case tText t of
      "returns" -> ReturnsMod . map (\(name, (_, loc, t')) -> (name, (loc, t'))) <$> (reserved "returns" *> parameters)
      "public" -> VisibilityMod SolidVM.Public <$ reserved "public"
      "private" -> VisibilityMod SolidVM.Private <$ reserved "private"
      "external" -> VisibilityMod SolidVM.External <$ reserved "external"
      "internal" -> VisibilityMod SolidVM.Internal <$ reserved "internal"
      "constant" -> MutabilityMod SolidVM.Constant <$ reserved "constant"
      "pure" -> MutabilityMod SolidVM.Pure <$ reserved "pure"
      "view" -> MutabilityMod SolidVM.View <$ reserved "view"
      "payable" -> MutabilityMod SolidVM.Payable <$ reserved "payable"
      "virtual" -> VirtualMod <$ reserved "virtual"
      "override" -> OverrideMod . fromMaybe [] <$> (reserved "override" *> optionalIf (isSym "(") (parens (commaSep identifier)))
      _ -> CallMod <$> ((,) <$> (stringToLabel <$> identifier) <*> (fromMaybe [] <$> optionalIf (isSym "(") (parens (commaSep expression))))
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
  (a, (name, logs, anonymous)) <- withPosition $ do
    reserved "event"
    name <- identifier
    logs <- parameters
    anonymous <- optionalWord "anonymous"
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
  (a, (name, args, contents)) <- withPosition $ do
    reserved "modifier"
    name <- identifier
    args <- fromMaybe [] <$> optionalIf (isSym "(") parameters
    contents <- blockOrSemi
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
