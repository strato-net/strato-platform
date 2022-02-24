{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Sequencer.Options where

import           HFlags

defineFlag "blockstanbulEventCacheSize" (2000 :: Int) "Number of Blockstanbul events to cache for network performance"