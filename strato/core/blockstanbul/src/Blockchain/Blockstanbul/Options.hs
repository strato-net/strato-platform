{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Blockstanbul.Options
(
    flags_strictBlockstanbul,
    flags_test_mode_bypass_blockstanbul
)
where

import HFlags

defineFlag "strictBlockstanbul" (False :: Bool) "Strict Blockstanbul will crash on any authentication error"
defineFlag "test_mode_bypass_blockstanbul" (False :: Bool) "Bypass Blockstanbul consensus"

