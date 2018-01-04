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



sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: [(Text, (Xabi, [Text]))] -> String
unparse contracts = List.concat $ List.map unparseContract contracts

unparseContract :: (Text, (Xabi, [Text])) -> String
unparseContract (name, (contract,inherited)) =
     "contract "
  <> Text.unpack name
  <> (case inherited of
        [] -> ""
        xs -> " is " <> Text.unpack (intercalate ", " xs)
     )
  <> "{"
  <> List.concat (List.map ((" " <>) . unparseVar) (sortWith (varTypeAtBytes . snd) $ Map.toList $ xabiVars contract))
  <> List.concat (List.map ((" " <>) . unparseTypes) (Map.toList $ xabiTypes contract))
  <> List.concat (List.map ((" " <>) . unparseModifier) (Map.toList $ xabiModifiers contract))
  <> List.concat (List.map ((" " <>) . unparseFunc) (Map.toList $ xabiConstr contract))
  <> List.concat (List.map ((" " <>) . unparseFunc) (Map.toList $ xabiFuncs contract))
  <> "}"

unparseVar :: (Text, VarType) -> String
unparseVar (name, theType) =
     unparseVarType (varTypeType theType)
  <> " "
  <> (case varTypePublic theType of
        Nothing -> ""
        Just True -> "public "
        Just False -> "private "
     )
  <> Text.unpack name
  <> ";"

unparseVarType :: Type -> String
unparseVarType (Int (Just True) _) = "int"
unparseVarType (Int (Just False) _) = "uint"
unparseVarType (Int Nothing _) = "uint"
unparseVarType (String _) = "string"
unparseVarType Bool    = "bool"
unparseVarType Address = "address"
unparseVarType (Label str) = str
unparseVarType (Bytes _ (Just n)) = "bytes" <> (show n)
unparseVarType (Bytes _ Nothing)  = "bytes"
unparseVarType (Array _ (Just len) entry) = (unparseVarType entry) <> "[" <> (show len) <> "]"
unparseVarType (Array _ Nothing    entry) = (unparseVarType entry) <> "[]"
unparseVarType (Mapping _ key val) = "mapping (" <> (unparseVarType key) <> " => " <> (unparseVarType val) <> ")"
unparseVarType _ = "int"

unparseFunc :: (Text, Func) -> String
unparseFunc (name, Func{..}) =
  Text.unpack $
    "function "
    <> name
    <> "("
    <> intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ Map.toList funcArgs))
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
unparseIndexedType IndexedType{indexedTypeType = Int Nothing _} = "uint"
unparseIndexedType IndexedType{indexedTypeType = Bool} = "bool"
unparseIndexedType IndexedType{indexedTypeType = String _} = "string"
unparseIndexedType IndexedType{indexedTypeType = Address} = "address"
unparseIndexedType IndexedType{indexedTypeType = Bytes (Just True) _ } = "bytes"
unparseIndexedType IndexedType{indexedTypeType = Bytes Nothing (Just bytes) } =
  "bytes" <> (pack . show $ bytes)
unparseIndexedType IndexedType{indexedTypeType = Label str} = pack str
unparseIndexedType IndexedType{indexedTypeType = Enum _ name _} = name
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
