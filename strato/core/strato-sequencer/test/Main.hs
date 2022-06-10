{-# LANGUAGE TemplateHaskell #-}
module Main where

import   HFlags
import   Test.Hspec.Runner

import   qualified Spec

predicate :: Path -> Bool
predicate _ = True

main :: IO ()
main = do
  _ <- $initHFlags "Sequencer unit tests"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
