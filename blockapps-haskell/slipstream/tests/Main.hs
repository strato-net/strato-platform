import Spec (spec)
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate ("OutputData":_, _) = True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) spec
