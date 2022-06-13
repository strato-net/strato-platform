{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
module Main where

import HFlags
import Test.Hspec.Runner

import qualified Spec

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  _ <- $initHFlags "P2P unit tests"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
