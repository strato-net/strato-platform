module Main where

import qualified AcrossLocalSpec
import Test.Hspec

main :: IO ()
main = hspec AcrossLocalSpec.spec
