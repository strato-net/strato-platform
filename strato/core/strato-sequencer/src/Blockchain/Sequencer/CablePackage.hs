module Blockchain.Sequencer.CablePackage where

import Blockchain.Blockstanbul (Checkpoint)
import Blockchain.Sequencer.Event
import ClassyPrelude
import Numeric.Natural

data CablePackage = CablePackage
  { unseqEvents :: TBQueue IngestEvent,
    unseqCheckpoints :: TQueue Checkpoint
  }

queueDepth :: Natural
queueDepth = 4096

newCablePackage :: STM CablePackage
newCablePackage = do
  a <- newTBQueue queueDepth
  b <- newTQueue
  return $ CablePackage a b
