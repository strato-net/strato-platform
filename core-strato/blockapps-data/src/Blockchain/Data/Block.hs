{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Data.Block (
  Block(..),
  blockDataLens
  ) where

import Data.Binary
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import GHC.Generics

import Control.Lens.TH (makeLensesFor)

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData]
    } deriving (Eq, Read, Show, Generic)

makeLensesFor [("blockBlockData", "blockDataLens")] ''Block

instance Binary Block where
