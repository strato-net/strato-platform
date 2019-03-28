{-# LANGUAGE OverloadedStrings #-}

module Main where

import           Test.Hspec

import qualified Database.Spec as DB
import qualified UtilsSpec as US

main :: IO ()
main = hspec $ do
  DB.spec
  US.spec
