-- | 
-- Module: JSON
-- Description: Source for the JSON ABI creator
-- Maintainer: Ryan Reich <ryan@blockapps.net>
{-# LANGUAGE TypeSynonymInstances, FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module JSON (jsonABI) where

import Data.Aeson hiding (String)
import qualified Data.Aeson as Aeson (Value(String))
import Data.Aeson.Types (Pair)
import qualified Data.Map as Map
import Data.Map (Map)
import qualified Data.List as List
import Data.Maybe
import Data.String

import qualified Data.HashMap.Strict as HashMap
import qualified Data.Vector as Vector
import qualified Data.Text as Text

import Imports
import Layout
import DefnTypes
import LayoutTypes
import ParserTypes
import Selector

instance ToJSON SolidityFile where
  toJSON f = either id id $ jsonABI "" (Map.singleton "" f)

-- | See the README for a formal description of the json value produced by
-- this function.
jsonABI :: FileName -> Map FileName SolidityFile -> Either Value Value
jsonABI fileName files = convertImportError $ do
  filesDef <- makeFilesDef files
  let
    files' = Map.mapKeys collapse files
    results = Map.mapWithKey (doFileABI files') filesDef
    doFileABI filesM fName fileDef =
      filesABI fName results (fileImports $ getFile fName filesM) fileDef
      where getFile name = Map.findWithDefault (error $ "file name " ++ show name ++ " not found in files'") name
    getResult name = Map.findWithDefault (error $ "file name " ++ show name ++ " not found in results") name
  result <- getResult fileName results
  return $ toJSON result

  where
    convertImportError xEither = case xEither of
      Left (ImportCycle fBase) -> Left $
        object [pair "importError" "importCycle", pair "inFile" fBase]
      Left (MissingImport fBase fName) -> Left $
        object [pair "importError" "missingImport", pair "missingImport" fName, pair "inFile" fBase]
      Left (MissingSymbol fBase symName fName) -> Left $
        object [pair "importError" "missingSymbol", pair "missingSymbol" symName, pair "fileName" fName, pair "inFile" fBase]
      Right x -> Right x

filesABI :: FileName ->
            Map FileName (Either ImportError (Map ContractName Value)) ->
            [(FileName, ImportAs)] -> SolidityContractsDef ->
            Either ImportError (Map ContractName Value)
filesABI fileName fileABIEs imports fileDef = do
  importsABI <- getImportDefs fileName fileABIEs imports
  let
    fileLayout = makeContractsLayout fileDef
    fileABI = Map.mapWithKey (contractABI fileLayout) fileDef
  return $ fileABI `Map.union` importsABI

contractABI :: SolidityFileLayout -> ContractName -> SolidityContractDef -> Value
contractABI fL name (ContractDef objs types _) =
  object $
      nonempty (pair "vars") (varsABI (objsLayout $ getObj name fL) objs) ++
      nonempty (pair "funcs") (funcsABI typesL objs) ++
      nonempty (pair "types") (typesABI typesL types) ++
      nonempty (pair "constr") (constrABI name objs)
  where
    typesL = typesLayout $ getType name fL
    getObj oName = Map.findWithDefault (error $ "contract name " ++ show oName ++ " not found in objsLayout") oName
    getType tName = Map.findWithDefault (error $ "contract name " ++ show tName ++ " not found in typesLayout") tName
    nonempty :: (Value -> Pair) -> Value -> [Pair]
    nonempty f ob@(Object o) =
      if HashMap.null o
      then []
      else [f ob]
    nonempty f ar@(Array a) =
      if Vector.null a
      then []
      else [f ar]
    nonempty f st@(Aeson.String s) =
      if Text.null s
      then []
      else [f st]
    nonempty _ Null = []
    nonempty f x = [f x]

varsABI :: SolidityObjsLayout -> [SolidityObjDef] -> Value
varsABI layout' objs = object $ mapMaybe (varABI layout') objs

funcsABI :: SolidityTypesLayout -> [SolidityObjDef] -> Value
funcsABI typesL objs = object $ mapMaybe (funcABI typesL) objs
              
typesABI :: SolidityTypesLayout -> SolidityTypesDef -> Value
typesABI layout' types =
  object $ mapMaybe snd $ Map.toList $
  Map.mapWithKey (\k t -> typeABI (getType k layout') k t) types
  where getType name = Map.findWithDefault (error $ "contract name " ++ show name ++ " not found in layout'") name

constrABI :: Identifier -> [SolidityObjDef] -> Value
constrABI name objs = object $ maybe [] listABI argsM
  where
    argsM = getArgs =<< List.find isConstr objs
    isConstr (ObjDef name' (SingleValue (Typedef name'')) (TupleValue _) _ _)
      | name == name' && name == name'' = True
    isConstr _ = False
    getArgs (ObjDef _ _ (TupleValue args) _ _) = Just args
    getArgs _ = Nothing

listABI :: [SolidityObjDef] -> [Pair]
listABI objs = do
  (i, (oName, oABI)) <- zip [0::Integer ..] $ fromMaybe [] $ mapM objABI objs
  let realName = if null oName then "#" ++ show i else oName
  return $ pair realName $ object $ pair "index" i : oABI

varABI :: SolidityObjsLayout -> SolidityObjDef -> Maybe Pair
varABI layout' obj = do
  (name, tABI) <- objABI obj
  let getObj name' = Map.findWithDefault (error $ "variable name " ++ name' ++ " not found in layout'") name'
      oB = objStartBytes $ getObj (objName obj) layout'
  return $ pair name $ object $ pair "atBytes" (toInteger oB) : tABI

funcABI :: SolidityTypesLayout -> SolidityObjDef -> Maybe Pair
funcABI typesL (ObjDef name (TupleValue vals) (TupleValue args) _ _) =
  Just $ pair name $ object [
           pair "selector" $ selector typesL name args vals,
           lpair "args" args,
           lpair "vals" vals
           ]
funcABI _ _ = Nothing

typeABI :: SolidityTypeLayout -> Identifier -> SolidityNewType -> Maybe Pair
typeABI (StructLayout fieldsL tB) name (Struct fields') =
  Just $ pair name $ object [
    pair "type" "Struct",
    pair "bytes" $ toInteger tB,
    pair "fields" $ varsABI fieldsL fields'
    ]
typeABI (EnumLayout tB) name (Enum names') =
  Just $ pair name $ object [
    pair "type" "Enum",
    pair "bytes" $ toInteger tB,
    pair "names" names'
    ]
typeABI (UsingLayout _) name (Using contract typeName') =
  Just $ pair name $ object [
    pair "type" "Using",
    pair "usingContract" contract,
    pair "usingType" typeName'
    ]
typeABI _ _ _ = Nothing

objABI :: SolidityObjDef -> Maybe (String, [Pair])
objABI (ObjDef name (SingleValue t) NoValue _ isPublic) =
  -- In addition to the type, also record whether the variable is public
  Just (name, basicTypeABI t ++ if isPublic then [pair "public" True] else [])
objABI _ = Nothing

basicTypeABI :: SolidityBasicType -> [Pair]
basicTypeABI Boolean = [pair "type" "Bool"]
basicTypeABI Address = [pair "type" "Address"]
basicTypeABI (SignedInt b) = [
  pair "type" "Int",
  pair "signed" True,
  pair "bytes" $ toInteger b]
basicTypeABI (UnsignedInt b) = [
  pair "type" "Int",
  pair "bytes" $ toInteger b
  ]
basicTypeABI (FixedBytes b) = [
  pair "type" "Bytes",
  pair "bytes" $ toInteger b
  ]
basicTypeABI DynamicBytes = [
  pair "type" "Bytes",
  pair "dynamic" True
  ]
basicTypeABI String = [
  pair "type" "String",
  pair "dynamic" True
  ]
basicTypeABI (FixedArray eT l) = [
  pair "type" "Array",
  pair "length" $ toInteger l,
  tpair "entry" eT
  ]
basicTypeABI (DynamicArray eT) = [
  pair "type" "Array",
  pair "dynamic" True,
  tpair "entry" eT
  ]
basicTypeABI (Mapping dT cT) = [
  pair "type" "Mapping",
  pair "dynamic" True,
  tpair "key" dT,
  tpair "value" cT
  ]
basicTypeABI (Typedef name) = [
  pair "typedef" name
  ]

pair :: (ToJSON a) => String -> a -> Pair
pair x y = (fromString x, toJSON y)

tpair :: String -> SolidityBasicType -> Pair
tpair x y = (fromString x, object $ basicTypeABI y)

lpair :: String -> [SolidityObjDef] -> Pair
lpair x y = (fromString x, object $ listABI y)
