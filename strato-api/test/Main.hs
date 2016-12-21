module Main where


import Test.Hspec.Runner
import Hspec.Formatters.Blaze (blazeFormatter)
import System.IO
import Data.Maybe
import Control.Monad

import qualified Spec

main :: IO ()
main = do
    res <- hspecWithResult defaultConfig {configFormatter = Just (blazeFormatter "static/css/bootstrap.css")} Spec.spec
    return ()