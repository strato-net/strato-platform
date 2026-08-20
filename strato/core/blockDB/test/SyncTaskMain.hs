module Main (main) where

import qualified SyncTaskSpec
import Test.Hspec

main :: IO ()
main = hspec SyncTaskSpec.spec
