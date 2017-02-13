module Json (test) where

import Test.Common

import qualified Json.Imports as Imports

test :: TestTree
test = testGroup "json" [
  Imports.test
  ]
