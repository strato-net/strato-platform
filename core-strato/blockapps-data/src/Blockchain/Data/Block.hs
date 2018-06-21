
module Blockchain.Data.Block (
  Block(..)
  ) where

import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData]
    } deriving (Eq, Read, Show)

