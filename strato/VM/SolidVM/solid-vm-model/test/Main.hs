module Main where

import qualified BasicValueStringTest
import qualified StorageTest
import qualified ValueBinaryTest
import Test.Hspec

main :: IO ()
main = hspec $ do
  StorageTest.spec
  BasicValueStringTest.spec
  ValueBinaryTest.spec
