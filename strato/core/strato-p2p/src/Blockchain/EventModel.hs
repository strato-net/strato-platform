module Blockchain.EventModel (Event (..)) where

import Blockchain.Data.Wire
import Blockchain.Sequencer.Event

data Event = MsgEvt Message | NewSeqEvent P2pEvent | TimerEvt | AbortEvt String deriving (Show)
