-- | Which part of a STRATO node a directory runs.
--
-- The monolith is 'RoleNode'. Splitting it, a 'RoleCore' directory runs the
-- consensus, VM and indexing processes with their own Postgres, Redis and
-- broker, and a 'RoleApi' directory runs strato-api and ethereum-jsonrpc
-- with the nginx sidecar, PostgREST and the edge Redis, pointed at a core's
-- Postgres and broker. The role decides what strato-setup generates: which
-- directories and secrets, which processes go into commands.txt, which
-- containers go into docker-compose.yml, and whether a genesis trie and a
-- node key are needed at all.
module Blockchain.Init.Role
  ( Role (..),
    currentRole,
    roleName,
    roleRunsCore,
    roleRunsApi,
  )
where

import Blockchain.Init.Options (flags_role)
import Data.Char (toLower)

data Role = RoleNode | RoleCore | RoleApi
  deriving (Eq, Show)

-- | From @--role@; unknown values are a setup error, not a silent default.
currentRole :: Role
currentRole = case map toLower flags_role of
  "node" -> RoleNode
  "core" -> RoleCore
  "api" -> RoleApi
  other -> error $ "Unknown --role " ++ show other ++ "; expected node, core or api"

roleName :: Role -> String
roleName RoleNode = "node"
roleName RoleCore = "core"
roleName RoleApi = "api"

-- | Runs the chain: p2p, sequencer, vm-runner, indexers, and their stores.
roleRunsCore :: Role -> Bool
roleRunsCore = (/= RoleApi)

-- | Serves the HTTP API: strato-api, ethereum-jsonrpc, nginx, PostgREST.
roleRunsApi :: Role -> Bool
roleRunsApi = (/= RoleCore)
