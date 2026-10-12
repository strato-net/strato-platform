-- | What a lite validator runs (@strato-setup --validator@).
--
-- A validator needs the chain: discovery and p2p for peers, the sequencer for
-- consensus, vm-runner to execute blocks, and the Redis block index that
-- strato-p2p serves peers from. Everything else on a full node serves users
-- and APIs, and Cirrus in particular is most of a node's disk, so none of it
-- is generated. Postgres stays only because discovery and p2p keep their peer
-- tables in it; the indexer runs with @--sql=false@ and writes nothing there.
module Blockchain.Init.Validator
  ( validatorProcesses,
    validatorCommands,
    validatorServices,
    validatorPrometheusSkipJobs,
    apexPort,
  )
where

-- | The host processes a validator runs, by program name.
validatorProcesses :: [String]
validatorProcesses =
  [ "ethereum-discover",
    "strato-p2p",
    "strato-sequencer",
    "vm-runner",
    "strato-indexer",
    "strato-network-monitor",
    "strato-logrotate"
  ]

-- | Reduce a full node's commands.txt lines to a validator's: keep the lines
-- whose program is in 'validatorProcesses', in their order, and run the
-- indexer without its SQL side.
validatorCommands :: [String] -> [String]
validatorCommands = map indexerRedisOnly . filter (keep . words)
  where
    keep (prog : _) = prog `elem` validatorProcesses
    keep [] = False
    indexerRedisOnly line = case words line of
      ("strato-indexer" : _) -> line ++ " --sql=false"
      _ -> line

-- | The containers a validator keeps: the stores the chain processes use,
-- Prometheus for the node's own metrics, and apex, whose /health is what the
-- network monitor polls (published on 'apexPort', plain HTTP: the node runs
-- no nginx to terminate TLS, and /health is public data). "streaming" only
-- exists on builds with a broker container (the default JLog backend is
-- embedded).
validatorServices :: [String]
validatorServices = ["postgres", "redis", "prometheus", "apex", "streaming"]

-- | Where a validator publishes apex (/health, /status) for the monitor.
apexPort :: Int
apexPort = 3009

-- | Prometheus scrape jobs for processes a validator does not run, dropped so
-- their targets are not reported down forever (PROMETHEUS_SKIP_JOBS). apex
-- reads the same list to know which jobs not to require for the node's health.
validatorPrometheusSkipJobs :: [String]
validatorPrometheusSkipJobs = ["core-api", "slipstream", "nginx"]
