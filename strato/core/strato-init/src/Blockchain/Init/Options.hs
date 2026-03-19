{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Options where

import HFlags

parseBootnodeString :: String -> [String]
parseBootnodeString "" = []
parseBootnodeString s | not $ elem '[' s = [s]
parseBootnodeString s = read s

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "K:kafkahost" ("localhost" :: String) "Kafka hostname"
defineFlag "z:lazyblocks" (False :: Bool) "Don't mine empty blocks"
defineFlag "addBootnodes" True "Adds bootnodes to the peer DB at setup time.  If set to false, the peer will not be able to initiate a connection to the network by itself (this option is useful if you want to set up a peer to itself be a bootnode in a private network)"
defineCustomFlag
  "stratoBootnode"
  [|[] :: [String]|]
  "STRING_LIST"
  [|parseBootnodeString|]
  [|show|]
  "Replaces the default set of public boot nodes with the provided ip address(es), considered as the address of a strato node(s)"

defineFlag "R:redisHost" ("localhost" :: String) "Redis BlockDB hostname"
defineFlag "redisPort" (6379 :: Int) "Redis BlockDB port"
defineFlag "redisDBNumber" (0 :: Integer) "Redis database number"

defineFlag "minPeers" (0 :: Int) "Threshold for discovery to stop querying for more peers"

defineFlag "apiIPAddress" "127.0.0.1" "The IP address that strato-api will bind to"

defineFlag "httpPort" (8081 :: Int) "The external HTTP port for nginx"

defineFlag "svmTrace" (False :: Bool) "Enable verbose logging in SolidVM"

defineFlag "vaultUrl" "https://vault.blockapps.net:8093/strato/v2.3" "URL of the shared vault service"

defineFlag "fileServerUrl" "" "URL of the file server for marketplace (derived from network if not provided)"

defineFlag "notificationServerUrl" "" "URL of the notification server for marketplace"

defineFlag "generateKey" (True :: Bool) "Whether or not to generate a new nodekey, if there isn't one in the vault"

defineFlag "dockerMode" ("local" :: String) "Docker compose mode: 'local' for local dev, 'allDocker' for full containerized deployment"

defineFlag "repoUrl" ("" :: String) "Docker registry URL prefix for images (e.g., 'registry.example.com/org/')"

defineFlag "composeOnly" (False :: Bool) "Only generate docker-compose.yml to stdout and exit (no node setup)"

defineFlag "includeBuild" (False :: Bool) "Include build directives in generated docker-compose.yml"

-- P2P config flags
defineFlag "maxConn" (1000 :: Int) "Maximum number of P2P client connections"
defineFlag "connectionTimeout" (3600 :: Int) "Number of seconds to tolerate a useless peer"
defineFlag "maxReturnedHeaders" (500 :: Int) "Number of headers to return from a GetBlockHeaders request"
defineFlag "averageTxsPerBlock" (40 :: Int) "Average number of txs per block (used for header size estimation)"
defineFlag "maxHeadersTxsLens" (2500 :: Int) "Max total tx size to return from a BlockHeader request"

-- LevelDB config flags
defineFlag "ldbCacheSize" (33554432 :: Int) "Size in bytes of LevelDB block cache per namespace (0 = default of 8MB)"
defineFlag "ldbBlockSize" (4096 :: Int) "Size in bytes of LevelDB block packing per namespace"

-- Quarry/execution config flags
defineFlag "maxTxsPerBlock" (500 :: Integer) "Max number of transactions that may be put into a block"
defineFlag "mempoolLivenessCutoff" (60 :: Integer) "Max age of a transaction in seconds that is valid for the mempool"

-- Consensus timing flags
defineFlag "blockstanbul_block_period_ms" (1000 :: Int) "Minimum delay between block creations"
defineFlag "blockstanbul_round_period_s" (120 :: Int) "Maximum seconds that one validator will remain the proposer"

$(return [])
