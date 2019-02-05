import Test.Hspec.Runner
import qualified Spec

predicate :: Path -> Bool
predicate ("BlockApps.Ethereum":"sign transaction":[], "correctly signs transaction (1)") = True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
