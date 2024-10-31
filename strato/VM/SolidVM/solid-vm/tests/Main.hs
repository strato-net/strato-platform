{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

import Blockchain.VMOptions ()
import Control.Monad
-- for HFlags
import Blockchain.Strato.Model.Options ()
import Executable.EVMFlags ()
import HFlags
-- for HFlags
import qualified Spec
import Test.Hspec.Runner

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  void $ $initHFlagsDependentDefaults "solid vm spec" (const $ const $ const $ [("requireCerts", "True")])
  hspecWith (configAddFilter predicate defaultConfig) Spec.spec
