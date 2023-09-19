{-# LANGUAGE OverloadedStrings #-}

module Main where

import Test.Hspec
import qualified UtilsSpec as US

main :: IO ()
main = hspec $ do
  US.spec
