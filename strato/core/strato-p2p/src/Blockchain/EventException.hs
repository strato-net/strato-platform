module Blockchain.EventException
  ( EventException (..),
  )
where

import Blockchain.Data.Wire
import Control.Exception.Lifted

data EventException
  = PeerDisconnected
  | EventBeforeHandshake Message
  | WrongGenesisBlock
  | NetworkIDMismatch
  | RootCertificateMismatch
  | NoPeerPubKey
  | NoPeerCertificate
  deriving (Show)

instance Exception EventException
