-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}
module BlockApps.Solidity.Parse.UnParser where

import           Data.Text  (Text)
import qualified Data.Text                  as Text
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import Data.Monoid ((<>))

import           Debug.Trace

import           BlockApps.Solidity.Xabi
import BlockApps.Solidity.Xabi.Type
import qualified BlockApps.Solidity.Xabi.Def as Xabi



sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: [(Text, (Xabi, [Text]))] -> String
unparse contracts = List.concat $ List.map (traceShowId . unparseContract) contracts

unparseContract :: (Text, (Xabi, [Text])) -> String
unparseContract (name, (contract,inherited)) =
     "contract "
  <> Text.unpack name
  <> (case inherited of
        [] -> ""
        xs -> " is " <> Text.unpack (Text.intercalate ", " xs)
     )
  <> " {\n"
  <> List.concat (List.map (("\n    " <>) . unparseVar) (sortWith (varTypeAtBytes . snd) $ Map.toList $ xabiVars contract))
  <> List.concat (List.map (("\n    " <>) . unparseTypes) (Map.toList $ xabiTypes contract))
  <> List.concat (List.map (("\n    " <>) . unparseModifier) (Map.toList $ xabiModifiers contract))
  <> List.concat (List.map (("\n    " <>) . unparseFunc) (Map.toList $ xabiConstr contract))
  <> List.concat (List.map (("\n    " <>) . unparseFunc) (Map.toList $ xabiFuncs contract))
  <> "\n}"

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
    <> Text.intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ Map.toList funcArgs))
    <> ") "
    <> case funcMutable of
        Just False -> "constant "
        _ -> ""
    <> case funcPayable of
        Just True -> "payable "
        _ -> ""
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
    <> "\n    }"

unparseModifier :: (Text, Modifier) -> String
unparseModifier (name, Modifier{..}) = Text.unpack $
     "modifier "
  <> name
  <> "("
  <> Text.intercalate ", " (List.map unparseArgs (Map.toList modifierArgs))
  <> ") {\n        "
  <> case modifierContents of
       Just contents -> contents --(Text.concat . Text.lines $ contents)
       Nothing -> ""
  <> "\n    }"

unparseTypes :: (Text, Xabi.Def) -> String
unparseTypes (name, Xabi.Enum {names=names'}) =
  Text.unpack $ "enum "
             <> name
             <> " {\n      "
             <> Text.intercalate ",\n      " names'
             <> "\n    }"
unparseTypes (name, Xabi.Struct {fields=fields'}) =
  Text.unpack $ "struct "
             <> name
             <> " {\n      "
             <> Text.intercalate "\n      " (map unparseField $ Map.toList fields')
             <> "\n    }"
  where unparseField (fieldName, fieldType) = (Text.pack . unparseVarType $ fieldTypeType fieldType)
                                           <> " "
                                           <> fieldName
                                           <> ";"
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
unparseIndexedType IndexedType{indexedTypeType = Int (Just True) (Just n)} = Text.pack $ "int" <> show (8*n)
unparseIndexedType IndexedType{indexedTypeType = Int (Just True) Nothing} = "int"
unparseIndexedType IndexedType{indexedTypeType = Int (Just False) (Just n)} = Text.pack $ "uint" <> show (8*n)
unparseIndexedType IndexedType{indexedTypeType = Int (Just False) Nothing} = "uint"
unparseIndexedType IndexedType{indexedTypeType = Int Nothing (Just n)} = Text.pack $ "uint" <> show (8*n)
unparseIndexedType IndexedType{indexedTypeType = Int Nothing Nothing} = "uint"
unparseIndexedType IndexedType{indexedTypeType = Bool} = "bool"
unparseIndexedType IndexedType{indexedTypeType = String _} = "string"
unparseIndexedType IndexedType{indexedTypeType = Address} = "address"
unparseIndexedType IndexedType{indexedTypeType = Bytes (Just True) _ } = "bytes"
unparseIndexedType IndexedType{indexedTypeType = Bytes Nothing (Just bytes) } =
  "bytes" <> (Text.pack . show $ bytes)
unparseIndexedType IndexedType{indexedTypeType = Label str} = Text.pack str
unparseIndexedType IndexedType{indexedTypeType = Enum _ name _} = name
unparseIndexedType IndexedType{indexedTypeType = Array (Just True) _ t} = (unparseIndexedType (IndexedType undefined t))
                                                                       <> "[]"
unparseIndexedType IndexedType{indexedTypeType = Array (Just False) (Just n) t} = (unparseIndexedType (IndexedType undefined t))
                                                                               <> Text.pack ("[" <> show n <> "]")
unparseIndexedType IndexedType{indexedTypeType = Array Nothing _ t} = (unparseIndexedType (IndexedType undefined t))
                                                                   <> "[]"
unparseIndexedType IndexedType{indexedTypeType = Contract contractName} = contractName
unparseIndexedType _ = "TYPE_NOT_IMPLEMENED"

addFunction :: (Text, String) -> Xabi -> Xabi
addFunction (name, contents) c =
  let func = Func { funcArgs = Map.empty
                  , funcVals = Map.singleton "#0" IndexedType{ indexedTypeType=String (Just True)
                                                             , indexedTypeIndex=0
                                                             }
                  , funcContents = Just $ Text.pack contents
                  , funcMutable = Just False
                  , funcPayable = Just False
                  , funcVisibility = Nothing
                  , funcModifiers = Nothing
                  }
  in c{xabiFuncs=Map.insert name (func) $ xabiFuncs c}
