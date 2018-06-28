module Main where

import Test.Hspec.Runner
import qualified Spec

predicate :: Path -> Bool
predicate (p0:_, _) = p0 == "Message"
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
