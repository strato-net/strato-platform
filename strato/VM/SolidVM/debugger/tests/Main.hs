{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

import Control.Monad
import Debugger ()
import HFlags
import qualified Spec
import Test.Hspec.Runner

main :: IO ()
main = do
  void $ $initHFlags "debugger spec"
  hspecWith defaultConfig Spec.spec
