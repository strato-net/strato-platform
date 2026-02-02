module Main where

import qualified BasicValueStringTest
import qualified StorageTest
import Test.Hspec

main :: IO ()
main = hspec $ do
  StorageTest.spec
  BasicValueStringTest.spec
