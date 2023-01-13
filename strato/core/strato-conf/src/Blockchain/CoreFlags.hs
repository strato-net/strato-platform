{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-inline-rule-shadowing #-}

module Blockchain.CoreFlags where

import           HFlags

-- unclear if we need this now http://ghc.haskell.org/trac/ghc/ticket/7867
{-# RULES "make_this_orphan" id = id :: MakeThisOrphan -> MakeThisOrphan #-}

defineFlag "difficultyBomb" False "turn difficulty bomb on or off"
defineFlag "network" (""::String) "Choose a network to join"
defineFlag "networkID" (-1::Int) "set a custom network ID for the client"
defineFlag "testnet" False "connect to testnet"
