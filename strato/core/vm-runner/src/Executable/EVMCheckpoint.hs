{-# LANGUAGE DeriveGeneric #-}

module Executable.EVMCheckpoint (
  EVMCheckpoint(..)
  ) where

import Blockchain.Data.BlockHeader

import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.VMContext (ContextBestBlockInfo (..))
import Data.Binary
import GHC.Generics
import qualified Text.Colors as CL
import Text.Format

data EVMCheckpoint = EVMCheckpoint
  { checkpointHead :: BlockHeader,
    ctxBestBlockInfo :: ContextBestBlockInfo
  }
  deriving (Show, Generic)

instance Format EVMCheckpoint where -- todo add format instance for ContextBestBlockInfo and show it here as well.
  format (EVMCheckpoint header _) =
    "EVMCheckpoint " ++ CL.red (short $ blockHeaderHash header)
    where
      short = take 16 . formatKeccak256WithoutColor

instance Binary EVMCheckpoint
