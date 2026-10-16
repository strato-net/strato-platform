-- | Which part of a STRATO node a directory runs.
--
-- The monolith is 'RoleNode'. Splitting it, a 'RoleCore' directory runs the
-- consensus, VM and indexing processes with their own Postgres, Redis and
-- broker, and a 'RoleApi' directory runs strato-api and ethereum-jsonrpc
-- with the nginx sidecar, PostgREST and the edge Redis, pointed at a core's
-- Postgres and broker. A 'RoleValidator' directory is a lite validator: the
-- chain processes and the Redis block index they need, apex for the network
-- monitor, and nothing that serves users or APIs (no app, no Cirrus, no SQL
-- block index). The role decides what strato-setup generates: which
-- directories and secrets, which processes go into commands.txt, which
-- containers go into docker-compose.yml, and whether a genesis trie and a
-- node key are needed at all.
module Blockchain.Init.Role
  ( Role (..),
    currentRole,
    roleName,
    roleRunsCore,
    roleRunsApi,
    roleIndexesSql,
  )
where

import Blockchain.Init.Options (flags_role, flags_validator)
import Data.Char (toLower)

data Role = RoleNode | RoleCore | RoleApi | RoleValidator
  deriving (Eq, Show)

-- | From @--role@, or @--validator@ as shorthand for @--role=validator@;
-- unknown values are a setup error, not a silent default.
currentRole :: Role
currentRole
  | flags_validator = RoleValidator
  | otherwise = case map toLower flags_role of
      "node" -> RoleNode
      "core" -> RoleCore
      "api" -> RoleApi
      "validator" -> RoleValidator
      other -> error $ "Unknown --role " ++ show other ++ "; expected node, core, api or validator"

roleName :: Role -> String
roleName RoleNode = "node"
roleName RoleCore = "core"
roleName RoleApi = "api"
roleName RoleValidator = "validator"

-- | Runs the chain: p2p, sequencer, vm-runner, indexers, and their stores.
roleRunsCore :: Role -> Bool
roleRunsCore = (/= RoleApi)

-- | Serves the HTTP API: strato-api, ethereum-jsonrpc, nginx, PostgREST.
roleRunsApi :: Role -> Bool
roleRunsApi role = role == RoleNode || role == RoleApi

-- | Keeps the SQL block index and Cirrus: strato-indexer's SQL side,
-- slipstream, and the state diffs the VM computes for them. A validator
-- keeps the chain and the Redis block index only.
roleIndexesSql :: Role -> Bool
roleIndexesSql = (/= RoleValidator)
