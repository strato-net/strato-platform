{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import           HFlags

data P2PClientMode = SingleThreaded | MultiThreaded
        deriving (Eq, Ord, Read, Show)

data AuthorizationMode = IPOnly | PubkeyOnly | StrongAuth | FlexibleAuth deriving (Read, Show, Eq, Enum, Ord)

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "testnet" False "connect to testnet"
defineFlag "sqlPeers" False "Choose peers from the SQL DB, not the config file"
defineFlag "networkID" (-1::Int) "set a custom network ID for the client"
defineFlag "syncBacktrackNumber" (10::Integer) "block number to go back when syncing"
defineFlag "debugFail" True "Fail on errors we're not supposed to reach. If false, just log insteand and go on"
defineFlag "maxConn" (20::Int) "Maximum number of client connections."
defineFlag "connectionTimeout" (300 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (1000 :: Int) "Number of headers to return from a GetBlockHeaders request" -- todo: seriously???
defineFlag "maxHeadersTxsLens" (2500 :: Int) "Number of txs size to return from a BlockHeader request"
defineFlag "averageTxsPerBlock" (40 :: Int) "Average number of txs per block"
defineFlag "txGossipFanout" (-1::Int) "Maxmimum number of peers to forward transactions to. Only\
                                      \ applicable for transactions received from peers, not\
                                      \ originating on this node."

defineEQFlag "privateChainAuthorizationMode" [| IPOnly :: AuthorizationMode |] "AUTHORIZATIONMODE"
    "Describes the policy for sharing private chain data. By default, it only checks that the ip address\
    \ of the peer is a member of the chain. It can be configured to only use the public key or to\
    \ enforce both an ip and/or key match. It relies on the ability to send a roundtrip to authenticate\
    \ the ip address, and the p2p handshake to authenticate the public key."


computeNetworkID :: Int
computeNetworkID = if flags_networkID == -1
                      then if flags_testnet
                             then 0
                             else 1
                      else flags_networkID
