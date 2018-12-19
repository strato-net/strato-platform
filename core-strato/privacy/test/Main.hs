module Main where

import Test.Hspec.Runner
import qualified Spec

predicate :: Path -> Bool
predicate = const True

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
