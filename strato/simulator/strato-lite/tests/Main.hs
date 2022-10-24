{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
import Blockchain.Options()
import Blockchain.VMOptions()
import Control.Monad
import Executable.EVMFlags()
import HFlags
import Test.Hspec.Runner

import qualified Spec

main :: IO ()
main = do
  void $ $initHFlags "debugger spec"
  hspecWith defaultConfig Spec.spec
