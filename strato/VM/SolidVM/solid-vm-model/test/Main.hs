module Main where

import qualified StorageTest
import Test.Hspec

main :: IO ()
main = hspec $ do
  StorageTest.spec
