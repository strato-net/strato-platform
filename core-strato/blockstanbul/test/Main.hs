{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
module Main where

import Blockchain.Output() -- For --minLogLevel
import Control.Monad
import HFlags
import Test.Hspec.Runner
import qualified Spec

predicate :: Path -> Bool
predicate _ = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "blockstanbul-test"
  hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
