import Test.Tasty

import qualified Parser
-- import qualified Import
-- import qualified Layout
import qualified Json

main :: IO ()
main = defaultMain tests

tests :: TestTree
tests = testGroup "solidity-abi tests" [
  Parser.test,
--  Import.test,
--  Layout.test,
  Json.test
  ]

