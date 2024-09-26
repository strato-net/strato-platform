{-# LANGUAGE DeriveGeneric #-}

module Executable.EVMCheckpoint (
  EVMCheckpoint(..)
  ) where

import Blockchain.Data.BlockHeader

import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Keccak256
import Blockchain.VMContext (ContextBestBlockInfo (..))
import Data.Binary
import GHC.Generics
import qualified Text.Colors as CL
import Text.Format

data EVMCheckpoint = EVMCheckpoint
  { checkpointSHA :: Keccak256,
    checkpointHead :: BlockHeader,
    ctxBestBlockInfo :: ContextBestBlockInfo,
    ctxChainDBStateRoot :: MP.StateRoot
  }
  deriving (Show, Generic)

instance Format EVMCheckpoint where -- todo add format instance for ContextBestBlockInfo and show it here as well.
  format (EVMCheckpoint sha _ _ _) =
    "EVMCheckpoint " ++ CL.red (short sha)
    where
      short = take 16 . formatKeccak256WithoutColor

instance Binary EVMCheckpoint
