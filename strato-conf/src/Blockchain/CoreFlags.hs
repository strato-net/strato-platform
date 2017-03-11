{-# LANGUAGE TemplateHaskell #-}

module Blockchain.CoreFlags where

import HFlags

defineFlag "difficultyBomb" False "turn difficulty bomb on or off"
defineFlag "testnet" False "connect to testnet"
