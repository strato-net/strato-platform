{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM2022 (
  create
  ) where

import Control.Monad
import qualified Data.ByteString.Char8 as BC
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import Data.IORef
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Set as Set
import Text.Parsec

import qualified Blockchain.AST1 as AST1
import qualified Blockchain.AST1.Contract as AST1
import qualified Blockchain.AST1.FunctionDefinition as AST1
import Blockchain.AST2
import Blockchain.Compiler
import Blockchain.Contract
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import Blockchain.Parser
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Type (Type)
import qualified Blockchain.Type as Type
import SolidVM.Solidity.Parse

import Text.Format

createVariable :: Type -> IO Variable
createVariable Type.Integer = fmap Variable $ newIORef (0::Integer)
createVariable Type.String = fmap Variable $ newIORef (""::String)
createVariable Type.Address = fmap Variable $ newIORef $ Address 0x0

createVariables :: [AST1.VariableDefinition] -> IO (Map String Variable)
createVariables varDefs = do
  fmap Map.fromList $
    forM varDefs $ \(AST1.VariableDefinition name theType) -> do
      var <- createVariable theType
      return (name, var)

create :: Bool
       -> Bool
       -> Set.Set Account
       -> BlockData
       -> Int
       -> Account
       -> Account
       -> Integer
       -> Integer
       -> Gas
       -> Account
       -> Code
       -> Keccak256
       -> Maybe Word256
       -> Maybe (Map Text Text)
       -> IO ExecResults
--create _ _ _ blockData _ sender' origin' _ _ _ newAddress code txHash' chainId' metadata = do
create _ _ _ _ _ _ _ _ _ _ _ theCode _ _ _ = do
  let sourceCode =
        case theCode of
          Code c -> c
          _ -> error "PtrTocode not yet supported in SolidVM2022/create"
      variableDefs =
        [
          AST1.VariableDefinition "theInt" Type.Integer,
          AST1.VariableDefinition "theString" Type.String,
          AST1.VariableDefinition "theAddress" Type.Address,
          AST1.VariableDefinition "theSum" Type.Integer,
          AST1.VariableDefinition "theFunctionEvaluation" Type.Integer
        ]

  globals <- createVariables variableDefs
  
--  sourceCode <- readFile "test.sol"

  --  let sourceCode = "contract someContract { function abcd { } }"

  let sourceUnitsOrError = compileSourceNoInheritance $ Map.fromList [("", Text.pack $ BC.unpack $ sourceCode)]

  case sourceUnitsOrError of
    Left e -> error $ show e
    Right sourceUnits -> putStrLn $ "CodeCollection: " ++ show sourceUnits
  
  let contract =
        case parse parseContract "<builtin>" (BC.unpack sourceCode) of
          Left e -> error $ show e
          Right v -> v

  let ast1 = AST1.code $ fromMaybe (error "missing function in contract") $ Map.lookup "abcd" $ AST1.functions contract

  putStrLn $ " Compiling code:\n" ++ unlines (map (("  - " ++) . format) ast1)

  let ast2 =
        case compile1 globals ast1 of
          Left e -> error $ "compile1 error: " ++ e
          Right val -> val

  putStrLn $ " Compiling code:\n" ++ unlines (map (("  - " ++ ). show) ast2)

  () <-
    case compile ast2 of
      Left e -> error $ "compiler error: " ++ e
      Right c ->
        case Map.lookup "constructor" $ functions c of
          Nothing -> error "missing constructor"
          Just f -> do
            case getGetter f of
              Left e -> error $ "can't run the constructor: " ++ show e
              Right doit -> doit

  return $
    ExecResults
      0
      0
      Nothing
      []
      []
      []
      Nothing
      Set.empty
      Nothing
      Nothing
      SolidVM
      Map.empty
    
