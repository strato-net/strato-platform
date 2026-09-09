import GenerationalCacheSpec
import Test.Hspec

-- StorageSpec is not wired in: it no longer compiles against the current
-- model (Blockchain.Strato.Model.Account and BAccount are gone) and predates
-- the storage-path work. Left in the tree for reference.

main :: IO ()
main = hspec generationalCacheSpec
