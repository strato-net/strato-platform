module Main where

import qualified BLS12381Spec
import qualified BuiltinsSpec
import qualified CastsSpec
import qualified FunctionsSpec
import Test.Hspec

main :: IO ()
main = hspec $ do
  BuiltinsSpec.spec
  BLS12381Spec.spec
  FunctionsSpec.spec
  CastsSpec.spec
