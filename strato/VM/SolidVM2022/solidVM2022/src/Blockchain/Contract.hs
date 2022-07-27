
module Blockchain.Contract where

import Data.Map (Map)
--import qualified Data.Map as Map

import qualified Blockchain.AST2 as AST2


data Contract=
  Contract {
    functions::Map String AST2.AnyFunction
  }



