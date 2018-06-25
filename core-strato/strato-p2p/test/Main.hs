{-# LANGUAGE TemplateHaskell #-}
module Main where

import HFlags
import Test.Hspec.Runner

import qualified Spec

main :: IO ()
main = do
  _ <- $initHFlags "P2P unit tests"
  hspec Spec.spec
