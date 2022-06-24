{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Options where

import           Data.ByteString.Internal
import           HFlags

import           Blockchain.Participation (ParticipationMode(..))
import           Blockchain.Strato.Model.Util

data P2PClientMode = SingleThreaded | MultiThreaded
        deriving (Eq, Ord, Read, Show)

data AuthorizationMode = IPOnly | PubkeyOnly | StrongAuth | FlexibleAuth deriving (Read, Show, Eq, Enum, Ord)

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "testnet" False "connect to testnet"
defineFlag "sqlPeers" False "Choose peers from the SQL DB, not the config file"
defineFlag "network" (""::String) "Choose a network to join"
defineFlag "networkID" (-1::Int) "set a custom network ID for the client"
defineFlag "syncBacktrackNumber" (10::Integer) "block number to go back when syncing"
defineFlag "debugFail" True "Fail on errors we're not supposed to reach. If false, just log insteand and go on"
defineFlag "maxConn" (20::Int) "Maximum number of client connections."
defineFlag "connectionTimeout" (300 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (1000 :: Int) "Number of headers to return from a GetBlockHeaders request" -- todo: seriously???
defineFlag "maxHeadersTxsLens" (2500 :: Int) "Number of txs size to return from a BlockHeader request"
defineFlag "averageTxsPerBlock" (40 :: Int) "Average number of txs per block"
defineFlag "wireMessageCacheSize" (2000 :: Int) "Number of wire messages to cache for network performance"
defineFlag "vaultWrapperUrl" ("http://vault-wrapper:8000/strato/v2.3" :: String) "The Vault-Wrapper URL"
defineFlag "txGossipFanout" (-1::Int) "Maxmimum number of peers to forward transactions to. Only\
                                      \ applicable for transactions received from peers, not\
                                      \ originating on this node."
-- TODO remove distinction between new status messages and old ones once entire protocol is complete
defineFlag "useNodeCerts" (False :: Bool) "Use new node certificate checking protocol"

defineEQFlag "privateChainAuthorizationMode" [| FlexibleAuth :: AuthorizationMode |] "AUTHORIZATIONMODE"
    "Describes the policy for sharing private chain data. By default, it only checks that the ip address\
    \ of the peer is a member of the chain. It can be configured to only use the public key or to\
    \ enforce both an ip and/or key match. It relies on the ability to send a roundtrip to authenticate\
    \ the ip address, and the p2p handshake to authenticate the public key."

defineEQFlag "participationMode" [| Full :: ParticipationMode |] "PARTICIPATIONMODE"
  "Whether to send all mesages to peers (Full), no messages to peers (None), or everything except PBFT (NoConsensus)"

computeNetworkID :: Integer
computeNetworkID =
  case (flags_network, flags_networkID) of
    ("", -1) ->
      if flags_testnet
      then 0
      else 1
    (network, -1) -> bytes2Integer $ map c2w network
    (_, _) -> toInteger flags_networkID
