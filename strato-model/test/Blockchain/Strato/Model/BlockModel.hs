{-|

Module      : Blockchain.Strato.Model.Block
Description : Block Data Model
Copyright   : (c) BlockApps Inc., 2017
Stability   : experimental
Portability : POSIX

More or less the content of BlockDB.hs in blockapps-data, the code
is reproduced and tested here to avoid introducing a dependency.

-}

{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.Strato.Model.BlockModel
(
  Block(..),
  blockHash,
  blockHeaderHash,
  nextDifficulty,
  homesteadNextDifficulty,
  createBlockFromHeaderAndBody
) where

import           Data.Bits

import qualified Data.Map                                 as M
import           Data.Maybe

import           Data.Time.Clock
import           Data.Time.Clock.POSIX

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.BlockHeaderModel
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Constants
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.TransactionModel

type Difficulty = Integer

{-
data BlockData =
  BlockData {
    parentHash :: SHA,
    unclesHash :: SHA,
    coinbase :: Address,
    stateRoot :: StateRoot,
    transactionsRoot :: StateRoot,
    receiptsRoot :: StateRoot,
    logBloom :: B.ByteString,
    difficulty :: Integer,
    number :: Integer,
    gasLimit :: Integer,
    gasUsed :: Integer,
    timestamp :: UTCTime,
    extraData :: Integer,
    nonce :: Word64,
    mixHash :: SHA
  } deriving (Show, Read, Eq)
-}
data Block =
  Block {
    blockData           :: BlockHeader,
    receiptTransactions :: [Transaction],
    blockUncles         :: [BlockHeader]
  } deriving (Show, Read, Eq)

nextDifficulty::Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
nextDifficulty useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if useTestnet then 0 else expAdjustment
    where
      nextDiff' =
          if round (utcTimeToPOSIXSeconds newTime) >=
                 (round (utcTimeToPOSIXSeconds oldTime) + difficultyDurationLimit )
          then oldDifficulty - oldDifficulty `shiftR` difficultyAdjustment
          else oldDifficulty + oldDifficulty `shiftR` difficultyAdjustment
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

homesteadNextDifficulty::Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
homesteadNextDifficulty useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if useTestnet then 0 else expAdjustment
    where
      block_timestamp = round (utcTimeToPOSIXSeconds newTime)::Integer
      parent_timestamp = round (utcTimeToPOSIXSeconds oldTime)::Integer
      nextDiff' = oldDifficulty + oldDifficulty `quot` 2048 * max (1 - (block_timestamp - parent_timestamp) `quot` 10) (-99)
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

addDifficulties::M.Map SHA Integer->[(SHA, Integer, SHA)]->M.Map SHA Integer
addDifficulties dm [] = dm
addDifficulties dm ((hash', blockDifficulty, parentHash'):rest) =
  let parentDifficulty = fromMaybe (error $ "missing hash in difficulty map in addDifficulties: " ++ (show parentHash') ++ ", hash=" ++ (show hash')) $ M.lookup parentHash' dm
      dm' = M.insert hash' (parentDifficulty + blockDifficulty) dm
  in addDifficulties dm' rest


instance RLPSerializable Block where
  rlpDecode (RLPArray [bd, RLPArray transactionReceipts, RLPArray uncles]) =
    Block (rlpDecode bd) (rlpDecode <$> transactionReceipts) (rlpDecode <$> uncles)
  rlpDecode (RLPArray arr) = error ("rlpDecode for Block called on object with wrong amount of data, length arr = " ++ show arr)
  rlpDecode x = error ("rlpDecode for Block called on non block object: " ++ show x)

  rlpEncode Block{blockData=h, receiptTransactions=receipts, blockUncles=uncles} =
    RLPArray [rlpEncode h, RLPArray (rlpEncode <$> receipts), RLPArray $ rlpEncode <$> uncles]

{-
instance RLPSerializable BlockData where
  rlpDecode (RLPArray [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15]) =
    BlockData {
      parentHash = rlpDecode v1,
      unclesHash = rlpDecode v2,
      coinbase = rlpDecode v3,
      stateRoot = rlpDecode v4,
      transactionsRoot = rlpDecode v5,
      receiptsRoot = rlpDecode v6,
      logBloom = rlpDecode v7,
      difficulty = rlpDecode v8,
      number = rlpDecode v9,
      gasLimit = rlpDecode v10,
      gasUsed = rlpDecode v11,
      timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode v12,
      extraData = rlpDecode v13,
      mixHash = rlpDecode v14,
      nonce = bytesToWord64 $ B.unpack $ rlpDecode v15
      }
  rlpDecode (RLPArray arr) = error ("Error in rlpDecode for Block: wrong number of items, expected 15, got " ++ show (length arr) ++ ", arr = " ++ show (pretty arr))
  rlpDecode x = error ("rlp2BlockData called on non block object: " ++ show x)


  rlpEncode bd =
    RLPArray [
      rlpEncode $ blockDataParentHash bd,
      rlpEncode $ blockDataUnclesHash bd,
      rlpEncode $ blockDataCoinbase bd,
      rlpEncode $ blockDataStateRoot bd,
      rlpEncode $ blockDataTransactionsRoot bd,
      rlpEncode $ blockDataReceiptsRoot bd,
      rlpEncode $ blockDataLogBloom bd,
      rlpEncode $ blockDataDifficulty bd,
      rlpEncode $ blockDataNumber bd,
      rlpEncode $ blockDataGasLimit bd,
      rlpEncode $ blockDataGasUsed bd,
      rlpEncode (round $ utcTimeToPOSIXSeconds $ blockDataTimestamp bd::Integer),
      rlpEncode $ blockDataExtraData bd,
      rlpEncode $ blockDataMixHash bd,
      rlpEncode $ B.pack $ word64ToBytes $ blockDataNonce bd
      ]
-}
instance BlockLike BlockHeader Transaction Block where
    blockHeader       = blockHeader
    blockTransactions = receiptTransactions
    blockUncleHeaders = blockUncles

    buildBlock = Block

createBlockFromHeaderAndBody::BlockHeader->([Transaction], [BlockHeader])->Block
createBlockFromHeaderAndBody header (transactions, uncles) =
  Block header transactions uncles

