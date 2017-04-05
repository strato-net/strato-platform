{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.CoreFlags where

import HFlags

-- unclear if we need this now http://ghc.haskell.org/trac/ghc/ticket/7867
{-# RULES "make_this_orphan" id = id :: MakeThisOrphan -> MakeThisOrphan #-}

defineFlag "difficultyBomb" False "turn difficulty bomb on or off"
defineFlag "testnet" False "connect to testnet"
