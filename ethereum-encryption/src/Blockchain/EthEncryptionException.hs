
module Blockchain.EthEncryptionException (
  EthEncryptionException(..)
  ) where

import Control.Exception.Lifted

data EthEncryptionException =
  HandshakeException String
  | HeadMacIncorrect
  | FrameMacIncorrect
  | PeerHungUp deriving (Show)

instance Exception EthEncryptionException where
