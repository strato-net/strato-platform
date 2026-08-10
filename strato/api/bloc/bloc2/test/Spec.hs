{-# LANGUAGE OverloadedStrings #-}

module Main where

import Test.Hspec
import qualified SimulateSpec as SS
import qualified TxMarshalSpec as TMS
import qualified UtilsSpec as US

main :: IO ()
main = hspec $ do
  US.spec
  TMS.spec
  SS.spec
