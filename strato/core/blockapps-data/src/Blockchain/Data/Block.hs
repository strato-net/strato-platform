{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.Data.Block
  ( Block (..),
    BestBlock (..),
    BestSequencedBlock (..),
    WorldBestBlock (..),
    Canonical (..),
    Private (..),
    setBlockNo,
    createBlockFromHeaderAndBody,
  )
where

import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Binary
import Data.List
import GHC.Generics
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

data Block = Block
  { blockBlockData :: BlockHeader,
    blockReceiptTransactions :: [Transaction],
    blockBlockUncles :: [BlockHeader]
  }
  deriving (Eq, Show, Generic, Binary, NFData)

setBlockNo :: Integer -> Block -> Block
setBlockNo n blk = blk {blockBlockData = (blockBlockData blk) {BlockHeader.number = n}}

instance Format Block where
  format b@Block {blockBlockData = bd, blockReceiptTransactions = receipts, blockBlockUncles = uncles} =
    CL.blue ("Block #" ++ show (BlockHeader.number bd)) ++ " "
      ++ tab'
        ( format (blockHash b) ++ "\n"
            ++ format bd
            ++ ( if null receipts
                   then "        (no transactions)\n"
                   else tab' (intercalate "\n    " (format <$> receipts))
               )
            ++ ( if null uncles
                   then "        (no uncles)"
                   else tab' ("Uncles:" ++ tab' ("\n" ++ intercalate "\n    " (format <$> uncles)))
               )
        )

instance RLPSerializable Block where
  rlpDecode (RLPArray [bd, RLPArray transactionReceipts, RLPArray uncles]) =
    Block (rlpDecode bd) (rlpDecode <$> transactionReceipts) (rlpDecode <$> uncles)
  rlpDecode (RLPArray arr) = error ("rlpDecode for Block called on object with wrong amount of data, length arr = " ++ show arr)
  rlpDecode x = error ("rlpDecode for Block called on non block object: " ++ show x)

  rlpEncode Block {blockBlockData = bd, blockReceiptTransactions = receipts, blockBlockUncles = uncles} =
    RLPArray [rlpEncode bd, RLPArray (rlpEncode <$> receipts), RLPArray $ rlpEncode <$> uncles]

instance {-# OVERLAPPING #-} RLPHashable Block where
  rlpHash = rlpHash . blockBlockData

instance HasIstanbulExtra Block where
  getIstanbulExtra     = getIstanbulExtra . blockBlockData
  putIstanbulExtra i b = b{blockBlockData = putIstanbulExtra i $ blockBlockData b}

instance BlockLike BlockHeader Transaction Block where
  blockHeader = blockBlockData
  blockTransactions = blockReceiptTransactions
  blockUncleHeaders = blockBlockUncles

  buildBlock bd txs us = Block bd txs us

data BestBlock = BestBlock
  { bestBlockHash :: Keccak256,
    bestBlockNumber :: Integer
  }
  deriving (Eq, Show)

newtype BestSequencedBlock = BestSequencedBlock {unBestSequencedBlock :: BestBlock} deriving (Eq, Show)

newtype WorldBestBlock = WorldBestBlock {unWorldBestBlock :: BestBlock} deriving (Eq, Show)

newtype Canonical a = Canonical {unCanonical :: a} deriving (Functor)

newtype Private a = Private {unPrivate :: a} deriving (Functor)

createBlockFromHeaderAndBody :: BlockHeader -> ([Transaction], [BlockHeader]) -> Block
createBlockFromHeaderAndBody header (transactions, uncles) =
  Block header transactions uncles
