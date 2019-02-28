{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import HFlags
import Test.Hspec.Runner

import Executable.EVMFlags() -- for HFlags
import qualified Spec

predicate :: Path -> Bool
predicate = const True

main :: IO ()
main = do
  void $ $initHFlags "solid vm spec"
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
