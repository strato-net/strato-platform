{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM2022 (
  create
  ) where

import Control.Lens
import Control.Monad
import qualified Data.ByteString.Char8 as BC
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import Data.IORef
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Set as Set
--import Text.Parsec

import qualified Blockchain.AST1 as AST1
import qualified Blockchain.AST1.Contract as AST1
import qualified Blockchain.AST1.FunctionDefinition as AST1
import Blockchain.AST2
import Blockchain.Compiler
import Blockchain.Contract
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
--import Blockchain.Parser
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Type (Type)
import qualified Blockchain.Type as Type
import qualified SolidVM.Model.CodeCollection as AST0
import SolidVM.Solidity.Parse

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
  
  let ccOrError = compileSourceNoInheritance $ Map.fromList [("", Text.pack $ BC.unpack $ sourceCode)]

  let cc =
        case ccOrError of
          Left e -> error $ show e
          Right v -> v

  let contract1 = convertContract(fromMaybe (error "no contract named SomeContract") $ Map.lookup "SomeContract" (cc^.AST0.contracts))
{-  
  let contract =
        case parse parseContract "<builtin>" (BC.unpack sourceCode) of
          Left e -> error $ show e
          Right v -> v
-}
  
  let c = compile $ compile1 c globals contract1

  () <-
    case Map.lookup "abcd" $ functions c of
      Nothing -> error "missing function abcd"
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
    






convertContract :: AST0.Contract -> AST1.Contract
convertContract (AST0.Contract {AST0._functions=fs}) =
  AST1.Contract "SomeContract" $ fmap convertFunction fs

convertFunction :: AST0.Func -> AST1.FunctionDefinition
convertFunction AST0.Func{AST0.funcContents=Just statements} =
  AST1.FunctionDefinition {AST1.code=map convertStatement statements}
convertFunction _ = error "function needs statements"

convertStatement :: AST0.Statement -> AST1.Statement
convertStatement (AST0.SimpleStatement (AST0.ExpressionStatement (AST0.Binary _ "=" l r)) _) = AST1.Assign (convertExpression l) (convertExpression r)
convertStatement (AST0.SimpleStatement (AST0.ExpressionStatement e) _) = AST1.ExpressionStatement $ convertExpression e
--  AST1.ExpressionStatement (AST1.Function name $ map convertExpression args)


--convertStatement (AST0.SimpleStatement (AST0.ExpressionStatement x) _) = error $ "function name: " ++ show x

convertStatement x = error $ "unhandled case in convertStatement: " ++ show x

convertExpression :: AST0.Expression -> AST1.Expression
convertExpression (AST0.NumberLiteral _ x _) = AST1.Integer x
convertExpression (AST0.StringLiteral _ x) = AST1.String x
convertExpression (AST0.Variable _ name) = AST1.Variable name
convertExpression (AST0.Binary _ "+" l r) = AST1.Function "plus" [convertExpression l, convertExpression r]
convertExpression (AST0.FunctionCall _ (AST0.Variable _ name) (AST0.OrderedArgs args)) = AST1.Function name $ map convertExpression args
convertExpression (AST0.MemberAccess _ e "length") = AST1.Function "length" [convertExpression e]
convertExpression x = error $ "unsupported case in convertExpression: " ++ show x

