module Blockchain.EthEncryptionException
  ( EthEncryptionException (..),
  )
where

import Control.Exception.Lifted

data EthEncryptionException
  = HandshakeException String
  | HeadMacIncorrect
  | FrameMacIncorrect
  | PeerHungUp
  | HeadCipherTooShort
  | HeadMACTooShort
  | FrameCipherTooShort
  | FrameMACTooShort
  deriving (Eq, Read, Show)

instance Exception EthEncryptionException
