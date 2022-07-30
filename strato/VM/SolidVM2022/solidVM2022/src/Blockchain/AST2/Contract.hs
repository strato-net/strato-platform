
module Blockchain.AST2.Contract where

import Data.Map (Map)

import qualified Blockchain.AST2.FunctionDefinition as AST2

data Contract = Contract {
    name :: String,
    functions :: Map String AST2.FunctionDefinition
  }

