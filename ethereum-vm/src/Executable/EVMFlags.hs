{-# LANGUAGE TemplateHaskell #-}
module Executable.EVMFlags where

import HFlags

defineFlag "mempoolLivenessCutoff" (30 :: Integer) "max age of a transaction in seconds that is valid for the mempool"
defineFlag "useTestnet" False "Change difficulty computation for ethdev testnet"
defineFlag "newRBIBBehavior" True "Use new replaceBestIfBetter behavior"