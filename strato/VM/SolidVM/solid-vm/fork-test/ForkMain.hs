{-# LANGUAGE TemplateHaskell #-}
module Main where

import qualified CaughtFailureForkSpec
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()
import Control.Monad (void)
import HFlags
import Test.Hspec (hspec)

main :: IO ()
main = do
  void $ $initHFlags "caught-failure fork regression"
  hspec CaughtFailureForkSpec.spec
