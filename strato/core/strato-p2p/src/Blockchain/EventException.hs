module Blockchain.EventException
  ( EventException (..),
  )
where

import Blockchain.Data.Wire
import Control.Exception.Lifted

data EventException
  = PeerDisconnected
  | PeerNonResponsive
  | CurrentlyTooManyPeers
  | EventBeforeHandshake Message
  | WrongGenesisBlock
  | NetworkIDMismatch
  | NoPeerPubKey
  | NoPeerCertificate
  deriving (Show)

instance Exception EventException
