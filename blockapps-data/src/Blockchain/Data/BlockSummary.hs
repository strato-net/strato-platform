{-# LANGUAGE TypeSynonymInstances, FlexibleInstances, UndecidableInstances, GeneralizedNewtypeDeriving, FlexibleContexts, MultiParamTypeClasses, TypeFamilies #-}

module Blockchain.Data.BlockSummary (
    BlockSummary(..),
    blockHeaderToBSum
  ) where

import Data.Time
import Data.Time.Clock.POSIX
    
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.SHA
                
data BlockSummary = BlockSummary {
  bSumParentHash::SHA,
  bSumDifficulty::Integer,
  bSumTotalDifficulty::Int,
  bSumStateRoot::MP.StateRoot,
  bSumGasLimit::Integer,
  bSumTimestamp::UTCTime,
  bSumNumber::Integer
  }

blockHeaderToBSum::BlockData->BlockSummary
blockHeaderToBSum b =
    BlockSummary {
      bSumParentHash = blockDataParentHash b,
      bSumDifficulty = blockDataDifficulty b,
      bSumTotalDifficulty = 0, -- blockDataTotalDifficulty $ blockBlockData b,
      bSumStateRoot = blockDataStateRoot b,
      bSumGasLimit = blockDataGasLimit b,
      bSumTimestamp = blockDataTimestamp b,
      bSumNumber = blockDataNumber b
    }

instance RLPSerializable BlockSummary where
  rlpEncode (BlockSummary p d td sr gl ts n) =
    RLPArray [
      rlpEncode p,
      rlpEncode d,
      rlpEncode $ toInteger td,
      rlpEncode sr,
      rlpEncode gl,
      rlpEncode (round $ utcTimeToPOSIXSeconds ts::Integer),
      rlpEncode n
      ]
  rlpDecode (RLPArray [p, d, td, sr, gl, ts, n]) =
    BlockSummary {
      bSumParentHash = rlpDecode p,
      bSumDifficulty = rlpDecode d,
      bSumTotalDifficulty = fromInteger $ rlpDecode td,
      bSumStateRoot = rlpDecode sr,
      bSumGasLimit = rlpDecode gl,
      bSumTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
      bSumNumber = rlpDecode n
      }
  rlpDecode x = error $ "rlpDecode for BlockSummary called with data of wrong format: " ++ show x

          
