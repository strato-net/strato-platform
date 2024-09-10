{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Blockstanbul.Options
(
    flags_strictBlockstanbul
)
where

import HFlags

defineFlag "strictBlockstanbul" (False :: Bool) "Strict Blockstanbul will crash on any authentication error"

