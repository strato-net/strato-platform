
module Blockchain.AST1.FunctionDefinition where

import qualified Blockchain.AST1 as AST1

data FunctionDefinition =
  FunctionDefinition {
    code :: [AST1.Statement]
  }

