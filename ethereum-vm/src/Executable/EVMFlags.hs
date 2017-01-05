{-# LANGUAGE TemplateHaskell #-}
module Executable.EVMFlags where

import HFlags

defineFlag "mempoolLivenessCutoff" (30 :: Integer) "max age of a transaction in seconds that is valid for the mempool"
