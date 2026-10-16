-- | Which part of a STRATO node a directory runs.
--
-- The monolith is 'RoleNode'. Splitting it, a 'RoleCore' directory runs the
-- consensus, VM and indexing processes with their own Postgres, Redis and
-- broker, and a 'RoleApi' directory runs strato-api and ethereum-jsonrpc
-- with the nginx sidecar, PostgREST and the edge Redis, pointed at a core's
-- Postgres and broker. A 'RoleValidator' directory is a lite validator: the
-- chain processes and the Redis block index they need, apex for the network
-- monitor, and nothing that serves users or APIs (no app, no Cirrus, no SQL
-- block index). A 'RoleApiNode' directory is a full node without the
-- services that only serve people: the chain, Cirrus and every API behind
-- nginx, but no app, SMD or Swagger docs, and with @--monitoring=false@ no
-- Prometheus or apex either. The role decides what strato-setup generates:
-- which directories and secrets, which processes go into commands.txt, which
-- containers go into docker-compose.yml, and whether a genesis trie and a
-- node key are needed at all.
module Blockchain.Init.Role
  ( Role (..),
    currentRole,
    parseRole,
    roleName,
    roleRunsCore,
    roleRunsApi,
    roleIndexesSql,
    roleAllowsMonitoringOff,
  )
where

import Blockchain.Init.Options (flags_apiNode, flags_role, flags_validator)
import Data.Char (toLower)

data Role = RoleNode | RoleCore | RoleApi | RoleValidator | RoleApiNode
  deriving (Eq, Show)

-- | From @--role@, or the shorthands @--validator@ and @--apiNode@; unknown
-- values and contradictory flags are a setup error, not a silent default.
currentRole :: Role
currentRole = either error id $ parseRole flags_role flags_validator flags_apiNode

-- | The role named by @--role@ and the shorthand flags @--validator@ and
-- @--apiNode@, in that order. @--validator@ wins over @--role@, as it always
-- has (strato-up notes the override). @--apiNode@ is stricter: given together
-- with @--validator@, or with a @--role@ other than @api-node@ or the default
-- @node@, it is an error rather than a guess.
parseRole :: String -> Bool -> Bool -> Either String Role
parseRole roleFlag validator apiNode
  | validator && apiNode = Left "--validator and --apiNode name different roles; pass one of them"
  | apiNode && named `notElem` ["node", "api-node"] = Left $ "--apiNode conflicts with --role=" ++ roleFlag ++ "; pass one of them"
  | apiNode = Right RoleApiNode
  | validator = Right RoleValidator
  | otherwise = case named of
      "node" -> Right RoleNode
      "core" -> Right RoleCore
      "api" -> Right RoleApi
      "api-node" -> Right RoleApiNode
      "validator" -> Right RoleValidator
      other -> Left $ "Unknown --role " ++ show other ++ "; expected node, core, api, api-node or validator"
  where
    named = map toLower roleFlag

roleName :: Role -> String
roleName RoleNode = "node"
roleName RoleCore = "core"
roleName RoleApi = "api"
roleName RoleValidator = "validator"
roleName RoleApiNode = "api-node"

-- | Runs the chain: p2p, sequencer, vm-runner, indexers, and their stores.
roleRunsCore :: Role -> Bool
roleRunsCore = (/= RoleApi)

-- | Serves the HTTP API: strato-api, ethereum-jsonrpc, nginx, PostgREST.
roleRunsApi :: Role -> Bool
roleRunsApi role = role `elem` [RoleNode, RoleApi, RoleApiNode]

-- | Keeps the SQL block index and Cirrus: strato-indexer's SQL side,
-- slipstream, and the state diffs the VM computes for them. A validator
-- keeps the chain and the Redis block index only.
roleIndexesSql :: Role -> Bool
roleIndexesSql = (/= RoleValidator)

-- | May drop Prometheus and apex (@--monitoring=false@), and with them
-- @/health@: only an api-node, for operators with their own monitoring.
-- Anywhere else the flag would be a silent no-op, so setup refuses it.
roleAllowsMonitoringOff :: Role -> Bool
roleAllowsMonitoringOff = (== RoleApiNode)
