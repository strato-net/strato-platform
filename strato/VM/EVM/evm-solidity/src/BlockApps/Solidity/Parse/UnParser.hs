{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
module BlockApps.Solidity.Parse.UnParser where

import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Def as Xabi
import BlockApps.Solidity.Xabi.Type
import qualified Data.List as List
import Data.Map ()
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as Text

sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: File -> String
unparse (File units) = List.concat $ List.map unparseSourceUnit units

unparseSourceUnit :: SourceUnit -> String
unparseSourceUnit (Pragma ident contents) = "pragma " ++ ident ++ " " ++ contents ++ ";\n"
unparseSourceUnit (Import path) = "import \"" ++ Text.unpack path ++ "\";\n"
unparseSourceUnit (NamedXabi name (contract, inherited)) =
  ( case xabiKind contract of
      ContractKind -> "contract "
      InterfaceKind -> "interface "
      AbstractKind -> "abstract contract "
      LibraryKind -> "library "
  )
    <> Text.unpack name
    <> ( case inherited of
           [] -> ""
           xs -> " is " <> Text.unpack (Text.intercalate ", " xs)
       )
    <> " {\n"
    <> concatMap (("\n    " <>) . unparseVar) (sortWith (varTypeAtBytes . snd) $ Map.toList $ xabiVars contract)
    <> concatMap (("\n    " <>) . unparseTypes) (Map.toList $ xabiTypes contract)
    <> concatMap (("\n    " <>) . unparseModifier) (Map.toList $ xabiModifiers contract)
    <> concatMap (("\n    " <>) . unparseEvent) (Map.toList $ xabiEvents contract)
    <> concatMap (("\n    " <>) . unparseUsing) (Map.toList $ xabiUsing contract)
    <> concatMap (("\n    " <>) . unparseCtor) (xabiConstr contract)
    <> concatMap (("\n    " <>) . unparseFunc) (Map.toList $ xabiFuncs contract)
    <> "\n}"

unparseVar :: (Text, VarType) -> String
unparseVar (name, theType) =
  unparseVarType (varTypeType theType)
    <> " "
    <> ( case varTypePublic theType of
           Nothing -> ""
           Just True -> "public "
           Just False -> "private "
       )
    <> ( case varTypeConstant theType of
           Just True -> "constant "
           _ -> ""
       )
    <> Text.unpack name
    <> ( case varTypeInitialValue theType of
           Nothing -> ""
           Just value -> " = " ++ value
       )
    <> ";"

unparseVarType :: Type -> String
unparseVarType (Int (Just True) (Just n)) = "int" <> show (8 * n)
unparseVarType (Int (Just True) Nothing) = "int"
unparseVarType (Int (Just False) (Just n)) = "uint" <> show (8 * n)
unparseVarType (Int (Just False) Nothing) = "uint"
unparseVarType (Int Nothing (Just n)) = "uint" <> show (8 * n)
unparseVarType (Int Nothing Nothing) = "uint"
unparseVarType (Bool) = "bool"
unparseVarType (String _) = "string"
unparseVarType (Address) = "address"
unparseVarType (Account) = "account"
unparseVarType (Bytes (Just True) _) = "bytes"
unparseVarType (Bytes Nothing (Just bytes)) = "bytes" <> (show bytes)
unparseVarType (UnknownLabel str) = str
unparseVarType (Enum _ name _) = Text.unpack name
unparseVarType (Array t (Just n)) = (unparseVarType t) <> "[" <> show n <> "]"
unparseVarType (Array t Nothing) = (unparseVarType t) <> "[]"
unparseVarType (Mapping _ key val) = "mapping (" <> (unparseVarType key) <> " => " <> (unparseVarType val) <> ")"
unparseVarType (Contract contractName) = Text.unpack contractName
unparseVarType _ = "TYPE_NOT_IMPLEMENED"

unparseFunc :: (Text, Func) -> String
unparseFunc (name, f) = Text.unpack $ "function " <> name <> unparseFuncWithoutName f

unparseCtor :: Func -> String
unparseCtor f = Text.unpack $ "constructor" <> unparseFuncWithoutName f

unparseFuncWithoutName :: Func -> Text
unparseFuncWithoutName Func {..} =
  "("
    <> Text.intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ Map.toList funcArgs))
    <> ") "
    <> case funcStateMutability of
      Just sm -> tShow sm <> " "
      Nothing -> ""
    <> case funcVisibility of
      Just Private -> "private "
      Just Public -> "public "
      Just Internal -> "internal "
      Just External -> "external "
      _ -> ""
    <> case funcModifiers of
      Just [] -> ""
      Just xs -> Text.pack $ List.intercalate " " xs <> " "
      _ -> ""
    <> case Map.toList funcVals of
      [] -> ""
      vals ->
        "returns ("
          <> Text.intercalate ", " (List.map unparseVals vals)
          <> ") "
    <> "{\n        "
    <> case funcContents of
      Just contents -> contents --(Text.concat . Text.lines $ contents)
      Nothing -> ""
    <> "}"

unparseModifier :: (Text, Modifier) -> String
unparseModifier (name, Modifier {..}) =
  Text.unpack $
    "modifier "
      <> name
      <> "("
      <> Text.intercalate ", " (List.map unparseArgs (Map.toList modifierArgs))
      <> ") {\n        "
      <> case modifierContents of
        Just contents -> contents --(Text.concat . Text.lines $ contents)
        Nothing -> ""
      <> "}"

unparseEvent :: (Text, Event) -> String
unparseEvent (name, Event {..}) =
  Text.unpack $
    "event "
      <> name
      <> "(\n    "
      <> Text.intercalate ",\n    " (List.map unparseArgs eventLogs)
      <> ")"
      <> (if eventAnonymous then "anonymous" else "")
      <> ";"

unparseUsing :: (Text, Using) -> String
unparseUsing (name, Using body) = Text.unpack . mconcat $ ["using ", name, " ", Text.pack body, ";\n"]

unparseTypes :: (Text, Xabi.Def) -> String
unparseTypes (name, Xabi.Enum {names = names'}) =
  Text.unpack $
    "enum "
      <> name
      <> " {\n      "
      <> Text.intercalate ",\n      " names'
      <> "\n    }"
unparseTypes (name, Xabi.Struct {fields = fields'}) =
  Text.unpack $
    "struct "
      <> name
      <> " {\n      "
      <> ( Text.intercalate "\n      "
             . map unparseField
             . List.sortOn (\(_, FieldType i _) -> i)
             $ fields'
         )
      <> "\n    }"
  where
    unparseField (fieldName, fieldType) =
      (Text.pack . unparseVarType $ fieldTypeType fieldType)
        <> " "
        <> fieldName
        <> ";"
unparseTypes (_name, _def) = ""

unparseArgs :: (Text, IndexedType) -> Text
unparseArgs (name, theType) = unparseIndexedType theType <> " " <> name

unparseVals :: (Text, IndexedType) -> Text
unparseVals (name, theType) =
  unparseIndexedType theType
    <> if Text.head name == '#'
      then ""
      else " " <> name

unparseIndexedType :: IndexedType -> Text
unparseIndexedType = Text.pack . unparseVarType . indexedTypeType
