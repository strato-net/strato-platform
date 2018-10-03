{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import           HFlags

data P2PClientMode = SingleThreaded | MultiThreaded
        deriving (Eq, Ord, Read, Show)

defineFlag "sqlPeers" False "Choose peers from the SQL DB, not the config file"
defineFlag "cTestnet" False "connect to testnet"
defineFlag "cNetworkID" (-1::Int) "set a custom network ID for the client"
defineFlag "syncBacktrackNumber" (10::Integer) "block number to go back when syncing"
defineFlag "debugFail" True "Fail on errors we're not supposed to reach. If false, just log insteand and go on"
defineFlag "maxConn" (20::Int) "Maximum number of client connections."
defineFlag "connectionTimeout" (300 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (1000 :: Int) "Number of headers to return from a GetBlockHeaders request" -- todo: seriously???
