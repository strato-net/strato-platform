module Blockchain.EventModel (Event(..)) where

import Blockchain.Data.Wire
import Blockchain.Sequencer.Event

data Event = MsgEvt Message | NewSeqEvent OutputSeqP2pEvent | TimerEvt | AbortEvt String deriving (Show)
