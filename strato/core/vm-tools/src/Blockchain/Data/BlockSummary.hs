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
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Keccak256
import Data.Time
import Data.Time.Clock.POSIX

data BlockSummary = BlockSummary
  { bSumParentHash :: Keccak256,
    bSumStateRoot :: MP.StateRoot,
    bSumGasLimit :: Integer,
    bSumTimestamp :: UTCTime,
    bSumNumber :: Integer,
    bSumTxCount :: Integer
  }

blockHeaderToBSum :: BlockHeader -> Integer -> BlockSummary
blockHeaderToBSum b txCount =
  BlockSummary
    { bSumParentHash = parentHash b,
      bSumStateRoot = stateRoot b,
      bSumGasLimit = getBlockGasLimit b,
      bSumTimestamp = timestamp b,
      bSumNumber = number b,
      bSumTxCount = txCount
    }

instance RLPSerializable BlockSummary where
  rlpEncode (BlockSummary p sr gl ts n txcnt) =
    RLPArray
      [ rlpEncode p,
        rlpEncode sr,
        rlpEncode gl,
        rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
        rlpEncode n,
        rlpEncode txcnt
      ]
  rlpDecode (RLPArray [p, sr, gl, ts, n, txcnt]) =
    BlockSummary
      { bSumParentHash = rlpDecode p,
        bSumStateRoot = rlpDecode sr,
        bSumGasLimit = rlpDecode gl,
        bSumTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
        bSumNumber = rlpDecode n,
        bSumTxCount = rlpDecode txcnt
      }
  rlpDecode x = error $ "rlpDecode for BlockSummary called with data of wrong format: " ++ show x
