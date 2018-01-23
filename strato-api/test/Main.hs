module Main where

import           Prelude
import           Test.Hspec.Runner

import Debug.Trace
import qualified Spec

predicate :: Path -> Bool
predicate x@("Handler.Json":"JSON Query string":_, _)= trace (show x) True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
