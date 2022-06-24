{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
module Main where

import Control.Monad
import HFlags
import Test.Hspec.Runner
import qualified Spec

import BlockApps.Logging() -- For --minLogLevel

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "blockstanbul-test"
  hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
