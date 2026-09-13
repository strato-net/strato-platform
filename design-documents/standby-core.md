# Standby core and promotion

Phase 6 of the tiered deployment. Two (or more) cores share one Postgres
cluster. Every core executes every block on its own vm-runner and keeps its
own trie, Redis and local Kafka; exactly one of them, the **writer**, indexes
into the shared cluster. A **standby** follows the chain and the writer's
progress rows without writing, and takes over the writer role by taking the
**writer lease**. Promotion is a row update, not a restart, and the promoted
core resumes within a batch of where the writer stopped.

## The writer lease

`writer_lease` (eth database, one row, name `core`) names the cell that may
write: `holder`, `claimed_at`, `heartbeat_at`. A cell is a core's name among
the cores sharing the cluster: `--cellId` at setup, default the hostname.

- **Claim at startup.** `strato-indexer` (default `--writer=true`) takes the
  lease when it is unheld, already its own, or its holder's heartbeat is
  older than 30 seconds. A configured writer that finds another cell
  heartbeating logs that and runs as a standby. `--writer=false` never claims.
- **Heartbeat.** The holder's indexer refreshes `heartbeat_at` every 10
  seconds and with every batch it writes.
- **Fence.** Every batch strato-indexer writes runs in one transaction whose
  first statement re-asserts the lease (`UPDATE ... WHERE holder = me`, which
  row-locks it until commit). A demoted cell's in-flight batch fails the
  fence, throws, and its indexer restarts as a standby. slipstream checks
  the lease before each batch (its Cirrus writes cross a database boundary,
  so they are idempotent rather than fenced).
- **Gated writers.** The lease gates strato-indexer's SQL side, the
  `node_status` mirror, and slipstream (Cirrus, `transaction_result`, and
  the bus egress). vm-runner, the sequencer and p2p never write the shared
  cluster.

## How a standby follows

strato-indexer now runs two consumer loops under two groups:

| Loop | Group | Runs on | What it does |
|---|---|---|---|
| Redis side | `strato-indexer` | every core | blocks and best block into the cell's Redis for strato-p2p |
| SQL side | `strato-indexer-sql` | every core | writer: indexes; standby: trails |

On the first start after this change the SQL group is seeded from the old
combined group's offset, so an upgraded monolith does not replay retention.

A standby's SQL side reads each batch, looks at the highest block it
carries, and compares it with `indexer_progress` on the cluster. If the
writer has committed that block, the standby commits its own offset past
the batch; otherwise it polls once a second until the writer catches up or
the lease becomes its own, in which case it writes the batch itself. The
group's offset therefore trails the writer by about one batch. slipstream
does the same against `cirrus_progress`. Batches without a block number
(transactions, balance updates, code collections, results) are skipped by
a standby; the writer applies them and they are idempotent on replay.

The first batch a promoted cell writes overlaps what the old writer got to.
The skip filter drops blocks, state diffs and best-block marks at or below
the progress row (and Cirrus actions at or below `cirrus_progress`); the
progress rows themselves never move backwards. Transactions and balance
updates in that batch are applied again and converge in topic order.

If a standby is left unpromoted for longer than the local Kafka's retention
(7 days), its SQL group's offset falls out of range. The consumer now
resumes from the earliest retained offset and logs it loudly instead of
crash-looping; such a cell has a gap and must be re-seeded from a snapshot
before it can be promoted.

## Per-cell tables

strato-p2p resets every peer's active state at startup and ethereum-discover
owns the peer table, so cores sharing a cluster would fight over `p_peer`
and `sync_task`. Both now live in the **peer store**: `--peerDatabase=<name>`
at setup puts them in that database on the same Postgres host, created on
first use by whichever of strato-p2p or ethereum-discover starts first.
Every core sharing a cluster needs a distinct one, the writer included. With
no `--peerDatabase` the peer store is the eth database, as on a monolith.
The API's `/peers` endpoint still reads the eth database's table, so on a
shared cluster it reports whichever core's peers ended up there; treat it
as a per-node diagnostic until it is pointed at the writer's peer store.
apex's health tables are the same shape of problem and are left for the
observability work.

## Setting up

Writer (or a monolith that will get a standby later):

```
strato-up --role=node --cellId=core-a --peerDatabase=peers_core_a --pghost=<cluster writer endpoint> --password=... <dir>
```

Standby, from the writer's snapshot (trie, Redis, local Kafka):

```
strato-up --role=node --writer=false --validatorBehavior=false --cellId=core-b --peerDatabase=peers_core_b --pghost=<same> --password=... --snapshot=... <dir>
```

On AWS, `infra/core-cell` is the CDK app for one such host: an Ubuntu EC2
instance that extracts the binaries from the strato image, runs `strato-up
--role=core` against the shared Aurora cluster with `--cellId`,
`--peerDatabase`, `--writer` and `--validatorBehavior` from its context, and
keeps convoke under systemd. `-c writer=false` (the default) is the standby
above.

Both `--writer` and `--validatorBehavior` may be changed on an existing
directory with `strato-setup --regenerate`; neither is part of the network
identity guard.

## Promotion runbook

1. **Confirm the writer is down or stopped.** Check `writer_lease` (or run
   `strato-promote --status` on the standby): a heartbeat older than 30
   seconds means the writer's indexer is not running. Stop it if it is.
2. **Promote.** On the standby, in its node directory: `strato-promote`.
   It refuses while the holder's heartbeat is fresh; `--force` overrides
   that only after step 1 is certain.
3. **Watch it take over.** Within a second the standby's strato-indexer
   logs "holds the writer lease now; resuming SQL indexing at block N" and
   `indexer_progress` advances; slipstream logs the same for Cirrus and
   `cirrus_progress` advances. `node_status` starts reflecting the new
   writer.
4. **Validator identity.** If the old writer was a validator, the standby
   was running with `--validatorBehavior=false` and keeps its own key. Only
   once the old writer is confirmed down is a validator switched on:
   `strato-setup --regenerate --validatorBehavior=true` and restart, with
   the validator set updated through governance as the network requires.
   Never run two cores with the same validator key.
5. **Re-point the edge.** With the message bus, nothing changes: the
   standby's strato-ingest already consumed `ingest_tx` under its own
   group, and its slipstream now publishes `tx_results` and `chain_events`.
   Without the bus, point the API tier's broker host at the new writer.
6. **The old writer, when it comes back**, starts as a standby: its claim
   finds a fresh heartbeat. Re-seed it from a snapshot if it was down
   longer than retention.

## What is not built here

- The standby-from-snapshot tooling (a host snapshot of trie, Redis and
  local Kafka at a recorded block) and the game day under synthetic load.
- Automatic failover. The lease has everything an automator needs (stale
  heartbeat, `strato-promote`), but the validator-identity step above is a
  human decision until the network's governance can retire a validator
  automatically.
