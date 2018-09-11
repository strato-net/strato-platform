{-# LANGUAGE TemplateHaskell #-}
module Blockchain.VMMetrics where

import           Control.Monad.Stats

defineCounter "ctr.vm.blocks.processed"         []
defineCounter "ctr.vm.blocks.mined"             []
defineCounter "ctr.vm.blocks.unmined"           []
defineCounter "ctr.vm.blocks.valid"             []
defineCounter "ctr.vm.blocks.invalid"           []
defineCounter "ctr.vm.txs.processed"            []
defineCounter "ctr.vm.txs.successful"           []
defineCounter "ctr.vm.txs.unsuccessful"         []
defineCounter "ctr.vm.tx.call"                  []
defineCounter "ctr.vm.tx.creation"              []
defineTimer "time.vm.tx.mining"                 []
defineTimer "time.vm.tx.mined"                  []
defineTimer "time.vm.block.insertion.mined"     []
defineTimer "time.vm.block.insertion.unmined"   []
