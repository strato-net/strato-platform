module Blockchain.EventModel (Event(..)) where

import Blockchain.Data.Wire
import Blockchain.Sequencer.Event

data Event = MsgEvt Message | NewSeqEvent OutputEvent | TimerEvt | AbortEvt String deriving (Show)
