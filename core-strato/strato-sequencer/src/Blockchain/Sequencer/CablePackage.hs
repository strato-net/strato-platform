module Blockchain.Sequencer.CablePackage where

import ClassyPrelude
import Blockchain.Sequencer.Event


data CablePackage = CablePackage
                  { unseqEvents :: TQueue IngestEvent
                  , seqP2PEvents :: TQueue OutputEvent
                  , seqVMEvents :: TQueue OutputEvent
                  }

newCablePackage :: STM CablePackage
newCablePackage = do
  a <- newTQueue
  b <- newTQueue
  c <- newTQueue
  return $ CablePackage a b c
