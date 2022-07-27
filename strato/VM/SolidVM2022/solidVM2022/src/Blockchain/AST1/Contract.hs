
module Blockchain.AST1.Contract where

import Data.Map (Map)

import qualified Blockchain.AST1.FunctionDefinition as AST1

data Contract = Contract {
    name :: String,
    functions :: Map String AST1.FunctionDefinition
  }
