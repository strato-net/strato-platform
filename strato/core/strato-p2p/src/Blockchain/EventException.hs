
module Blockchain.EventException (
  EventException(..)
  ) where

import           Control.Exception.Lifted

import           Blockchain.Data.Wire

data EventException =
    PeerDisconnected
  | EventBeforeHandshake Message
  | WrongGenesisBlock
  | NetworkIDMismatch
  | RootCertificateMismatch
  | NoPeerPubKey deriving (Show)

instance Exception EventException where
