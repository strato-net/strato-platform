{-# LANGUAGE TemplateHaskell #-}
module Executable.IndexerFlags where

import           HFlags

defineFlag "api_index_off" (False :: Bool) "Whether to run with api indexer off for better TPS"
