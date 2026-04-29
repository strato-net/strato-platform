module Main where

import qualified OptimizerAuditFixSpec as OptSpec
import Test.Hspec

main :: IO ()
main = hspec $ do
  OptSpec.spec
