{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Model.SyncState (
  BestBlock(..),
  BestSequencedBlock(..),
  WorldBestBlock(..)
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

instance RLPSerializable BestBlock where
  rlpEncode (BestBlock sha num) = RLPArray [rlpEncode sha, rlpEncode num]
  rlpDecode (RLPArray [sha, num]) = BestBlock (rlpDecode sha) (rlpDecode num)
  rlpDecode _ = error "data in wrong format when trying to rlpDecode a RedisBestBlock"


newtype BestSequencedBlock = BestSequencedBlock {unBestSequencedBlock :: BestBlock} deriving (Eq, Show)

$(deriveFormat ''BestSequencedBlock)


newtype WorldBestBlock = WorldBestBlock {unWorldBestBlock :: BestBlock} deriving (Eq, Show)
