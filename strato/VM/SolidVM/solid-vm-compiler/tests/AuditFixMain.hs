module Main where

import qualified ImportResolverAuditFixSpec as IRSpec
import Test.Hspec

main :: IO ()
main = hspec $ do
  IRSpec.spec
