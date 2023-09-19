{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

import BlockApps.Logging ()
import HFlags
import Spec (spec)
import Test.Hspec.Runner

-- For HFlags

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = do
  _ <- $initHFlags "slipstream-tests"
  hspecWith (configAddFilter predicate defaultConfig) spec
