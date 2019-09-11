module Blockchain.Sequencer.CablePackage where

import ClassyPrelude
import Blockchain.Sequencer.Event


data CablePackage = CablePackage
                  { unseqEvents :: TBQueue IngestEvent
                  , unseqCheckpoints :: TQueue OutputEvent --todo: Replace with Checkpoint type
                  , seqP2PEvents :: TQueue OutputSeqP2pEvent
                  , seqVMEvents :: TQueue OutputSeqVmEvent
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
