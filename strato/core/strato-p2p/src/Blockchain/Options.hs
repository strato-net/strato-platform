{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import Blockchain.Participation (ParticipationMode (..))
import HFlags

data P2PClientMode = SingleThreaded | MultiThreaded
  deriving (Eq, Ord, Read, Show)

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "maxConn" (20 :: Int) "Maximum number of client connections."
defineFlag "connectionTimeout" (30 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (500 :: Int) "Number of headers to return from a GetBlockHeaders request"
defineFlag "maxHeadersTxsLens" (2500 :: Int) "Number of txs size to return from a BlockHeader request"
defineFlag "averageTxsPerBlock" (40 :: Int) "Average number of txs per block"
defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "The Vault-Wrapper URL"


defineEQFlag
  "participationMode"
  [|Full :: ParticipationMode|]
  "PARTICIPATIONMODE"
  "Whether to send all mesages to peers (Full), no messages to peers (None), or everything except PBFT (NoConsensus)"
