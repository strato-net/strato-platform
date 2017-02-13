module Json.Imports (test, importTest, importTestInheritance) where

import Test.Tasty

import Data.Aeson hiding (Result(Error, Success), json)
import qualified Data.Aeson as Aeson (Result(Error, Success))

import Data.Map (Map)
import qualified Data.Map as Map

import Test.ErrorMessages
import Test.Combinators
import Test.Common ((|!))
import Json.Common

test :: TestTree
test = testGroup "imports" $ map jsonTest [
  basicImport, qualifiedBasicImport,
  basicStarImport, qualifiedBasicStarImport,
  es6Import, es6AliasImport,
  missingImport, transitiveImport, diamondImport,
  es6AliasImportInheritance
  ]

basicImport :: JSONTestInput
basicImport = importTest "basicImport" (justFile importFile) noAliaser

qualifiedBasicImport :: JSONTestInput
qualifiedBasicImport = 
  importTest "qualifiedBasicImport" (justFile2 importFileAs prefix) (dotAliaser prefix)
  where prefix = "Imported"

basicStarImport :: JSONTestInput
basicStarImport = importTest "basicStarImport" (justFile importStarFile) noAliaser

qualifiedBasicStarImport :: JSONTestInput
qualifiedBasicStarImport = 
  importTest "qualifiedBasicStarImport" 
    (justFile2 importStarFileAs prefix) 
    (dotAliaser prefix)
  where prefix = "Imported"

es6Import :: JSONTestInput
es6Import = 
  importTest "es6Import" (\cName fName -> importFileES6Aliases fName [cName] [""]) noAliaser

es6AliasImport :: JSONTestInput
es6AliasImport =
  importTest "es6AliasImport" 
    (\cName fName -> importFileES6Aliases fName [cName] [alias])
    (constAliaser alias)

  where alias = "Imported"

missingImport :: JSONTestInput
missingImport = (name, Map.fromList [(name, source)], tester) where
  name = "missingImport"
  source = importFile importName
  tester json = 
    Map.lookup name jsonMap == Just importName
    |! fileError name ## theError

    where
      jsonMap :: Map String String
      jsonMap = case fromJSON json of
        Aeson.Error s -> error s
        Aeson.Success x -> x

  importName = "missing"
  theError = isMissingError $ jsonFieldError name importName

transitiveImport :: JSONTestInput
transitiveImport = jsonTestInput names sources cNames
  where
    names = ["transitiveImport", "F1", "F2"]
    sources = [
      importFile "F1" ## contractDefn "C1" "",
      importFile "F2" ## contractDefn "C2" "",
      contractDefn "C3" ""
      ]
    cNames = ["C1", "C2", "C3"]

diamondImport :: JSONTestInput
diamondImport = jsonTestInput names sources cNames
  where
    names = ["diamondImport", "F1", "F2", "F12"]
    sources = [
      importFile "F1" ## importFile "F2" ## contractDefn "C" "",
      importFileAs "F12" "F1" ## contractDefn "C1" "",
      importFileAs "F12" "F2" ## contractDefn "C2" "",
      contractDefn "C12" ""
      ]
    cNames = ["C", "C1", "C2", dotAliaser "F1" "C12", dotAliaser "F2" "C12"]

es6AliasImportInheritance :: JSONTestInput
es6AliasImportInheritance =
  importTestInheritance "es6AliasImportInheritance" 
    (\cName fName -> importFileES6Aliases fName [cName] [alias])
    (constAliaser alias)

  where alias = "Imported"

importTestInheritance :: String -> (String -> String -> String) -> (String -> String) ->
                         JSONTestInput
importTestInheritance name importer aliaser =
  jsonTestInput names sources cNames 
  
  where
    names = [name, importName]
    sources = [
      importer "D" importName ## contractDefnBases "C" "" [aliaser "D"],
      contractDefnBases "D" "" ["E"] ## contractDefn "E" ""
      ]
    cNames = ["C", aliaser "D"]
    importName = name ++ "-import"

importTest :: String -> (String -> String -> String) -> (String -> String) -> JSONTestInput
importTest name importer aliaser = jsonTestInput names sources cNames where
  names = [name, importName]
  sources = [
    importer "D" importName ## contractDefn "C" "",
    contractDefn "D" ""
    ]
  cNames = ["C", aliaser "D"]
  importName = name ++ "_import"

{-# ANN dotAliaser "HLint: ignore Redundant bracket" #-}
dotAliaser :: String -> (String -> String)
dotAliaser prefix s = prefix ++ "." ++ s

{-# ANN constAliaser "HLint: ignore Redundant bracket" #-}
constAliaser :: String -> (String -> String)
constAliaser = const 

noAliaser :: String -> String
noAliaser = id

{-# ANN justFile "HLint: ignore Redundant bracket" #-}
justFile :: (String -> String) -> (String -> String -> String)
justFile = const 

{-# ANN justFile2 "HLint: ignore Redundant bracket" #-}
justFile2 :: (String -> String -> String) -> String -> (String -> String -> String)
justFile2 importer prefix = const $ flip importer prefix
