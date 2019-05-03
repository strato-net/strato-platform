{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import           HFlags

data P2PClientMode = SingleThreaded | MultiThreaded
        deriving (Eq, Ord, Read, Show)

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "testnet" False "connect to testnet"
defineFlag "sqlPeers" False "Choose peers from the SQL DB, not the config file"
defineFlag "networkID" (-1::Int) "set a custom network ID for the client"
defineFlag "syncBacktrackNumber" (10::Integer) "block number to go back when syncing"
defineFlag "debugFail" True "Fail on errors we're not supposed to reach. If false, just log insteand and go on"
defineFlag "maxConn" (20::Int) "Maximum number of client connections."
defineFlag "channelBound" (409600 ::Int) "Bound of the intermediate channel; maximum amount of memory it can use"
defineFlag "connectionTimeout" (300 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (1000 :: Int) "Number of headers to return from a GetBlockHeaders request" -- todo: seriously???
defineFlag "txGossipFanout" (-1::Int) "Maxmimum number of peers to forward transactions to. Only\
                                      \ applicable for transactions received from peers, not\
                                      \ originating on this node."

computeNetworkID :: Int
computeNetworkID = if flags_networkID == -1
                      then if flags_testnet
                             then 0
                             else 1
                      else flags_networkID
