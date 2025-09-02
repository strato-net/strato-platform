{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import Blockchain.Participation (ParticipationMode (..))
import HFlags

data P2PClientMode = SingleThreaded | MultiThreaded
  deriving (Eq, Ord, Read, Show)

defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "The Vault-Wrapper URL"

defineEQFlag
  "participationMode"
  [|Full :: ParticipationMode|]
  "PARTICIPATIONMODE"
  "Whether to send all mesages to peers (Full), no messages to peers (None), or everything except PBFT (NoConsensus)"

