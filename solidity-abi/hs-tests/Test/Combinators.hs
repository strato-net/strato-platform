module Test.Combinators where

import Data.List

infixr 3 ##
(##) :: String -> String -> String
(##) s1 s2 = s1 ++ " " ++ s2

quoted :: String -> String
quoted s = "\"" ++ s ++ "\""

braced :: String -> String
braced s = "{" ++ s ++ "}"

{-# ANN paren'd "HLint: ignore Use camelCase" #-}
paren'd :: String -> String
paren'd s = "(" ++ s ++ ")"

{-# ANN semi'd "HLint: ignore Use camelCase" #-}
semi'd :: String -> String
semi'd s = s ++ ";"

{-# ANN comma'd "HLint: ignore Use camelCase" #-}
comma'd :: [String] -> String
comma'd = intercalate ","

contractDefn :: String -> String -> String
contractDefn name body = "contract" ## name ## braced body

contractDefnBases :: String -> String -> [String] -> String
contractDefnBases name body bases = "contract" ## name ## "is" ## comma'd bases ## braced body

importFile :: String -> String
importFile fName = semi'd $ "import" ## quoted fName

importFileAs :: String -> String -> String
importFileAs fName prefix = semi'd $ "import" ## quoted fName ## "as" ## prefix

importStarFile :: String -> String
importStarFile fName = semi'd $ "import" ## "*" ## "from" ## quoted fName

importStarFileAs :: String -> String -> String
importStarFileAs fName prefix = semi'd $ "import" ## "*" ## "as" ## prefix ## "from" ## quoted fName

importFileES6Aliases :: String -> [String] -> [String] -> String
importFileES6Aliases fName oldNames newNames = semi'd $
  "import" ## braced (comma'd $ zipWith doAlias oldNames newNames) ##
  "from" ## quoted fName

  where 
    doAlias name "" = name
    doAlias name alias = name ## "as" ## alias

varDecl :: String -> String -> String
varDecl name vName = semi'd $ name ## vName

arrayDeclType :: String -> String -> String
arrayDeclType arrType size = arrType ++ "[" ++ size ++ "]"

mappingDeclType :: String -> String -> String
mappingDeclType domType codType = "mapping" ## paren'd (domType ## "=>" ## codType)

enumDefn :: String -> [String] -> String
enumDefn name names = "enum" ## name ## braced (comma'd names)

structDefn :: String -> [String] -> String
structDefn name types = "struct" ## name ## braced (concatMap semi'd fields)
  where
    fields = zipWith (\t n -> t ## "f" ++ show n) types [0::Integer ..]

functionSignature :: String -> [String] -> [String] -> String
functionSignature name args vals = 
  "function" ## name ## paren'd (comma'd args) ##
  if null vals 
  then "" 
  else "returns" ## paren'd (comma'd vals)

functionDecl :: String -> [String] -> [String] -> String
functionDecl name args vals = semi'd $ functionSignature name args vals

