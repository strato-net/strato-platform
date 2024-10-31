{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

-- |
-- Module: UnParser
-- Description: The Solidity source unparser to render Xabi into a Solidity Source File
-- Maintainer: Charles Crain <charles@blockapps.net>
-- Maintainer: Steven Glasford <steven_glasford@blockapps.net>
module SolidVM.Solidity.Parse.UnParser where

import Control.Lens hiding (op)
import qualified Data.List as List
import Data.Map ()
import qualified Data.Map as Map
import Data.Maybe
import Data.Source.Annotation
import Data.Text (Text)
import qualified Data.Text as Text
import SolidVM.Model.CodeCollection
import SolidVM.Model.CodeCollection.Contract as SolidVM
import qualified SolidVM.Model.CodeCollection.Def as SolidVM
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import SolidVM.Model.SolidString
import SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Xabi
import Text.Printf

sortWith :: Ord b => (a -> b) -> [a] -> [a]
sortWith f = List.sortBy (\x y -> f x `compare` f y)

unparse :: File -> String
unparse (File units) = List.concat $ List.map unparseSourceUnit units

unparseSourceUnit :: SourceUnit -> String
unparseSourceUnit (Pragma _ ident contents) = "pragma " ++ ident ++ " " ++ contents ++ ";\n"
unparseSourceUnit (Import _ imp) = "import \"" ++ unparseFileImport imp ++ "\";\n"
unparseSourceUnit (FLConstant name conDecl) = (("\n    " <>) . unparseConstant) (Text.unpack name, conDecl)
unparseSourceUnit (FLStruct name decl) = (("\n    " <>) . unparseTypes) (Text.unpack name, decl)
unparseSourceUnit (FLEnum name decl) = (("\n    " <>) . unparseTypes) (Text.unpack name, decl)
unparseSourceUnit (FLError name args) = (("\n    " <>) . unparseTypes) (Text.unpack name, args)
unparseSourceUnit (Alias _ ident orignal) = "type \"" ++ ident ++ " " ++ orignal ++ "\";\n"
unparseSourceUnit (DummySourceUnit) = "DummySourceUnit"
unparseSourceUnit (NamedXabi name (contract, inherited)) =
  ( case _xabiKind contract of
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
    <> concatMap (("\n    " <>) . unparseVar) (Map.toList $ _xabiVars contract)
    <> concatMap (("\n    " <>) . unparseConstant) (Map.toList $ _xabiConstants contract)
    --  <> concatMap (("\n    " <>) . unparseVar) (sortWith (varTypeAtBytes . snd) $ Map.toList $ xabiVars contract)
    <> concatMap (("\n    " <>) . unparseTypes) (Map.toList $ _xabiTypes contract)
    <> concatMap (("\n    " <>) . unparseModifier) (Map.toList $ _xabiModifiers contract)
    <> concatMap (("\n    " <>) . unparseEvent) (Map.toList $ _xabiEvents contract)
    <> concatMap (("\n    " <>) . unparseUsing) (concat . map snd . Map.toList $ _xabiUsing contract)
    <> concatMap (("\n    " <>) . unparseCtor) (Map.elems $ _xabiConstr contract)
    <> concatMap (("\n    " <>) . unparseFunc) (Map.toList $ _xabiFuncs contract)
    <> "\n}"
unparseSourceUnit (FLFunc n a) = unparseFunc (n, a)

unparseVar :: (SolidString, VariableDecl) -> String
unparseVar (name, (VariableDecl theType isPublic maybeExpression _ _ _)) =
  unparseVarType (theType)
    <> " "
    <> ( if isPublic --TODO- I need to expand this to public, private or nothing
           then "public "
           else ""
       )
    <> labelToString name
    <> ( case maybeExpression of
           Nothing -> ""
           Just value -> " = " ++ unparseExpression value
       )
    <> ";"

unparseConstant :: (SolidString, ConstantDecl) -> String
unparseConstant (name, (ConstantDecl theType isPublic expression _)) =
  unparseVarType (theType)
    <> " "
    <> ( if isPublic --TODO- I need to expand this to public, private or nothing
           then "public "
           else ""
       )
    {-  <> (case varTypePublic theType of
            Nothing -> ""
            Just True -> "public "
            Just False -> "private "
         ) -}
    <> "constant "
    <> labelToString name
    <> (" = " ++ unparseExpression expression)
    <> ";"

unparseContract :: SolidVM.Contract -> String
unparseContract contr =
  -- TODO: need to recursively retrieve all of the parent contracts
  "contract "
    <> labelToString (contr ^. contractName)
    -- <> if (contr ^. parents )
    <> " {\n  "
    <> (List.intercalate "\n  " $ List.map unparseConstant (Map.assocs $ contr ^. constants)) -- ( contr ^. constants , contr ^. constants))
    <> (List.intercalate "\n  " $ List.map unparseVar (Map.assocs $ contr ^. storageDefs))
    <> (List.intercalate "\n  " $ List.map unparseEnum (fmap (fmap fst) (Map.assocs $ contr ^. enums)))
    <> (List.intercalate "\n  " $ List.map unparseStruct (Map.assocs $ contr ^. structs))
    <> (List.intercalate "\n  " $ List.map unparseEvent (Map.assocs $ contr ^. events))
    <> (List.intercalate "\n  " $ List.map unparseFunc (Map.assocs $ contr ^. functions))
    <> case (contr ^. constructor) of
      Just funf -> ("\n  " ++ (unparseCtor funf))
      Nothing -> "\n  // no constructor found"
    <> (List.intercalate "\n  " $ List.map unparseModifier (Map.assocs $ contr ^. modifiers))
    <> "\n}"

unparseStruct :: (SolidString, [(SolidString, SolidVM.FieldType, SourceAnnotation ())]) -> String
unparseStruct (name, fields) =
  "struct "
    <> labelToString name
    <> " {\n  "
    <> (List.intercalate "  " $ List.map unparseStructField fields)
    <> "}"

unparseStructField :: (SolidString, SolidVM.FieldType, SourceAnnotation ()) -> String
unparseStructField (name, theType, _) =
  unparseVarType (fieldTypeType theType)
    <> " "
    <> labelToString name
    <> ";\n"

unparseEnum :: (SolidString, [SolidString]) -> String
unparseEnum (name, values) =
  "enum "
    <> labelToString name
    <> " {\n  "
    <> (List.intercalate ",\n  " $ List.map labelToString values)
    <> "\n}"

unparseVarType :: Type -> String
unparseVarType (SVMType.Int (Just True) (Just n)) = "int" <> show (8 * n)
unparseVarType (SVMType.Int (Just True) Nothing) = "int"
unparseVarType (SVMType.Int (Just False) (Just n)) = "uint" <> show (8 * n)
unparseVarType (SVMType.Int (Just False) Nothing) = "uint"
unparseVarType (SVMType.Int Nothing (Just n)) = "uint" <> show (8 * n)
unparseVarType (SVMType.Int Nothing Nothing) = "uint"
unparseVarType (SVMType.Bool) = "bool"
unparseVarType (SVMType.String _) = "string"
unparseVarType (SVMType.Address _) = "address"
unparseVarType (SVMType.Account _) = "account"
unparseVarType (SVMType.Bytes (Just True) _) = "bytes"
unparseVarType (SVMType.Bytes Nothing (Just bytes)) = "bytes" <> (show bytes)
unparseVarType (SVMType.UnknownLabel str _) = labelToString str
unparseVarType (SVMType.Enum _ name _) = labelToString name
unparseVarType (SVMType.Array t (Just n)) = (unparseVarType t) <> "[" <> show n <> "]"
unparseVarType (SVMType.Array t Nothing) = (unparseVarType t) <> "[]"
unparseVarType (SVMType.Mapping _ key val) = "mapping (" <> (unparseVarType key) <> " => " <> (unparseVarType val) <> ")"
unparseVarType (SVMType.Contract contractName') = labelToString contractName'
unparseVarType (SVMType.Struct _ n) = "struct " ++ labelToString n
unparseVarType (SVMType.Decimal) = "decimal"
unparseVarType _ = "TYPE_NOT_IMPLEMENTED"

unparseFuncOverload :: SolidString -> [Func] -> String
unparseFuncOverload name funcs = unlines $ map (unparseFunc . (name,)) funcs

unparseFunc :: (SolidString, Func) -> String
unparseFunc (name, f) =
  if (length (f ^. funcOverload) > 1)
    then Text.unpack $ unparseFuncWithOverload name f
    else Text.unpack $ "function " <> labelToText name <> " " <> unparseFuncWithoutName f

unparseCtor :: Func -> String
unparseCtor f = Text.unpack $ "constructor " <> unparseFuncWithoutName f

unparseFuncWithOverload :: SolidString -> Func -> Text
unparseFuncWithOverload name myFunction = unparseFuncDeep name myFunction

unparseFuncWithoutName :: Func -> Text
unparseFuncWithoutName f = unparseFuncDeep "" f

unparseFuncDeep :: SolidString -> Func -> Text
unparseFuncDeep deepName Func {..} =
  ( if (deepName == "")
      then "("
      else "function " <> labelToText deepName <> " ("
  )
    <> Text.intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ map (\(maybeName, v) -> (fromMaybe "" $ fmap labelToText maybeName, v)) _funcArgs))
    <> ") "
    <> case _funcStateMutability of
      Just sm -> tShow sm <> " "
      Nothing -> ""
    <> case _funcVisibility of
      Just Private -> "private "
      Just Public -> "public "
      Just Internal -> "internal "
      Just External -> "external "
      _ -> ""
    <> if _funcVirtual
      then "virtual "
      else
        ""
          <> case _funcOverrides of
            Nothing -> ""
            Just [] -> "override "
            Just xs -> "override(" <> Text.intercalate ", " (map labelToText xs) <> ") "
          <> case _funcModifiers of
            [] -> ""
            xs ->
              "modifiers " <> (Text.intercalate ", " (map Text.pack (map (\(name, args) -> labelToString name <> Text.unpack ("(" <> Text.intercalate ", " (map Text.pack (map unparseExpression args)) <> ")")) xs))) <> " "
          <> case _funcVals of
            [] -> ""
            vals ->
              "returns ("
                <> Text.intercalate ", " (List.map unparseVals $ map (\(maybeName, v) -> (fromMaybe "" $ fmap labelToText maybeName, v)) vals)
                <> ") "
          <> "{\n    "
          <> case _funcContents of
            Just contents -> Text.pack $ tab . tab $ unlines $ map unparseStatement contents --(Text.concat . Text.lines $ contents)
            Nothing -> "\n"
          <> "}"
          <> case _funcOverload of
            [] -> Text.pack ""
            as -> "\n" <> (Text.unlines $ map (unparseFuncDeep deepName) as)

-- <> (Text.pack $ show func)

tab :: String -> String
tab [] = []
tab ('\n' : rest) = "\n  " ++ tab rest
tab (x : rest) = x : tab rest

unparseStatement :: Show a => StatementF a -> String
unparseStatement = unparseStatementWith (flip const)

unparseStatementWith :: Show a => (a -> String -> String) -> StatementF a -> String
unparseStatementWith f (SimpleStatement s a) = f a $ unparseSimpleStatement s ++ ";"
unparseStatementWith f (IfStatement e s1 s2 a) =
  let elseString Nothing = ""
      elseString (Just elseStatements) =
        " else {\n" ++ tab (unlines (map (unparseStatementWith f) elseStatements)) ++ "\n}"
   in f a $ "if (" ++ unparseExpression e ++ ") {\n" ++ tab (unlines (map (unparseStatementWith f) s1)) ++ "\n}" ++ elseString s2
unparseStatementWith f (WhileStatement cond code a) =
  f a $
    "while (" ++ unparseExpression cond ++ ") {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n}"
unparseStatementWith f (DoWhileStatement code cond a) =
  f a $
    "do {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n} while (" ++ unparseExpression cond ++ ");"
unparseStatementWith f (ForStatement v1 v2 v3 s a) =
  f a $
    concat
      [ "for (",
        fromMaybe "" (fmap unparseSimpleStatement v1),
        "; ",
        fromMaybe "" (fmap unparseExpression v2),
        "; ",
        fromMaybe "" (fmap unparseExpression v3),
        ") {\n    ",
        tab (unlines (map (unparseStatementWith f) s)),
        "}"
      ]
unparseStatementWith f (Return Nothing a) = f a $ "return;"
unparseStatementWith f (Return (Just e) a) = f a $ "return " ++ unparseExpression e ++ ";"
unparseStatementWith f (Break a) = f a $ "break;"
unparseStatementWith f (ModifierExecutor a) = f a $ "_;"
unparseStatementWith f (Continue a) = f a $ "continue;"
unparseStatementWith f (Throw e a) = f a $ "throw " ++ unparseExpression e ++ ";"
unparseStatementWith f (Block a) = f a $ "{ }"
unparseStatementWith f (AssemblyStatement (MloadAdd32 dst src) a) = f a $ printf "assembly { %s := mload(add(%s, 32)) }" dst src
unparseStatementWith f (EmitStatement eventName extups a) =
  let expVals = map (unparseExpression . snd) extups
   in f a $ "emit " ++ eventName ++ "(" ++ (List.intercalate ", " expVals) ++ ");"
unparseStatementWith f (RevertStatement customErr (OrderedArgs argList) a) =
  f a $ "revert " ++ fromMaybe "" customErr ++ "(" ++ (List.intercalate ", " (map unparseExpression argList)) ++ ");\n"
unparseStatementWith f (RevertStatement customErr (NamedArgs argList) a) =
  f a $ "revert " ++ fromMaybe "" customErr ++ "(" ++ (List.intercalate ", " (map (unparseExpression . snd) argList)) ++ ");\n"
unparseStatementWith f (UncheckedStatement code a) =
  f a $
    "unchecked {\n" ++ tab (unlines $ map (unparseStatementWith f) code) ++ "\n}"
unparseStatementWith f (TryCatchStatement tryBlock catchBlockMap a) =
  f a $
    "try {\n" ++ tab (unlines $ map (unparseStatementWith f) tryBlock) ++ "\n}" ++ " catch "
      ++ ( List.intercalate
             " "
             ( map
                 ( \(name, (params, block)) ->
                     "catch " ++ name
                       ++ (show (fromMaybe [] params))
                       ++ " {\n"
                       ++ tab (unlines $ map (unparseStatementWith f) block)
                       ++ "\n}"
                 )
                 (Map.toList catchBlockMap)
             )
         )
unparseStatementWith f (SolidityTryCatchStatement expr mtpl tryBlock catchBlockMap a) =
  f a $
    "try " ++ unparseExpression expr ++ " " ++ (show (fromMaybe [] mtpl)) ++ " {\n" ++ tab (unlines $ map (unparseStatementWith f) tryBlock) ++ "\n}" ++ " catch " ++ show (Map.toList catchBlockMap)

-- unparseContract :: ContractF a -> String
-- --Use a many statement to go through the list items contained in the ContractF. Making sure everything is able to touched
-- unparseContract =

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
        Just Calldata -> " calldata "
   in typeString ++ locString ++ labelToString theName

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
unparseExpression (Variable _ name) = labelToString name
unparseExpression (MemberAccess _ e name) = unparseExpression e ++ "." ++ labelToString name
unparseExpression (NumberLiteral _ x _) = show x
--unparseExpression (NumberLiteral _ x (Just _)) = show x
unparseExpression (BoolLiteral _ False) = "false"
unparseExpression (BoolLiteral _ True) = "true"
unparseExpression (DecimalLiteral _ v) = show $ unwrapDecimal v
unparseExpression (StringLiteral _ s) = ('"' :) . (++ "\"") $ s
unparseExpression (AccountLiteral _ a) = ('<' :) . (++ ">") $ show a
unparseExpression (HexaLiteral _ a) = "hex\"" ++ (labelToString a) ++ "\""
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
unparseExpression (ObjectLiteral _ m) = "{" ++ List.intercalate ",\n" [concat ["\t", labelToString k, ":", unparseExpression v] | (k, v) <- Map.toList m] ++ "}"

--unparseExpression x = internalError "missing case in call to unparseExpression" $ show x

unparseModifier :: Show a => (SolidString, ModifierF a) -> String
unparseModifier (name, Modifier {..}) =
  Text.unpack $
    "modifier "
      <> labelToText name
      <> "("
      <> Text.intercalate ", " (List.map unparseArgs _modifierArgs)
      <> ") {\n        "
      <> case _modifierContents of
        Just contents -> Text.pack $ tab . tab $ unlines $ map unparseStatement contents --(Text.concat . Text.lines $ contents)
        Nothing -> ""
      <> "}"

unparseEvent :: (SolidString, EventF a) -> String
unparseEvent (name, Event {..}) =
  Text.unpack $
    "event "
      <> labelToText name
      <> "(\n    "
      <> Text.intercalate ",\n    " (List.map (\(EventLog n _ i) -> unparseArgs (n,i)) _eventLogs)
      <> ")"
      <> (if _eventAnonymous then "anonymous" else "")
      <> ";"

unparseUsing :: UsingF a -> String
unparseUsing (Using lib typ _) = mconcat ["using ", lib, " for ", typ, ";\n"]

unparseTypes :: (SolidString, SolidVM.DefF a) -> String
unparseTypes (name, SolidVM.Enum {names = names'}) =
  Text.unpack $
    "enum "
      <> labelToText name
      <> " {\n      "
      <> Text.intercalate ",\n      " (map labelToText names')
      <> "\n    }"
unparseTypes (name, SolidVM.Struct {fields = fields'}) =
  Text.unpack $
    "struct "
      <> labelToText name
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
        <> labelToText fieldName
        <> ";"
unparseTypes (name, SolidVM.Error {params = params'}) =
  Text.unpack $
    "error "
      <> labelToText name
      <> " ("
      <> Text.intercalate ", " (List.map unparseArgs (sortWith (indexedTypeIndex . snd) $ map (\(n, v) -> (labelToText n, v)) params'))
      <> ")"
unparseTypes (_name, _def) = ""

unparseArgs :: (Text, IndexedType) -> Text
unparseArgs (name, theType) = unparseIndexedType theType <> " " <> name

unparseVals :: (Text, IndexedType) -> Text
unparseVals (name, theType) =
  unparseIndexedType theType
    <> if ((Text.length name) > 0)
      then
        if Text.head name == '#'
          then ""
          else " " <> name
      else " " <> name

unparseIndexedType :: IndexedType -> Text
unparseIndexedType = Text.pack . unparseVarType . indexedTypeType

unparseFileImport :: Show a => FileImportF a -> String
unparseFileImport (Simple e _) = unparseExpression e
unparseFileImport (Qualified e q _) = unparseExpression e ++ " as " ++ Text.unpack q
unparseFileImport (Braced i e _) = "{ " ++ (List.intercalate ", " $ unparseItemImport <$> i) ++ " } from " ++ unparseExpression e

unparseItemImport :: ItemImportF a -> String
unparseItemImport (Named n _) = Text.unpack n
unparseItemImport (Aliased n a _) = Text.unpack $ n <> " as " <> a
