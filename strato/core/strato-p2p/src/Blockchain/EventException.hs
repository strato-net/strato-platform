
module Blockchain.EventException (
  EventException(..)
  ) where

import           Control.Exception.Lifted

import           Blockchain.Data.Wire

data EventException =
    PeerDisconnected
  | EventBeforeHandshake Message
  | WrongGenesisBlock
  | NetworkIDMismatch Integer Integer
  | RootCertificateMismatch
  | InvalidClientCert
  | NoPeerPubKey deriving (Show)

instance Exception EventException where
