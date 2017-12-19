-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}
module BlockApps.Solidity.Parse.UnParser where

import           Data.Text
import qualified Data.Text                  as Text
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import Data.Monoid ((<>))

import           BlockApps.Solidity.Xabi
import BlockApps.Solidity.Xabi.Type
import qualified BlockApps.Solidity.Xabi.Def as Xabi



unparse :: [(Text, Xabi)] -> String
unparse contracts = List.concat $ List.map unparseContract contracts

unparseContract :: (Text, Xabi) -> String
unparseContract (name, contract) =
     "contract "
  <> Text.unpack name
  <> "{"
  <> List.concat (List.map ((" " <>) . unparseVar) (Map.toList $ xabiVars contract))
  <> List.concat (List.map ((" " <>) . unparseTypes) (Map.toList $ xabiTypes contract))
  <> List.concat (List.map ((" " <>) . unparseModifier) (Map.toList $ xabiModifiers contract))
  <> List.concat (List.map ((" " <>) . unparseFunc) (Map.toList $ xabiConstr contract))
  <> List.concat (List.map ((" " <>) . unparseFunc) (Map.toList $ xabiFuncs contract))
  <> "}"

unparseVar :: (Text, VarType) -> String
unparseVar (name, theType) =
     unparseVarType theType
  <> " "
  <> Text.unpack name
  <> ";"

unparseVarType :: VarType -> String
unparseVarType VarType{varTypeType = Int (Just True) _} = "int"
unparseVarType VarType{varTypeType = Int (Just False) _} = "uint"
unparseVarType VarType{varTypeType = String _} = "string"
unparseVarType VarType{varTypeType = Address} = "address"
unparseVarType _ = "int"

unparseFunc :: (Text, Func) -> String
unparseFunc (name, Func{..}) = Text.unpack $
     "function "
  <> name
  <> "("
  <> intercalate ", " (List.map unparseArgs (Map.toList funcArgs))
  <> ") "
  <> case funcMutable of
       Just False -> "constant "
       _ -> ""
  <> case Map.toList funcVals of
       [] -> ""
       vals ->
            "returns ("
         <> intercalate ", " (List.map unparseVals vals)
         <> ") "
  <> "{ "
  <> case funcContents of
       Just contents -> (Text.concat . Text.lines $ contents)
       Nothing -> ""
  <> "}"

unparseModifier :: (Text, Modifier) -> String
unparseModifier (name, Modifier{..}) = Text.unpack $
     "modifier "
  <> name
  <> "("
  <> intercalate ", " (List.map unparseArgs (Map.toList modifierArgs))
  <> ") {"
  <> case modifierContents of
       Just contents -> (Text.concat . Text.lines $ contents)
       Nothing -> ""
  <> "}"

unparseTypes :: (Text, Xabi.Def) -> String
unparseTypes (name, Xabi.Enum {names=names'}) = 
  Text.unpack $ "enum " <> name <>  " {" <> Text.intercalate ", " names' <> " }"
unparseTypes (_name, _def) = ""

unparseArgs :: (Text, IndexedType) -> Text
unparseArgs (name, theType) = unparseIndexedType theType <> " " <>  name

unparseVals :: (Text, IndexedType) -> Text
unparseVals (name, theType) =
     unparseIndexedType theType
  <> if Text.head name == '#'
     then ""
     else " " <> name

unparseIndexedType :: IndexedType -> Text
-- unparseIndexedType IndexedType{indexedTypeType = Int True size} = "int" <> show size
unparseIndexedType IndexedType{indexedTypeType = Int (Just True) _} = "int"
unparseIndexedType IndexedType{indexedTypeType = Int (Just False) _} = "uint"
unparseIndexedType IndexedType{indexedTypeType = String _} = "string"
unparseIndexedType IndexedType{indexedTypeType = Address} = "address"
unparseIndexedType IndexedType{indexedTypeType = Bytes (Just True) _ } = "bytes"
unparseIndexedType IndexedType{indexedTypeType = Bytes Nothing (Just bytes) } =
  "bytes" <> (pack . show $ bytes)
unparseIndexedType _ = "TYPE_NOT_IMPLEMENED"

addFunction :: (Text, String) -> Xabi -> Xabi
addFunction (name, contents) c =
  let func = Func { funcArgs = Map.empty
                  , funcVals = Map.singleton "#0" IndexedType{ indexedTypeType=String (Just True)
                                                             , indexedTypeIndex=0
                                                             }
                  , funcContents = Just $ pack contents
                  , funcMutable = Just False
                  , funcPayable = Just False
                  , funcVisibility = Nothing
                  , funcModifiers = Nothing
                  }
  in c{xabiFuncs=Map.insert name (func) $ xabiFuncs c}
