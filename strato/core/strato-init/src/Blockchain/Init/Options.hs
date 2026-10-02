{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Options where

import HFlags

parseBootnodeString :: String -> [String]
parseBootnodeString "" = []
parseBootnodeString s | not $ elem '[' s = [s]
parseBootnodeString s = read s

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname. Anything other than localhost is an external cluster (e.g. the Aurora writer endpoint): no postgres container is generated and --password must carry its password"
defineFlag "pgReaderHost" ("" :: String) "Read-only Postgres endpoint (e.g. the Aurora reader endpoint) for PostgREST; defaults to --pghost"
defineFlag "regenerate" (False :: Bool) "Re-generate ethconf.yaml, docker-compose.yml and commands.txt for an EXISTING directory from the flags given (state, secrets and genesis are kept). Pass the same flags as the original setup plus the changes; the network identity must not change"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "K:kafkahost" ("localhost" :: String) "Streaming broker hostname"
defineFlag "kafkaport" (9092 :: Int) "Streaming broker port (9094 for a core's VPC-facing listener, see --kafkaExternalHost)"
defineFlag "busHost" ("" :: String) "Shared message bus (Kafka-compatible cluster) bootstrap hostname; empty means no bus. A core runs strato-ingest against it; an API directory submits to it per --busSubmitMode"
defineFlag "busPort" (9096 :: Int) "Message bus port (9096 is MSK's SASL_SSL port)"
defineFlag "busSecurity" ("sasl_ssl" :: String) "Message bus security: plaintext, ssl or sasl_ssl"
defineFlag "busSaslUsername" ("" :: String) "SCRAM username for the message bus"
defineFlag "busSaslPassword" ("" :: String) "SCRAM password for the message bus (prefer the bus_sasl_password environment variable)"
defineFlag "busSubmitMode" ("core" :: String) "Where the API sends submitted transactions: core (this node's broker), bus, or shadow (both, while validating)"
defineFlag "kafkaExternalHost" ("" :: String) "Private hostname or IP at which other hosts (the API tier) reach this node's broker; adds a second, VPC-facing listener on port 9094. Keep it private: the listener is plaintext, so restrict it with a security group"
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

defineFlag "apiIPAddress" "" "Address strato-api binds to, which is also how the nginx container reaches it (default: the docker bridge 172.17.0.1 on Linux, 127.0.0.1 elsewhere)"

defineFlag "httpPort" (8081 :: Int) "The external HTTP port for nginx"
defineFlag "nodeHost" ("localhost" :: String) "The external hostname for the node"

defineFlag "svmTrace" (False :: Bool) "Enable verbose logging in SolidVM"

defineFlag "vaultUrl" "https://vault.blockapps.net:8093/strato/v2.3" "URL of the shared vault service"

defineFlag "vaultTimeoutSec" (12 :: Int) "HTTP response timeout (seconds) for vault-wrapper signature / key requests"

defineFlag "fileServerUrl" "" "URL of the file server for marketplace (derived from network if not provided)"

defineFlag "notificationServerUrl" "" "URL of the notification server for marketplace"

defineFlag "generateKey" (True :: Bool) "Whether or not to generate a new nodekey, if there isn't one in the vault"
defineFlag "jsonrpc" (True :: Bool) "Start the Ethereum JSON-RPC server (port 8545) for wallet integration"
defineFlag "vmQuery" (False :: Bool) "Run vm-query (port 8546) next to ethereum-jsonrpc and route latest-state eth_call, simulations and call traces to it, against the SQL state mirror instead of the consensus VM"
defineFlag "validatorBehavior" (True :: Bool) "Whether this node votes and proposes when its key is in the validator set. Pass --validatorBehavior=false for a read-only follower core (an RPC cell) that executes blocks and serves reads but never takes part in consensus"
defineFlag "writer" (True :: Bool) "Whether strato-indexer claims the writer lease at startup (unheld, stale, or its own). false makes a standby core: it follows the chain against the shared Postgres cluster and writes nothing until promoted with strato-promote"
defineFlag "cellId" ("" :: String) "This core's name among the cores sharing a Postgres cluster (writer lease holder, consumer group suffixes). Default: the hostname"
defineFlag "peerDatabase" ("" :: String) "Database for this core's peer store (p_peer, sync_task) on the Postgres host. Every core sharing a cluster needs its own, since strato-p2p resets peer state at startup. Default: the eth database, as on a monolith"
defineFlag "peerStore" ("postgres" :: String) "Where strato-p2p and ethereum-discover keep peers and sync tasks: 'postgres' (the default, the database above) or 'sqlite' (the file peers.sqlite in the node directory, so a core whose Postgres is elsewhere keeps its networking state on its own disk and no longer depends on the database being reachable)"
defineFlag "publicStratoRpc" (False :: Bool) "Expose the strato_* simulation/trace methods on the public /rpc endpoint (default: blocked; the bloc simulate endpoint is unaffected)"
defineFlag "localAuth" (False :: Bool) "Use local auth (Kratos/Hydra) instead of external Keycloak"
defineFlag "sslDir" ("" :: String) "Path to directory containing server.pem and server.key (enables SSL)"

defineFlag "dockerMode" ("local" :: String) "Docker compose mode: 'local' for local dev, 'allDocker' for full containerized deployment"
defineFlag "bundledApp" (True :: Bool) "Run app-backend and app-ui next to this node (default). False when the app runs on its own tier (docker-compose.app.yml / the app CDK stack); pass --appUrl so the node's root redirects there"
defineFlag "appUrl" ("" :: String) "Public URL of the app tier, used when --bundledApp=false"
defineFlag "bundledSmd" (True :: Bool) "Run the SMD next to this node (default). False when the SMD is served from its own deployment (S3 behind CloudFront); pass --smdUrl so the node's /smd redirects there"
defineFlag "smdUrl" ("" :: String) "Public URL of the SMD deployment, used when --bundledSmd=false"
defineFlag "bundledPostgrest" (True :: Bool) "Run PostgREST (the Cirrus API at /cirrus) next to this node (default). False when the API tier serves Cirrus; the node's /cirrus then answers 502"
defineFlag "role" ("node" :: String) "What this directory runs: 'node' (everything, the default), 'core' (consensus, VM, indexers and their Postgres/Redis/broker), or 'api' (strato-api, ethereum-jsonrpc, PostgREST and the nginx sidecar; point --pghost and --kafkahost at a core and pass its Postgres password with --password)"

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
