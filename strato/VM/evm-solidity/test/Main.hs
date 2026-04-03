{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

import qualified Spec
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) Spec.spec
