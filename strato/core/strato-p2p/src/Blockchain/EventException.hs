module Blockchain.EventException
  ( EventException (..),
  )
where

import Blockchain.Data.Wire
import Control.Exception.Lifted

data EventException
  = PeerDisconnected
  | -- | The peer said why it hung up (TooManyPeers, UselessPeer, ...).
    RemoteDisconnect TerminationReason
  | PeerNonResponsive
  | CurrentlyTooManyPeers
  | EventBeforeHandshake Message
  | WrongGenesisBlock
  | NetworkIDMismatch
  | NoPeerPubKey
  | NoPeerCertificate
  | SelfConnection
  deriving (Show)

instance Exception EventException
