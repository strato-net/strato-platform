module Main (main) where

import qualified Properties
import Test.Framework (defaultMain)
import qualified Tests

main :: IO ()
main = defaultMain $ Properties.properties ++ Tests.tests
