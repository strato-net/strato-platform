module Test.ErrorMessages where

import Test.Combinators

fileError :: String -> String
fileError fileName = "File" ## quoted fileName

contractError :: String -> String
contractError cName = "contract" ## quoted cName

variableError :: String -> String
variableError vName = "variable" ## quoted vName

typeError :: String -> String
typeError tName = "type" ## quoted tName

functionError :: String -> String
functionError fName = "function" ## quoted fName

isMissingError :: String -> String
isMissingError s = "is missing" ## s

wrongThingError :: String -> String -> String
wrongThingError w r = "has" ## w ## "instead of" ## r

jsonFieldError :: (Show a) => String -> a -> String
jsonFieldError f x = "field" ## f ## "with value" ## show x
