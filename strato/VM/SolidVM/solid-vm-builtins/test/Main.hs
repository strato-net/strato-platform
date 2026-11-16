{-# LANGUAGE TemplateHaskell #-}
module Main where

import qualified BLS12381Spec
import qualified BuiltinsSpec
import qualified CastsSpec
import qualified FunctionsSpec
import Control.Monad (void)
import HFlags
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()
import System.Environment (withArgs)
import Test.Hspec

main :: IO ()
main = do
  void $ withArgs [] $ $initHFlags "SolidVM builtin tests"
  hspec $ do
    BuiltinsSpec.spec
    BLS12381Spec.spec
    FunctionsSpec.spec
    CastsSpec.spec
