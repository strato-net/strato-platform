module Blockchain.Data.Control
  ( P2PCNC (..),
  )
where

import Blockchain.Sequencer.Event

data P2PCNC
  = TXQueueTimeout
  | ToUnseq [IngestEvent]
  deriving (Show, Eq)
