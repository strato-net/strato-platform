{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

module Main where

import BlockApps.Logging ()
import Control.Monad
import HFlags
import qualified Spec
import Test.Hspec.Runner

-- For --minLogLevel

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "blockstanbul-test"
  hspecWith (configAddFilter predicate defaultConfig) $ Spec.spec
