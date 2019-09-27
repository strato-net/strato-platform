{-# LANGUAGE DeriveDataTypeable #-}
module Blockchain.Data.Block (
  Block(..),
  blockDataLens,
  extraLens,
  setBlockNo
  ) where


import Control.DeepSeq
import Control.Lens
import Control.Lens.TH (makeLensesFor)
import Data.Binary
import qualified Data.ByteString as BS
import Data.Data
import GHC.Generics

import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData]
    } deriving (Eq, Read, Show, Generic, Binary, NFData, Data)

makeLensesFor [("blockBlockData", "blockDataLens")] ''Block

extraLens :: Lens' Block BS.ByteString
extraLens = blockDataLens . extraDataLens

setBlockNo :: Integer -> Block -> Block
setBlockNo n blk = blk{blockBlockData = (blockBlockData blk){blockDataNumber = n}}
