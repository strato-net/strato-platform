
module Blockchain.AST2.FunctionDefinition where

import qualified Blockchain.AST2 as AST2

data FunctionDefinition =
  FunctionDefinition {
    code :: [AST2.Statement]
  }

