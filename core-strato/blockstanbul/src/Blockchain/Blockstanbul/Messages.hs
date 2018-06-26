module Blockchain.Blockstanbul.Messages where

import Blockchain.ExtWord
import Blockchain.Data.DataDefs
import Blockchain.SHA

data RoundId = RoundId {
  roundidRound :: Word256,
  roundidSequence :: Word256
} deriving (Eq, Show, Ord)

data WireMessage = Preprepare RoundId Block
                 | Prepare RoundId SHA
                 | Commit RoundId SHA
                 | RoundChange Word256 deriving (Eq, Show)


-- TODO(tim): JSON instances
-- TODO(tim): RLP instances
