{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
import Control.Monad
import HFlags
import Test.Hspec.Runner

import Executable.EVMFlags() -- for HFlags
import qualified Spec

predicate :: Path -> Bool
predicate (_, "can call methods of superclasses") = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "solid vm spec"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
