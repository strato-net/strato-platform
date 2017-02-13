module Parser (test) where

import Test.Common

import qualified Parser.BasicTypes as BasicTypes
import qualified Parser.CompositeTypes as CompositeTypes
import qualified Parser.Functions as Functions
-- import qualified Parser.DeclarationModifiers as DeclarationModifiers
-- import qualified Parser.BaseContracts as BaseContracts
-- import qualified Parser.Contracts as Contracts

test :: TestTree
test = testGroup "parser" [
  BasicTypes.test,
  CompositeTypes.test,
  Functions.test
--  DeclarationModifiers.test,
--  BaseContracts.test,
--  Contracts.test
  ]
