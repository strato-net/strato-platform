{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Data.Block
  ( Block(..)
  , BestBlock(..)
  , WorldBestBlock(..)
  , Canonical(..)
  , Private(..)
  , blockDataLens
  , extraLens
  , setBlockNo
  ) where

import Control.DeepSeq
import Data.Binary
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.SHA
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

data BestBlock = BestBlock
  { bestBlockHash            :: SHA
  , bestBlockNumber          :: Integer
  , bestBlockTotalDifficulty :: Integer
  } deriving (Eq, Show)

newtype WorldBestBlock = WorldBestBlock { unWorldBestBlock :: BestBlock } deriving (Eq, Show)
newtype Canonical a = Canonical { unCanonical :: a } deriving (Functor)
newtype Private a = Private { unPrivate :: a } deriving (Functor)
