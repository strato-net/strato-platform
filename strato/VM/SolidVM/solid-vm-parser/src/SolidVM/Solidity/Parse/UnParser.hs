-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Parse.UnParser where

import           Data.Maybe
import           Data.Text  (Text)
import qualified Data.Text                  as Text
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import           Text.Printf

import           SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Def as SolidVM
import           SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Xabi

import           Blockchain.VM.SolidException


sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: File -> String
unparse (File units) = List.concat $ List.map unparseSourceUnit units

unparseSourceUnit :: SourceUnit -> String
unparseSourceUnit (Pragma _ ident contents) = "pragma " ++ ident ++ " " ++ contents ++ ";\n"
unparseSourceUnit (Import _ path) = "import \"" ++ Text.unpack path ++ "\";\n"
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
unparseVar (name, (VariableDecl theType isPublic maybeExpression _)) =
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
unparseConstant (name, (ConstantDecl theType isPublic expression _)) =
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
unparseVarType (SVMType.Int (Just True) (Just n)) = "int" <> show (8*n)
unparseVarType (SVMType.Int (Just True) Nothing) = "int"
unparseVarType (SVMType.Int (Just False) (Just n)) = "uint" <> show (8*n)
unparseVarType (SVMType.Int (Just False) Nothing) = "uint"
unparseVarType (SVMType.Int Nothing (Just n)) = "uint" <> show (8*n)
unparseVarType (SVMType.Int Nothing Nothing) = "uint"
unparseVarType (SVMType.Bool) = "bool"
unparseVarType (SVMType.String _) = "string"
unparseVarType (SVMType.Address _) = "address"
unparseVarType (SVMType.Account _) = "account"
unparseVarType (SVMType.Bytes (Just True) _ ) = "bytes"
unparseVarType (SVMType.Bytes Nothing (Just bytes) ) = "bytes" <> (show bytes)
unparseVarType (SVMType.UnknownLabel str) = str
unparseVarType (SVMType.Enum _ name _) = Text.unpack name
unparseVarType (SVMType.Array t (Just n)) = (unparseVarType t) <> "[" <> show n <> "]"
unparseVarType (SVMType.Array t Nothing) = (unparseVarType t) <> "[]"
unparseVarType (SVMType.Mapping _ key val) = "mapping (" <> (unparseVarType key) <> " => " <> (unparseVarType val) <> ")"
unparseVarType (SVMType.Contract contractName') = Text.unpack contractName'
unparseVarType (SVMType.Struct _ n) = "struct " ++ Text.unpack n
unparseVarType _ = "TYPE_NOT_IMPLEMENED"

unparseFunc :: (Text, Func) -> String
unparseFunc (name, f) = Text.unpack $ "function " <> name <> unparseFuncWithoutName f

unparseCtor :: Func -> String
unparseCtor f = Text.unpack $ "constructor" <> unparseFuncWithoutName f

unparseFuncWithoutName :: Func -> Text
unparseFuncWithoutName Func{..} =
       "("
    <> Text.intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ map (\(maybeName, v) -> (fromMaybe "" maybeName , v)) funcArgs))
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
    <> case funcVals of
        [] -> ""
        vals ->
              "returns ("
          <> Text.intercalate ", " (List.map unparseVals $ map (\(maybeName, v) -> (fromMaybe "" maybeName , v)) vals)
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

unparseStatement :: Show a => StatementF a -> String
unparseStatement = unparseStatementWith (flip const)

unparseStatementWith :: Show a => (a -> String -> String) -> StatementF a -> String
unparseStatementWith f (SimpleStatement s a) = f a $ unparseSimpleStatement s ++ ";"
unparseStatementWith f (IfStatement e s1 s2 a) =
  let
    elseString Nothing = ""
    elseString (Just elseStatements) =
      " else {\n" ++ tab (unlines (map (unparseStatementWith f) elseStatements)) ++ "\n}"
  in
    f a $ "if (" ++ unparseExpression e ++ ") {\n" ++ tab (unlines (map (unparseStatementWith f) s1)) ++ "\n}" ++ elseString s2

unparseStatementWith f (WhileStatement cond code a) = f a $
  "while (" ++ unparseExpression cond ++ ") {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n}"

unparseStatementWith f (DoWhileStatement code cond a) = f a $
  "do {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n} while (" ++ unparseExpression cond ++ ");"

unparseStatementWith f (ForStatement v1 v2 v3 s a) = f a $ concat
  [ "for ("
  , fromMaybe "" (fmap unparseSimpleStatement v1)
  ,  "; "
  , fromMaybe "" (fmap unparseExpression v2)
  , "; "
  , fromMaybe "" (fmap unparseExpression v3)
  , ") {\n    "
  , tab (unlines (map (unparseStatementWith f) s))
  , "}"
  ]
unparseStatementWith f (Return Nothing a) = f a $ "return;"
unparseStatementWith f (Return (Just e) a) = f a $ "return " ++ unparseExpression e ++ ";"
unparseStatementWith f (Break a) = f a $ "break;"
unparseStatementWith f (Continue a) = f a $ "continue;"
unparseStatementWith f (Throw a) = f a $ "throw;"
unparseStatementWith f (Block a) = f a $ "{ }"
unparseStatementWith f (AssemblyStatement (MloadAdd32 dst src) a) = f a $ printf "assembly { %s := mload(add(%s, 32)) }" dst src

unparseStatementWith f (EmitStatement eventName extups a) = 
  let 
    expVals = map (unparseExpression . snd) extups
  in
    f a $ "emit " ++ eventName ++ "(" ++ (List.intercalate ", " expVals) ++ ");"

unparseStatementWith f (RevertStatement customErr (OrderedArgs argList) a) = 
    f a $ "revert " ++ fromMaybe "" customErr ++ "(" ++ (List.intercalate ", " (map unparseExpression argList)) ++ ");\n"

unparseStatementWith f (RevertStatement customErr (NamedArgs argList) a) = 
    f a $ "revert " ++ fromMaybe "" customErr ++ "(" ++ (List.intercalate ", " (map (unparseExpression . snd) argList)) ++ ");\n"
unparseStatementWith f (UncheckedStatement code a) = f a $
  "unchecked {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n}"

-- unparseStatementWith _ x = internalError "missing case in call to unparseStatementWith" $ show x

unparseVarDefEntry :: VarDefEntryF a -> String
unparseVarDefEntry BlankEntry = ""
unparseVarDefEntry (VarDefEntry maybeType maybeLoc theName _) =
  let typeString = case maybeType of
                       Nothing -> "var" -- TODO: This isn't exactly correct to put "var" inside a tuple
                       Just theType -> unparseVarType theType
      locString = case maybeLoc of
                      Nothing -> " "
                      Just Memory -> " memory "
                      Just Storage -> " storage "
  in typeString ++ locString ++ theName



unparseSimpleStatement :: Show a => SimpleStatementF a -> String
unparseSimpleStatement (VariableDefinition entries maybeVal) =
  let entriesString = case entries of
                        [e] -> unparseVarDefEntry e
                        _ -> "(" ++ List.intercalate ", " (map unparseVarDefEntry entries) ++ ")"
      assignmentString =
        case maybeVal of
          Nothing -> ""
          Just e -> " = " ++ unparseExpression e
  in entriesString ++ assignmentString
unparseSimpleStatement (ExpressionStatement e) = unparseExpression e

-- TODO- deal with parenthesis properly....  this is a bit difficult to do
unparseExpression :: Show a => ExpressionF a -> String
unparseExpression (PlusPlus _ v) = unparseExpression v ++ "++"
unparseExpression (MinusMinus _ v) = unparseExpression v ++ "--"
unparseExpression (Unitary _ op v) = op ++ unparseExpression v
unparseExpression (Binary _ op v1 v2) =
  unparseExpression v1 ++ " " ++ op ++ " " ++ unparseExpression v2
unparseExpression (Variable _ name) = name
unparseExpression (MemberAccess _ e name) = unparseExpression e ++ "." ++ name
unparseExpression (NumberLiteral _ x Nothing) = show x
unparseExpression (BoolLiteral _ False) = "false"
unparseExpression (BoolLiteral _ True) = "true"
unparseExpression (StringLiteral _ s) = ('"':) . (++"\"") $ s
unparseExpression (TupleExpression _ vals) = "(" ++ List.intercalate ", " (map (maybe "" unparseExpression) vals) ++ ")"
unparseExpression (IndexAccess _ e maybeVal) = unparseExpression e ++ "[" ++ fromMaybe "" (fmap unparseExpression maybeVal) ++ "]"
unparseExpression (FunctionCall _ e args) =
    let shownArgs = case args of
                      OrderedArgs xs -> List.intercalate "," $ map unparseExpression xs
                      NamedArgs xs -> "{" ++ List.intercalate "," (map (\(n, x) -> printf "%s:%s" n $ unparseExpression x) xs) ++ "}"
    in unparseExpression e ++ "(" ++ shownArgs ++ ")"
unparseExpression (Ternary _ x y z) = unparseExpression x ++ "?" ++ unparseExpression y ++ ":" ++ unparseExpression z
unparseExpression (NewExpression _ x) = "new " ++ unparseVarType x
unparseExpression (ArrayExpression _ xs) = "[" ++ List.intercalate "," (map unparseExpression xs) ++ "]"
unparseExpression (ObjectLiteral _ m) = "{" ++ List.intercalate ",\n" [concat ["\t", Text.unpack k, ":", unparseExpression v]  | (k, v) <- Map.toList m] ++ "}"
unparseExpression x = internalError "missing case in call to unparseExpression" $ show x

unparseModifier :: (Text, ModifierF a) -> String
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

unparseEvent :: (Text, EventF a) -> String
unparseEvent (name, Event{..}) = Text.unpack $
     "event "
  <> name
  <> "(\n    "
  <> Text.intercalate ",\n    " (List.map unparseArgs eventLogs)
  <> ")"
  <> (if eventAnonymous then "anonymous" else "")
  <> ";"

unparseUsing :: (Text, UsingF a) -> String
unparseUsing (name, Using body _) = Text.unpack . mconcat $ ["using ", name, " ", Text.pack body, ";\n"]

unparseTypes :: (Text, SolidVM.DefF a) -> String
unparseTypes (name, SolidVM.Enum {names=names'}) =
  Text.unpack $ "enum "
             <> name
             <> " {\n      "
             <> Text.intercalate ",\n      " names'
             <> "\n    }"
unparseTypes (name, SolidVM.Struct {fields=fields'}) =
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
