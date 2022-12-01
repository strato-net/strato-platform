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

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlagsDependentDefaults "debugger spec" (const $ const $ const $ [("requireCerts", "False")])
  hspecWith (configAddFilter predicate defaultConfig)Spec.spec
