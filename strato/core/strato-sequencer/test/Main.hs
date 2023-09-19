{-# LANGUAGE TemplateHaskell #-}

module Main where

import HFlags
import qualified Spec
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate _ = True

main :: IO ()
main = do
  _ <- $initHFlags "Sequencer unit tests"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
