{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}
import Control.Monad
import HFlags
import Test.Hspec.Runner

import Blockchain.VMOptions() -- for HFlags
import Executable.EVMFlags() -- for HFlags
import qualified Spec
import qualified DetectorsSpec
import qualified TypecheckerSpec
import qualified FuzzerSpec
import qualified ParserSpec
import qualified PragmaSpec

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlags "solid vm spec"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
  hspecWith (configAddFilter predicate defaultConfig) DetectorsSpec.spec
  hspecWith (configAddFilter predicate defaultConfig) TypecheckerSpec.spec
  hspecWith (configAddFilter predicate defaultConfig) FuzzerSpec.spec
  hspecWith (configAddFilter predicate defaultConfig) ParserSpec.spec
  hspecWith (configAddFilter predicate defaultConfig) PragmaSpec.spec

