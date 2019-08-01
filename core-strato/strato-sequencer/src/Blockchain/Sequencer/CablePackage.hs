module Blockchain.Sequencer.CablePackage where

import ClassyPrelude
import Blockchain.Sequencer.Event


data CablePackage = CablePackage
                  { unseqEvents :: TBQueue IngestEvent
                  , seqP2PEvents :: TQueue OutputEvent
                  , seqVMEvents :: TQueue OutputEvent
                  }

queueDepth :: Int
queueDepth = 4096

newCablePackage :: STM CablePackage
newCablePackage = do
  a <- newTBQueue queueDepth
  b <- newTQueue
  c <- newTQueue
  return $ CablePackage a b c
