module Blockchain.Sequencer.CablePackage where

import ClassyPrelude
import Blockchain.Blockstanbul (Checkpoint)
import Blockchain.Sequencer.Event


data CablePackage = CablePackage
                  { unseqEvents :: TBQueue IngestEvent
                  , unseqCheckpoints :: TQueue Checkpoint
                  , seqP2PEvents :: TQueue P2pEvent
                  , seqVMEvents :: TQueue VmEvent
                  }

queueDepth :: Int
queueDepth = 4096

newCablePackage :: STM CablePackage
newCablePackage = do
  a <- newTBQueue queueDepth
  b <- newTQueue
  c <- newTQueue
  d <- newTQueue
  return $ CablePackage a b c d
