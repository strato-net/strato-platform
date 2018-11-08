{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Data.Block (
  Block(..),
  blockDataLens,
  extraLens,
  setBlockNo
  ) where

import Control.DeepSeq
import Data.Binary
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import GHC.Generics

import Control.Lens
import Control.Lens.TH (makeLensesFor)
import qualified Data.ByteString as BS

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData]
    } deriving (Eq, Read, Show, Generic)

makeLensesFor [("blockBlockData", "blockDataLens")] ''Block

extraLens :: Lens' Block BS.ByteString
extraLens = blockDataLens . extraDataLens

setBlockNo :: Integer -> Block -> Block
setBlockNo n blk = blk{blockBlockData = (blockBlockData blk){blockDataNumber = n}}

instance Binary Block where
instance NFData Block
