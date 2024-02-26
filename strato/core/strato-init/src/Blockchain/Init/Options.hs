{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Options where

import HFlags

parseBootnodeString :: String -> [String]
parseBootnodeString "" = []
parseBootnodeString s | not $ elem '[' s = [s]
parseBootnodeString s = read s

defineFlag "u:pguser" ("" :: String) "Postgres user"
defineFlag "P:pghost" ("" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "K:kafkahost" ("" :: String) "Kafka hostname"
defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "Vault-Wrapper URL"
defineFlag "z:zkhost" ("localhost" :: String) "Zookeeper hostname"
defineFlag "z:lazyblocks" (False :: Bool) "Don't mine empty blocks"
defineFlag "addBootnodes" True "Adds bootnodes to the peer DB at setup time.  If set to false, the peer will not be able to initiate a connection to the network by itself (this option is useful if you want to set up a peer to itself be a bootnode in a private network)"
defineCustomFlag
  "stratoBootnode"
  [|[] :: [String]|]
  "STRING_LIST"
  [|parseBootnodeString|]
  [|show|]
  "Replaces the default set of public boot nodes with the provided ip address(es), considered as the address of a strato node(s)"

defineFlag "blockTime" (13 :: Integer) "Blocktime"
defineFlag "minBlockDifficulty" (131072 :: Integer) "Minimum block difficulty"
defineFlag "R:redisHost" ("localhost" :: String) "Redis BlockDB hostname"
defineFlag "redisPort" (6379 :: Int) "Redis BlockDB port"
defineFlag "redisDBNumber" (0 :: Integer) "Redis database number"

defineFlag "minPeers" (0 :: Int) "Threshold for discovery to stop querying for more peers"
defineFlag "genesisBlockName" "livenet" "use the alternate stablenet genesis block"

defineFlag "generateKey" (True :: Bool) "Whether or not to generate a new nodekey, if there isn't one in the vault"
$(return [])
