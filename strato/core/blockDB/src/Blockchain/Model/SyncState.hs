{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Model.SyncState (
  BestBlock(..),
  BestSequencedBlock(..),
  WorldBestBlock(..),
  RedisBestBlock(..)
  ) where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Keccak256
import Text.Format
import Text.Format.Template

data BestBlock = BestBlock
  { bestBlockHash :: Keccak256,
    bestBlockNumber :: Integer
  }
  deriving (Eq, Show)

$(deriveFormat ''BestBlock)

newtype BestSequencedBlock = BestSequencedBlock {unBestSequencedBlock :: BestBlock} deriving (Eq, Show)

$(deriveFormat ''BestSequencedBlock)

newtype WorldBestBlock = WorldBestBlock {unWorldBestBlock :: BestBlock} deriving (Eq, Show)

data RedisBestBlock = RedisBestBlock
  { redisBestBlockHash :: Keccak256,
    redisBestBlockNumber :: Integer -- todo: BlockNumber
  }
  deriving (Eq, Read, Show)

$(deriveFormat ''RedisBestBlock)

instance RLPSerializable RedisBestBlock where
  rlpEncode (RedisBestBlock sha num) = RLPArray [rlpEncode sha, rlpEncode num]
  rlpDecode (RLPArray [sha, num]) = RedisBestBlock (rlpDecode sha) (rlpDecode num)
  rlpDecode _ = error "data in wrong format when trying to rlpDecode a RedisBestBlock"

