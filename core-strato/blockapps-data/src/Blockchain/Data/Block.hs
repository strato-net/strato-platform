{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor      #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.Data.Block
  ( Block(..)
  , BestBlock(..)
  , WorldBestBlock(..)
  , Canonical(..)
  , Private(..)
  , blockDataLens
  , extraLens
  , setBlockNo
  , nextDifficulty
  , homesteadNextDifficulty
  , mkBlock
  , mkBlock'
  ) where


import Control.DeepSeq
import Control.Lens
import Control.Lens.TH (makeLensesFor)
import Data.Binary
import Data.Bits
import qualified Data.ByteString as BS
import Data.Data
import Data.List
import Data.Time.Clock
import Data.Time.Clock.POSIX
import GHC.Generics
import qualified Text.Colors as CL
import Text.Format

import Blockchain.Constants
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Util

data Block =
  Block{
    blockBlockData::BlockData,
    blockReceiptTransactions::[Transaction],
    blockBlockUncles::[BlockData],
    blockBlockHash :: Keccak256
    } deriving (Eq, Read, Show, Generic, Binary, NFData, Data)

makeLensesFor [("blockBlockData", "blockDataLens")] ''Block

extraLens :: Lens' Block BS.ByteString
extraLens = blockDataLens . extraDataLens

setBlockNo :: Integer -> Block -> Block
setBlockNo n blk = mkBlock' blk{blockBlockData = (blockBlockData blk){blockDataNumber = n}}

instance Format Block where
  format b@Block{blockBlockData=bd, blockReceiptTransactions=receipts, blockBlockUncles=uncles} =
    CL.blue ("Block #" ++ show (blockDataNumber bd)) ++ " " ++
    tab (format (blockHash b) ++ "\n" ++
         format bd ++
         (if null receipts
          then "        (no transactions)\n"
          else tab (intercalate "\n    " (format <$> receipts))) ++
         (if null uncles
          then "        (no uncles)"
          else tab ("Uncles:" ++ tab ("\n" ++ intercalate "\n    " (format <$> uncles)))))

instance RLPSerializable Block where
  rlpDecode (RLPArray [bd, RLPArray transactionReceipts, RLPArray uncles, bh]) =
    Block (rlpDecode bd) (rlpDecode <$> transactionReceipts) (rlpDecode <$> uncles) (rlpDecode bh)
  rlpDecode (RLPArray [bd, RLPArray transactionReceipts, RLPArray uncles]) =
    Block (rlpDecode bd) (rlpDecode <$> transactionReceipts) (rlpDecode <$> uncles) (hash $ rlpDecode bd)
  rlpDecode (RLPArray arr) = error ("rlpDecode for Block called on object with wrong amount of data, length arr = " ++ show arr)
  rlpDecode x = error ("rlpDecode for Block called on non block object: " ++ show x)

  rlpEncode Block{blockBlockData=bd, blockReceiptTransactions=receipts, blockBlockUncles=uncles, blockBlockHash=h} =
    RLPArray [rlpEncode bd, RLPArray (rlpEncode <$> receipts), RLPArray $ rlpEncode <$> uncles, rlpEncode h]

instance BlockLike BlockData Transaction Block where
    blockHeader       = blockBlockData
    blockTransactions = blockReceiptTransactions
    blockUncleHeaders = blockBlockUncles

    buildBlock bd txs us = mkBlock bd txs us

-- if useDiffBomb is False then the expAdjustment is not added.
nextDifficulty::Bool->Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
nextDifficulty useDiffBomb useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if not useDiffBomb then 0 else expAdjustment
    where
      nextDiff' =
          if round (utcTimeToPOSIXSeconds newTime) >=
                 (round (utcTimeToPOSIXSeconds oldTime) + difficultyDurationLimit useTestnet::Integer)
          then oldDifficulty - oldDifficulty `shiftR` difficultyAdjustment
          else oldDifficulty + oldDifficulty `shiftR` difficultyAdjustment
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

-- if useDiffBomb is False then the expAdjustment is not added
homesteadNextDifficulty::Bool->Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
homesteadNextDifficulty useDiffBomb _useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if not useDiffBomb then 0 else expAdjustment
    where
      block_timestamp = round (utcTimeToPOSIXSeconds newTime)::Integer
      parent_timestamp = round (utcTimeToPOSIXSeconds oldTime)::Integer
      nextDiff' = oldDifficulty + oldDifficulty `quot` 2048 * max (1 - (block_timestamp - parent_timestamp) `quot` 10) (-99)
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

mkBlock :: BlockData -> [Transaction] -> [BlockData] -> Block
mkBlock bData bTxs bUncles = Block bData bTxs bUncles (blockHeaderHash bData)

mkBlock' :: Block -> Block
mkBlock' b = b{blockBlockHash = blockHash b}

data BestBlock = BestBlock
  { bestBlockHash            :: Keccak256
  , bestBlockNumber          :: Integer
  , bestBlockTotalDifficulty :: Integer
  } deriving (Eq, Show)

newtype WorldBestBlock = WorldBestBlock { unWorldBestBlock :: BestBlock } deriving (Eq, Show)
newtype Canonical a = Canonical { unCanonical :: a } deriving (Functor)
newtype Private a = Private { unPrivate :: a } deriving (Functor)
