{-# LANGUAGE OverloadedStrings #-}

module Main where

import           Test.Hspec

import qualified Database.Spec as DB

main :: IO ()
main = hspec $ do
  DB.spec
