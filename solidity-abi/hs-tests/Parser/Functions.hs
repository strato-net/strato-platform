module Parser.Functions (test, functionTestInput) where

import Blockchain.Ethereum.Solidity.Parse
import Parser.Common
import Test.Combinators
import Test.Common

test :: TestTree
test = doTests "functions" parserTest [
  functionNoArgsNoVals,
  functionOneArg,
  functionOneVal,
  functionTwoArgs,
  functionTwoVals,
  functionUnnamedArg,
  functionUnnamedVal
  ]

functionNoArgsNoVals :: ParserTestInput
functionNoArgsNoVals = functionTestInput "functionNoArgsNoVals" "f" [] [] [] [] [] []

functionOneArg :: ParserTestInput
functionOneArg = 
  functionTestInput "functionOneArg" "f" 
    ["int"] ["x"] [SignedInt 32]
    [] [] []

functionOneVal :: ParserTestInput
functionOneVal = 
  functionTestInput "functionOneVal" "f" 
    [] [] [] 
    ["int"] ["x"] [SignedInt 32]

functionTwoArgs :: ParserTestInput
functionTwoArgs =
  functionTestInput "functionTwoArgs" "f"
    ["int", "uint[]"] ["x", "y"] [SignedInt 32, DynamicArray $ UnsignedInt 32]
    [] [] []

functionTwoVals :: ParserTestInput
functionTwoVals =
  functionTestInput "functionTwoVals" "f"
    [] [] []
    ["int", "uint[]"] ["x", "y"] [SignedInt 32, DynamicArray $ UnsignedInt 32]

functionUnnamedArg :: ParserTestInput
functionUnnamedArg =
  functionTestInput "functionUnnamedArg" "f" 
    ["int"] [""] [SignedInt 32]
    [] [] []

functionUnnamedVal :: ParserTestInput
functionUnnamedVal =
  functionTestInput "functionUnnamedVal" "f" 
    [] [] []
    ["int"] [""] [SignedInt 32]

functionTestInput :: String -> String -> [String] -> [Identifier] -> [SolidityBasicType] ->
                     [String] -> [Identifier] -> [SolidityBasicType] -> ParserTestInput
functionTestInput cName fName args argNames argTypes vals valNames valTypes =
  (cName, source, tester)
  where
    source = 
      contractDefn cName $ functionDecl fName args' vals'
    tester solFile = 
      functionSignatureIs cName solFile cName fName argNames argTypes valNames valTypes
    args' = zipWith (##) args argNames
    vals' = zipWith (##) vals valNames

