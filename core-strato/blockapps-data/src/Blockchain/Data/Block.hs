
module Blockchain.Data.Block (
  Block(..),
  blockDataLens
  ) where

import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction

import           Control.Lens.TH                         (makeLensesFor)

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData]
    } deriving (Eq, Read, Show)

makeLensesFor [("blockBlockData", "blockDataLens")] ''Block
