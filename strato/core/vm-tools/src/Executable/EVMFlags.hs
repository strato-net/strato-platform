{-# LANGUAGE TemplateHaskell #-}

module Executable.EVMFlags where

import HFlags

defineFlag "maxTxsPerBlock" (500 :: Integer) "max number of transactions that may be put into a block"
defineFlag "mempoolLivenessCutoff" (60 :: Integer) "max age of a transaction in seconds that is valid for the mempool"

defineFlag "ldbCacheSize" (33554432 {- 32 MiB -} :: Int) "size in bytes of LDB block cache per namespace (0 = default of 8MB)"
defineFlag "ldbBlockSize" (4096 {-  4 KiB-} :: Int) "size in bytes of LDB block packing per namespace (default is 4096)"
defineFlag "blockstanbul" (False :: Bool) "Blockstanbul enabling flag"
