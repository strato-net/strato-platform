{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

module Main where

import Blockchain.Options ()
import Blockchain.VMOptions ()
import Executable.EVMFlags ()
import HFlags
import qualified Spec
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  _ <- $initHFlagsDependentDefaults "P2P unit tests" (const $ const $ const $ [("requireCerts", "False")])
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
