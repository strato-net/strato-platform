{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.Data.BlockSummary
  ( BlockSummary (..),
    blockHeaderToBSum,
  )
where

import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Keccak256
import Data.Time
import Data.Time.Clock.POSIX

data BlockSummary = BlockSummary
  { bSumParentHash :: Keccak256,
    bSumDifficulty :: Difficulty,
    bSumTotalDifficulty :: Difficulty,
    bSumStateRoot :: MP.StateRoot,
    bSumGasLimit :: Integer,
    bSumTimestamp :: UTCTime,
    bSumNumber :: Integer,
    bSumTxCount :: Integer
  }

blockHeaderToBSum :: BlockHeader -> Difficulty -> Integer -> BlockSummary
blockHeaderToBSum b totalDiff txCount =
  BlockSummary
    { bSumParentHash = parentHash b,
      bSumDifficulty = getBlockDifficulty b,
      bSumTotalDifficulty = totalDiff,
      bSumStateRoot = stateRoot b,
      bSumGasLimit = getBlockGasLimit b,
      bSumTimestamp = timestamp b,
      bSumNumber = number b,
      bSumTxCount = txCount
    }

instance RLPSerializable BlockSummary where
  rlpEncode (BlockSummary p d td sr gl ts n txcnt) =
    RLPArray
      [ rlpEncode p,
        rlpEncode d,
        rlpEncode td,
        rlpEncode sr,
        rlpEncode gl,
        rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
        rlpEncode n,
        rlpEncode txcnt
      ]
  rlpDecode (RLPArray [p, d, td, sr, gl, ts, n, txcnt]) =
    BlockSummary
      { bSumParentHash = rlpDecode p,
        bSumDifficulty = rlpDecode d,
        bSumTotalDifficulty = rlpDecode td,
        bSumStateRoot = rlpDecode sr,
        bSumGasLimit = rlpDecode gl,
        bSumTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
        bSumNumber = rlpDecode n,
        bSumTxCount = rlpDecode txcnt
      }
  rlpDecode x = error $ "rlpDecode for BlockSummary called with data of wrong format: " ++ show x
