{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
import Test.Hspec.Runner
import qualified Spec

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
