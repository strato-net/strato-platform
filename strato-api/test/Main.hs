module Main where

import           Prelude
import           Test.Hspec.Runner

import qualified Spec

-- Used to filter which tests are being run
predicate :: Path -> Bool
predicate _ = True

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
