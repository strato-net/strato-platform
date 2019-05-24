{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
import Control.Monad
import HFlags
import Test.Hspec.Runner

import Blockchain.VMOptions() -- for HFlags
import Executable.EVMFlags() -- for HFlags
import qualified Spec

predicate :: Path -> Bool
predicate (_, "can pass arrays by reference to functions") = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "solid vm spec"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
