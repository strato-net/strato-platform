module Main where

import qualified Spec
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate = const True

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
