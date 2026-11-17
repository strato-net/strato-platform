{-# LANGUAGE TemplateHaskell #-}
module Main where

import qualified ArgReferenceForkSpec
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()
import Control.Monad (void)
import HFlags
import Test.Hspec (hspec)

main :: IO ()
main = do
  void $ $initHFlags "argument-reference fork regression"
  hspec ArgReferenceForkSpec.spec
