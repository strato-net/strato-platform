-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}
module BlockApps.Solidity.Parse.UnParser where

import           Data.Maybe
import           Data.Text  (Text)
import qualified Data.Text                  as Text
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import Data.Monoid ((<>))

import           BlockApps.Solidity.Parse.Declarations
import           BlockApps.Solidity.Parse.File
import           BlockApps.Solidity.Xabi.Statement
import           BlockApps.Solidity.Xabi
import           BlockApps.Solidity.Xabi.Type
import           BlockApps.Solidity.Xabi.VarDef
import qualified BlockApps.Solidity.Xabi.Def as Xabi



sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: File -> String
unparse (File units) = List.concat $ List.map unparseSourceUnit units

unparseSourceUnit :: SourceUnit -> String
unparseSourceUnit (Pragma ident contents) = "pragma " ++ ident ++ " " ++ contents ++ ";\n"
unparseSourceUnit (NamedXabi name (contract,inherited)) =
     (case xabiKind contract of
        ContractKind -> "contract "
        InterfaceKind -> "interface "
        LibraryKind -> "library ")
  <> Text.unpack name
  <> (case inherited of
        [] -> ""
        xs -> " is " <> Text.unpack (Text.intercalate ", " xs)
     )
  <> " {\n"
  <> concatMap (("\n    " <>) . unparseVar) (Map.toList $ xabiVars contract)
--  <> concatMap (("\n    " <>) . unparseVar) (sortWith (varTypeAtBytes . snd) $ Map.toList $ xabiVars contract)
  <> concatMap (("\n    " <>) . unparseTypes) (Map.toList $ xabiTypes contract)
  <> concatMap (("\n    " <>) . unparseModifier) (Map.toList $ xabiModifiers contract)
  <> concatMap (("\n    " <>) . unparseEvent) (Map.toList $ xabiEvents contract)
  <> concatMap (("\n    " <>) . unparseUsing) (Map.toList $ xabiUsing contract)
  <> concatMap (("\n    " <>) . unparseCtor) (Map.elems $ xabiConstr contract)
  <> concatMap (("\n    " <>) . unparseFunc) (Map.toList $ xabiFuncs contract)
  <> "\n}"

unparseVar :: (Text, VariableDecl) -> String
unparseVar (name, (VariableDecl theType isPublic maybeExpression)) =
     unparseVarType (theType)
  <> " "
  <> (if isPublic --TODO- I need to expand this to public, private or nothing
       then "public "
       else ""
     )
  <> Text.unpack name
  <> (case maybeExpression of
        Nothing -> ""
        Just value -> " = " ++ unparseExpression value
     )
  <> ";"

unparseConstant :: (Text, ConstantDecl) -> String
unparseConstant (name, (ConstantDecl theType isPublic expression)) =
     unparseVarType (theType)
  <> " "
  <> (if isPublic --TODO- I need to expand this to public, private or nothing
       then "public "
       else ""
     )
{-  <> (case varTypePublic theType of
        Nothing -> ""
        Just True -> "public "
        Just False -> "private "
     ) -}
  <>  "constant "
  <> Text.unpack name
  <> (" = " ++ unparseExpression expression)
  <> ";"

unparseVarType :: Type -> String
unparseVarType (Int (Just True) (Just n)) = "int" <> show (8*n)
unparseVarType (Int (Just True) Nothing) = "int"
unparseVarType (Int (Just False) (Just n)) = "uint" <> show (8*n)
unparseVarType (Int (Just False) Nothing) = "uint"
unparseVarType (Int Nothing (Just n)) = "uint" <> show (8*n)
unparseVarType (Int Nothing Nothing) = "uint"
unparseVarType (Bool) = "bool"
unparseVarType (String _) = "string"
unparseVarType (Address) = "address"
unparseVarType (Bytes (Just True) _ ) = "bytes"
unparseVarType (Bytes Nothing (Just bytes) ) = "bytes" <> (show bytes)
unparseVarType (Label str) = str
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
unparseFuncWithoutName Func{..} =
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
        Just contents -> Text.pack $ tab . tab $ unlines $ map unparseStatement contents --(Text.concat . Text.lines $ contents)
        Nothing -> ""
    <> "}"

tab :: String -> String
tab [] = []
tab ('\n':rest) = "\n    " ++ tab rest
tab (x:rest) = x:tab rest

unparseStatement :: Statement -> String
unparseStatement (SimpleStatement s) = unparseSimpleStatement s ++ ";"
unparseStatement (IfStatement e s1 s2) =
  let
    elseString Nothing = ""
    elseString (Just elseStatements) =
      " else {" ++ unlines (map unparseStatement elseStatements) ++ "}"
  in
    "if (" ++ unparseExpression e ++ ") {\n    " ++ tab (unlines (map unparseStatement s1)) ++ "}" ++ elseString s2
unparseStatement (ForStatement v1 v2 v3 s) =
  "for (" ++ fromMaybe "" (fmap unparseSimpleStatement v1) ++ "; " ++ fromMaybe "" (fmap unparseExpression v2) ++ "; " ++ fromMaybe "" (fmap unparseExpression v3) ++ ") {\n    " ++ tab (unlines (map unparseStatement s)) ++ "}"
unparseStatement (Return Nothing) = "return;"
unparseStatement (Return (Just e)) = "return " ++ unparseExpression e ++ ";"
unparseStatement Break = "break;"
unparseStatement Continue = "continue;"
--unparseStatement x = show x
unparseStatement x = error $ "missing case in call to unparseStatement: " ++ show x

unparseSimpleStatement :: SimpleStatement -> String
unparseSimpleStatement (VariableDefinition maybeType names maybeVal) =
  let typeString =
        case maybeType of
          Nothing -> "var"
          Just theType -> unparseVarType theType
      nameString =
        case names of
          [Just n] -> n
          _ -> "(" ++ List.intercalate ", " (map (fromMaybe "") names) ++ ")"
      assignmentString =
        case maybeVal of
          Nothing -> ""
          Just e -> " = " ++ unparseExpression e
  in
    typeString ++ " " ++ nameString ++ assignmentString
unparseSimpleStatement (ExpressionStatement e) = unparseExpression e

-- TODO- deal with parenthesis properly....  this is a bit difficult to do
unparseExpression :: Expression -> String
unparseExpression (PlusPlus v) = unparseExpression v ++ "++"
unparseExpression (Unitary op v) = op ++ unparseExpression v
unparseExpression (Binary op v1 v2) =
  unparseExpression v1 ++ " " ++ op ++ " " ++ unparseExpression v2
unparseExpression (Variable name) = name
unparseExpression (MemberAccess e name) = unparseExpression e ++ "." ++ name
unparseExpression (NumberLiteral x Nothing) = show x
unparseExpression (BoolLiteral False) = "false"
unparseExpression (BoolLiteral True) = "true"
unparseExpression (StringLiteral s) = show s
unparseExpression (TupleExpression vals) = "(" ++ List.intercalate ", " (map unparseExpression vals) ++ ")"
unparseExpression (IndexAccess e maybeVal) = unparseExpression e ++ "[" ++ fromMaybe "" (fmap unparseExpression maybeVal) ++ "]"
unparseExpression (FunctionCall e args) =
  let
    showArg (Nothing, x) = unparseExpression x
    showArg (Just name, x) = name ++ ": " ++ unparseExpression x
  in
    unparseExpression e ++ "(" ++ List.intercalate "," (map showArg args) ++ ")"
unparseExpression (Ternary x y z) = unparseExpression x ++ "?" ++ unparseExpression y ++ ":" ++ unparseExpression z
unparseExpression (NewExpression x) = "new " ++ unparseVarType x
unparseExpression x = error $ "missing case in call to unparseExpression: " ++ show x

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
  <> "}"

unparseEvent :: (Text, Event) -> String
unparseEvent (name, Event{..}) = Text.unpack $
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
             <> (Text.intercalate "\n      "
                . map unparseField
                . List.sortOn (\(_, FieldType i _) -> i)
                $ fields'
                )
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
unparseIndexedType = Text.pack . unparseVarType . indexedTypeType
