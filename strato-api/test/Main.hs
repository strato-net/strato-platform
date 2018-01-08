module Main where


import           Data.Maybe
import           Hspec.Formatters.Blaze (blazeFormatter)
import           System.IO
import           Test.Hspec.Runner

import qualified Spec

main :: IO ()
main = hspecWith defaultConfig {configFormatter = Just (blazeFormatter "static/css/bootstrap.css")} Spec.spec
