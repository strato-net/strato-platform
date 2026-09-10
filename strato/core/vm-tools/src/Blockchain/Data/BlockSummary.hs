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
import Blockchain.Data.ProposalFacts
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
    bSumTxCount :: Integer,
    -- | Who proposed this block, who was meant to, and in which round
    -- (see "Blockchain.Data.ProposalFacts"); exposed to the next block's
    -- transactions as @block.prev*@.
    bSumProposalFacts :: ProposalFacts
  }

-- | @blockHeaderToBSum chainId parentFacts header txCount@; the parent's facts
-- supply the round the height started at.
blockHeaderToBSum :: Integer -> ProposalFacts -> BlockHeader -> Integer -> BlockSummary
blockHeaderToBSum chainId parentFacts b txCount =
  BlockSummary
    { bSumParentHash = parentHash b,
      bSumStateRoot = stateRoot b,
      bSumGasLimit = getBlockGasLimit b,
      bSumTimestamp = timestamp b,
      bSumNumber = number b,
      bSumTxCount = txCount,
      bSumProposalFacts = proposalFactsFromHeader chainId (pfRound parentFacts) b
    }

instance RLPSerializable BlockSummary where
  rlpEncode (BlockSummary p sr gl ts n txcnt (ProposalFacts prop intended rnd)) =
    RLPArray
      [ rlpEncode p,
        rlpEncode sr,
        rlpEncode gl,
        rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
        rlpEncode n,
        rlpEncode txcnt,
        rlpEncode prop,
        rlpEncode intended,
        rlpEncode rnd
      ]
  -- summaries written before proposal facts existed (pre-V3 blocks: no facts)
  rlpDecode (RLPArray [p, sr, gl, ts, n, txcnt]) =
    decodeSummary p sr gl ts n txcnt noProposalFacts
  rlpDecode (RLPArray [p, sr, gl, ts, n, txcnt, prop, intended, rnd]) =
    decodeSummary p sr gl ts n txcnt $
      ProposalFacts (rlpDecode prop) (rlpDecode intended) (rlpDecode rnd)
  rlpDecode x = error $ "rlpDecode for BlockSummary called with data of wrong format: " ++ show x

decodeSummary :: RLPObject -> RLPObject -> RLPObject -> RLPObject -> RLPObject -> RLPObject -> ProposalFacts -> BlockSummary
decodeSummary p sr gl ts n txcnt facts =
  BlockSummary
    { bSumParentHash = rlpDecode p,
      bSumStateRoot = rlpDecode sr,
      bSumGasLimit = rlpDecode gl,
      bSumTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
      bSumNumber = rlpDecode n,
      bSumTxCount = rlpDecode txcnt,
      bSumProposalFacts = facts
    }
