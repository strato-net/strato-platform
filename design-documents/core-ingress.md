# Transaction ingress and the API tier's reads

Phase 4 of the tiered deployment, second design. The first put a shared
Kafka cluster (MSK) between the edge tiers and the cores. This one has no
broker anywhere: every core cell runs the embedded JLog streaming backend,
like a monolith, and the API tier reaches the cells over HTTP for exactly
one thing, submitting transactions. Reads never reach a core.

## Submitting transactions

- **strato-ingest** (on every core cell, port 8600) is the cell's ingress:
  `POST /ingest` takes a batch of `IngestEvent`s as the bytes the stream
  carries (Binary) and appends the transactions in it to the cell's own
  durable `ingest_tx` log, which the sequencer reads under its own
  subscriber (`sequencer-ingest`). The request is answered once the append
  has returned, so a transaction the API tier reports accepted survives the
  sequencer restarting. Anything that is not a transaction is dropped and
  counted: consensus messages travel by p2p only. `GET /health` is the
  liveness check. The listener authenticates nothing itself; it sits inside
  the VPC behind the security group that admits the API tier's tasks.
- **strato-api** on the API tier posts every submitted batch to every cell
  in `ingressUrls` (comma-separated `INGRESS_URLS` in the API container,
  `--ingressUrls` for a host directory), concurrently. The submit succeeds
  when at least one cell accepted the batch; cells that did not are logged.
  Because every cell gets every batch, a standby promoted later already has
  the writer's mempool: the copies dedup by hash in the sequencer. A
  monolith (`--role=node`) has no `ingressUrls` and writes its own stream
  directly, as before.
- A cell that was down while batches were posted catches up by p2p gossip
  from the cells that took them, as a restarted monolith always has.

## Reads on the API tier

ethereum-jsonrpc on the API tier runs in **vm-query only** mode
(`vmConfig.vmQueryOnly`, set by the API container and by
`strato-setup --role=api`): calls, simulations and call traces go to the
vm-query instances in `vmConfig.vmQueryUrls`, tried in order, the
container's own first and then the other copies' (`VM_QUERY_URLS`). An
instance that cannot be reached hands the command to the next; when none
can, the call fails with an error. A decline is final, since every instance
reads the same mirror. What the mirror cannot serve at all, `eth_getProof`
and the block replays behind `strato_trace*` and `debug_traceBlockByHash`,
is answered with an error on this tier; those need a node with the trie.
The vm-runner reply path (`jsonrpcresponse`) is not opened in this mode.

On a node, vm-query stays optional and ethereum-jsonrpc falls back to the
node's own vm-runner, as before.

## What the message bus used to carry, and what replaces it

| Was | Now |
|---|---|
| `ingest_tx` on MSK, consumed by strato-ingest on every cell | HTTP to every cell's strato-ingest |
| `tx_results`, waking strato-api's `resolve=true` waits | strato-api polls Postgres (a hundred rounds of 100 ms) |
| `chain_events`, the app history service's live feed | the history service's Cirrus poller, one page per interval |

The two feeds cost latency, not completeness: the resolve wait and the
history charts trail the chain by their polling interval. A push path for
them can be added later without touching the submit path.

## Setup

- Core cell: `strato-setup --role=core ...` adds `strato-ingest --port=8600`
  to `commands.txt` (`--ingressPort` changes it) and scrapes its metrics
  (`strato_ingest_accepted_total`, `strato_ingest_dropped_total` on 10781).
- API directory: `strato-setup --role=api --ingressUrls=http://cell-a:8600,http://cell-b:8600 --vmQuery --vmQueryUrls=http://api-b:8546 ...`.
- API container (`docker-compose.api.tpl.yml`, the ha-infra api-tier app):
  `INGRESS_URLS` (required), `VM_QUERY` (default true), `VM_QUERY_URLS`.
- The core tier's load balancer and the cells' external Kafka listener are
  gone: the API tier addresses cells directly, on port 8600.
