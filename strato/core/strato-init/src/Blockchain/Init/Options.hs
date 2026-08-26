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
defineFlag "K:kafkahost" ("localhost" :: String) "Streaming broker hostname"
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

defineFlag "minPeers" (10 :: Int) "Threshold for discovery to stop querying for more peers"

defineFlag "apiIPAddress" "" "The address containers use to reach strato-api on the host (auto-detected if empty)"

defineFlag "httpPort" (8081 :: Int) "The external HTTP port for nginx"
defineFlag "nodeHost" ("localhost" :: String) "The external hostname for the node"

defineFlag "svmTrace" (False :: Bool) "Enable verbose logging in SolidVM"

defineFlag "vaultUrl" "https://vault.blockapps.net:8093/strato/v2.3" "URL of the shared vault service"

defineFlag "vaultTimeoutSec" (12 :: Int) "HTTP response timeout (seconds) for vault-wrapper signature / key requests"

defineFlag "fileServerUrl" "" "URL of the file server for marketplace (derived from network if not provided)"

defineFlag "notificationServerUrl" "" "URL of the notification server for marketplace"

defineFlag "generateKey" (True :: Bool) "Whether or not to generate a new nodekey, if there isn't one in the vault"
defineFlag "jsonrpc" (True :: Bool) "Start the Ethereum JSON-RPC server (port 8545) for wallet integration"
defineFlag "publicStratoRpc" (False :: Bool) "Expose the strato_* simulation/trace methods on the public /rpc endpoint (default: blocked; the bloc simulate endpoint is unaffected)"
defineFlag "localAuth" (False :: Bool) "Use local auth (Kratos/Hydra) instead of external Keycloak"
defineFlag "sslDir" ("" :: String) "Path to directory containing server.pem and server.key (enables SSL)"

defineFlag "dockerMode" ("local" :: String) "Docker compose mode: 'local' for local dev, 'allDocker' for full containerized deployment"

defineFlag "repoUrl" ("" :: String) "Docker registry URL prefix for images (e.g., 'registry.example.com/org/')"

defineFlag "composeOnly" (False :: Bool) "Only generate docker-compose.yml to stdout and exit (no node setup)"

defineFlag "includeBuild" (False :: Bool) "Include build directives in generated docker-compose.yml"

-- P2P config flags
-- The ethconf.yaml flag migration silently raised these from 20/30 to
-- 1000/3600, which is what turned fresh syncs from minutes into hours.
-- connectionTimeout is NOT restored to its old 30: at 30s the TimerEvt
-- liveness check reaps peers that are merely idle, and each reconnect
-- re-downloads (measured: 1,528 handshakes for ~20 peers in 20 minutes).
-- 30s was only safe back when it also drove the body-cache self-heal; that
-- is now a fixed 60s in Context.hs, so this can be a real liveness timeout.
defineFlag "maxConn" (20 :: Int) "Maximum number of P2P client connections"
defineFlag "connectionTimeout" (120 :: Int) "Number of seconds to tolerate a useless peer"
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
defineFlag "blockstanbul_round_period_s" (3600 :: Int) "Seconds without progress before a forced PBFT round change (a missed proposal is detected within seconds regardless)"
defineFlag "stakingActivationBlock" (-1 :: Integer) "Block number from which stake-weighted proposer selection is in force (-1 = network default: from genesis for new networks, unscheduled for existing ones)"

-- VM config flags
defineFlag "sqlDiff" (True :: Bool) "Update account state and storage in SQL DB (set false for faster sync)"
defineFlag "diffPublish" (True :: Bool) "Publish state changes to streaming for indexer"

-- Kafka log retention flags (defaults match Kafka's own defaults / the current
-- generated config, so behavior is unchanged unless overridden). Nodes whose
-- state gets snapshotted (e.g. the synctest pipeline) lower these so the raw
-- kafka log dir shipped in the snapshot payload stays small.
defineFlag "kafkaLogRetentionHours" (168 :: Int) "Kafka log.retention.hours: delete log segments older than this"
defineFlag "kafkaLogRetentionBytes" (-1 :: Integer) "Kafka log.retention.bytes: max bytes retained per partition (-1 = unlimited)"
defineFlag "kafkaLogSegmentBytes" (1073741824 :: Int) "Kafka log.segment.bytes: segment file size; retention only deletes closed segments, so lower this together with the retention flags"
$(return [])
