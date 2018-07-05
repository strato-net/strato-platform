module Blockchain.Blockstanbul.Messages where

import Blockchain.ExtWord
import Blockchain.Data.DataDefs
import Blockchain.SHA

data RoundId = RoundId {
  roundidRound :: Word256,
  roundidSequence :: Word256
}

data Preprepare = Preprepare {
  preprepareRoundId :: RoundId,
  preprepareProposal :: Block
}

data Prepare = Prepare {
  prepareRoundId :: RoundId,
  prepareDigest :: SHA
}

data Commit = Commit {
  commitRoundId :: RoundId,
  commitDigest :: SHA
}

-- TODO(tim): JSON instances
-- TODO(tim): RLP instances
