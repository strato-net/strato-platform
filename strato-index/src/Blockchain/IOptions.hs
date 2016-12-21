{-# LANGUAGE TemplateHaskell #-}

module Blockchain.IOptions where

import HFlags

defineFlag "iStartingBlock" (-1::Integer) "block in kafka to start running the VM on"
