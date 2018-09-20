module Blockchain.Sequencer.CablePackage where

import ClassyPrelude
import Blockchain.Sequencer.Event


data CablePackage = CablePackage
                  { unseqEvents :: TMChan IngestEvent
                  , seqP2PEvents :: TMChan OutputEvent
                  , seqVMEvents :: TMChan OutputEvent
                  }

newCablePackage :: STM CablePackage
newCablePackage = do
  a <- newTMChan
  b <- newTMChan
  c <- newTMChan
  return $ CablePackage a b c
