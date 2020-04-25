{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE TypeSynonymInstances       #-}
{-# LANGUAGE UndecidableInstances       #-}

module Blockchain.Data.BlockSummary (
    BlockSummary(..),
    blockHeaderToBSum
  ) where

import           Data.Time
import           Data.Time.Clock.POSIX

import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.Strato.Model.SHA

data BlockSummary = BlockSummary {
                      bSumParentHash      :: SHA,
                      bSumDifficulty      :: Difficulty,
                      bSumTotalDifficulty :: Difficulty,
                      bSumStateRoot       :: MP.StateRoot,
                      bSumGasLimit        :: Integer,
                      bSumTimestamp       :: UTCTime,
                      bSumNumber          :: Integer,
                      bSumTxCount         :: Integer
  }

blockHeaderToBSum :: BlockData->Difficulty->Integer->BlockSummary
blockHeaderToBSum b totalDiff txCount =
    BlockSummary {
      bSumParentHash = blockDataParentHash b,
      bSumDifficulty = blockDataDifficulty b,
      bSumTotalDifficulty = totalDiff,
      bSumStateRoot = blockDataStateRoot b,
      bSumGasLimit = blockDataGasLimit b,
      bSumTimestamp = blockDataTimestamp b,
      bSumNumber = blockDataNumber b,
      bSumTxCount = txCount
    }

instance RLPSerializable BlockSummary where
  rlpEncode (BlockSummary p d td sr gl ts n txcnt) =
    RLPArray [
      rlpEncode p,
      rlpEncode d,
      rlpEncode td,
      rlpEncode sr,
      rlpEncode gl,
      rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
      rlpEncode n,
      rlpEncode txcnt
      ]
  rlpDecode (RLPArray [p, d, td, sr, gl, ts, n, txcnt]) =
    BlockSummary {
      bSumParentHash = rlpDecode p,
      bSumDifficulty = rlpDecode d,
      bSumTotalDifficulty = rlpDecode td,
      bSumStateRoot = rlpDecode sr,
      bSumGasLimit = rlpDecode gl,
      bSumTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
      bSumNumber = rlpDecode n,
      bSumTxCount = rlpDecode txcnt
      }
  rlpDecode x = error $ "rlpDecode for BlockSummary called with data of wrong format: " ++ show x
