{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import           HFlags

import           Blockchain.Participation (ParticipationMode(..))

data P2PClientMode = SingleThreaded | MultiThreaded
        deriving (Eq, Ord, Read, Show)

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "sqlPeers" False "Choose peers from the SQL DB, not the config file"
defineFlag "syncBacktrackNumber" (10::Integer) "block number to go back when syncing"
defineFlag "debugFail" True "Fail on errors we're not supposed to reach. If false, just log insteand and go on"
defineFlag "maxConn" (20::Int) "Maximum number of client connections."
defineFlag "connectionTimeout" (30 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (200 :: Int) "Number of headers to return from a GetBlockHeaders request" -- todo: seriously???
defineFlag "maxHeadersTxsLens" (2500 :: Int) "Number of txs size to return from a BlockHeader request"
defineFlag "averageTxsPerBlock" (40 :: Int) "Average number of txs per block"
defineFlag "wireMessageCacheSize" (2000 :: Int) "Number of wire messages to cache for network performance"
defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "The Vault-Wrapper URL"
defineFlag "txGossipFanout" (-1::Int) "Maxmimum number of peers to forward transactions to. Only\
                                      \ applicable for transactions received from peers, not\
                                      \ originating on this node."
-- TODO remove distinction between new status messages and old ones once entire protocol is complete
defineFlag "useNodeCerts" (False :: Bool) "Use new node certificate checking protocol"

defineEQFlag "participationMode" [| Full :: ParticipationMode |] "PARTICIPATIONMODE"
  "Whether to send all mesages to peers (Full), no messages to peers (None), or everything except PBFT (NoConsensus)"