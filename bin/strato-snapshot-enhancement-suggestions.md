# strato-snapshot: enhancement suggestions for snapshot size and restore time

Status: suggestions for discussion, written 2026-09-17 from measurements on a
synced helium node and a published upquark archive. Kept next to the tool so
the numbers and the open questions are at hand when this work is picked up.

## Why this document

A node restored from a published snapshot pays for the archive twice: once to
download and extract it, and once for Postgres to rebuild every index from the
dumps. Both costs are dominated by data that is either duplicated elsewhere in
the node or historical. Measurements taken on 2026-09-17 (below) show where the
bytes and the minutes go.

The snapshot tool itself was tightened at the same time (see "Already decided
or done"). What remains are three reductions that change what a node
stores, so they need a decision from the people who own the core, the indexer
and the app:

- **A.** Drop the Postgres indexes that nodes never use.
- **B.** Stop keeping every historical version of the state trie.
- **C.** Stop keeping a second copy of every block and transaction in Redis,
  or make it rebuildable.

Each proposal below has the details, the justification, the risks and the
questions to answer before deciding.

## Measurements

### Where the bytes are

Two data points: a cached upquark archive of 2026-08-27, and a synced helium
node (whose published snapshot of 2026-09-07 was 13.7 GB).

| Component | Upquark archive, uncompressed | Synced helium node on disk | zstd ratio measured |
|---|---|---|---|
| `.ethereumH/state` (LevelDB state trie) | 3.83 GB (73%) | 18 GB | 1.32x (snappy inside) |
| Redis `appendonly.aof` | 0.51 GB | 1.54 GB (1.8 GB in RAM, 4.1M keys) | 2.62x |
| Postgres dumps (eth + cirrus) | 0.57 GB | 0.88 GB | ~1.0x (already zlib) |
| Streaming state | 0.24 GB (kafka, v1) | 11 MB (jlog) | n/a |
| Whole archive | 5.23 GB -> 3.82 GB | | 1.37x |

The 6.2 GB upquark archive of September follows the same shape: the two dumps
(880 MB) are about 14% of it, Redis about 5%, and roughly 80% is the state
trie.

### Where the restore time goes

| Step | Bound by | Measured on a 4-core helium node |
|---|---|---|
| Download | network | 6 to 14 GB per snapshot |
| Checksum passes (before the streaming checksum) | disk read of the whole archive, up to three times | ~240 MB/s effective |
| Extraction | writing the uncompressed state to disk | zstd decompresses at >2 GB/s; disk writes 326 MB/s |
| Postgres load | index rebuild on 4 cores | Cirrus: 10 GB of tables, 15 GB of indexes rebuilt from a 381 MB dump |

The Postgres data directory of the helium node is 30 GB on disk although the
dumps are 0.88 GB. `pg_dump` ships table data only; every index is rebuilt by
`pg_restore`. Cirrus is 25 GB of that, and two tables are 20 GB of Cirrus:

| Cirrus table | Table data | Indexes | Rows |
|---|---|---|---|
| `history@mapping` | 4.7 GB | 11 GB | 11.2M |
| `history@storage` | 3.0 GB | 1.7 GB | 4.8M |
| `event` | 1.7 GB | 1.7 GB | 3.0M |

## Already decided or done

- **Cirrus history stays.** The `history@*` tables are used by the app, so they
  remain in the snapshot and in the restore. This document does not propose
  changing that.
- **Tool changes already made** (`bin/strato-snapshot`, in the change that added
  `pull`): a `pull` command to
  download ahead of a restart; the archive's SHA-256 is computed from the
  download stream and recorded beside the cached file, so an unchanged cached
  archive is not re-read; stale archives of the same network are pruned from
  the cache; the dumps are bind-mounted into the load container instead of
  copied; Redis compacts its AOF before the cold shutdown; LevelDB `LOG` files
  are left out; and `restore` narrates its seven steps with sizes and timings.
  Together these remove two full reads of the archive and one full write of
  the dumps per restore, and trim up to half of the Redis payload (Redis
  rewrites its AOF on its own once it has doubled, so the saving depends on
  when that last happened). They do not touch the three items below.

## Proposal A: drop indexes the node never uses

### Details

`pg_stat_user_indexes` on the helium node after 12 hours of normal operation
lists these indexes with zero scans. Sizes are what `pg_restore` rebuilds on
every restore and what every insert on a live node has to maintain.

Cirrus (`cirrus` database, defined in
`strato/indexer/slipstream/src/Blockchain/Slipstream/OutputData.hs`):

| Index | Table | Size | Scans in 12 h | Note |
|---|---|---|---|---|
| `history@mapping_pkey` | `history@mapping` | 3820 MB | 0 | primary key, enforces uniqueness: keep |
| `history@storage_pkey` | `history@storage` | 1048 MB | 0 | primary key: keep |
| `event_address_name_timestamp_idx` | `event` | 469 MB | 0 | |
| `event_name_sender_timestamp_idx` | `event` | 451 MB | 0 | |
| `event_name_timestamp_idx` | `event` | 232 MB | 0 | |
| `mapping_idx` | `mapping` | 144 MB | 0 | |
| `mapping_address_collection_key_idx` | `mapping` | 135 MB | 0 | |
| `mapping_collection_key_address_idx` | `mapping` | 128 MB | 0 | |
| `storage_status_address_idx` | `storage` | 12 MB | 0 | |
| `mapping_balances_key_value_address_idx` | `mapping` | 6 MB | 0 | |
| `mapping_collection_address_idx` | `mapping` | 5 MB | 0 | |

Eth (`eth` database, defined in
`strato/core/blockapps-datadefs/src/Blockchain/Data/DataDefs.hs`):

| Index | Table | Size | Scans in 12 h | Note |
|---|---|---|---|---|
| `unique_t_x_hash` | `raw_transaction` | 84 MB | 0 | unique constraint: keep, but it duplicates `raw_transaction_tx_hash_idx` (83 MB, 1.4M scans) |
| `transaction_result_transaction_hash_idx` | `transaction_result` | 82 MB | 0 | |
| `block_data_ref_parent_hash_idx` | `block_data_ref` | 70 MB | 0 | |
| `raw_transaction_to_address_idx` | `raw_transaction` | 18 MB | 0 | |
| `raw_transaction_block_number_idx` | `raw_transaction` | 16 MB | 0 | |

Droppable candidates total about 1.6 GB in Cirrus and 0.27 GB in eth. The
in-use indexes are clear by contrast: `mapping_history_idx` (2.7 GB) served
11.5M scans, `storage_history_idx` 4.9M, `event_pkey` 3.2M.

### Justification

Index rebuild is the longest phase of a restore and the indexes above are
rebuilt for nothing on this node. On a live node each of them is also written
on every insert into `event`, `mapping` and the history tables, which are the
hottest tables in Cirrus. Removing them is a schema change with no data loss.

### Why this is the smallest of the three

Even dropping every candidate removes about 1.9 GB of the 16 GB of indexes a
restore rebuilds, so the effect on restore time is around 10%. The archive
size does not change at all, since dumps carry no indexes. The value is in
restore time and live write amplification, not in download size.

### Risks and how to retire them

- **One node, 12 hours.** A validator or an app node may run queries this
  node never sees. Cirrus also answers ad-hoc filtered queries from the API,
  so an index can be idle for a day and matter on the day someone filters
  events by name and timestamp.
- **Method.** Collect `pg_stat_user_indexes` from every kind of node
  (validators, the app node, a developer node) over at least two weeks, and
  enable `pg_stat_statements` on one of them to see which queries the app,
  apex and PostgREST actually run. Only indexes idle everywhere are dropped,
  in a migration in `OutputData.hs` / `DataDefs.hs`.
- **Constraints stay.** Primary keys and unique indexes enforce correctness
  and are not candidates, even at zero scans.

### Questions for the team

1. Who owns the Cirrus schema and the eth schema, and is there a migration
   path for dropping an index on existing nodes, or only on fresh ones?
2. Which app, apex, SMD or PostgREST queries filter `event` by
   `(address, name, timestamp)`, `(name, sender, timestamp)` or
   `(name, timestamp)`? If none, the three `event_*_timestamp_idx` indexes
   (1.15 GB) are the first to go.
3. Are the `mapping_*` secondary indexes used by any product query, or were
   they added for a feature that no longer exists?
4. Can we run a two-week `pg_stat_user_indexes` collection on a validator and
   on the app node? Who can grant access?
5. `unique_t_x_hash` and `raw_transaction_tx_hash_idx` index the same column.
   Can the plain index be removed in favour of the unique one?

## Proposal B: prune the state trie

### Details

`.ethereumH/state` is the Merkle Patricia trie store. `putNodeData` in
`strato/core/merkle-patricia-db/src/Blockchain/Database/MerklePatricia/Internal.hs`
writes each node under `keccak(rlp(node))` and nothing in `strato/core`
deletes old nodes. Every block that changes state adds the new nodes and keeps
the old, so the store holds every historical state root's full trie, forever.
It is 18 GB on the helium node and about 6 to 7 GB for upquark, growing with
every block. LevelDB compaction cannot reclaim any of it, because nothing is
ever overwritten or deleted.

### Justification

This is 73 to 90% of every snapshot and the only component that keeps growing
without bound. Everything downstream scales with it: download time,
extraction time (disk-write bound on the uncompressed size), the disk the
node needs, and the size of the LevelDB block cache needed to keep the live
part hot. No compression setting helps; the data is already compressed inside
LevelDB and zstd gets 1.32x on it.

How much of the 18 GB is live state is not known. That number decides whether
this is a 2x or a 10x reduction and should be measured first (see below).

### Options

**B1. Prune at snapshot time only.** `strato-snapshot create` (or a helper it
calls) walks the trie from the snapshot's state root, including every
account's storage trie, into a fresh LevelDB, and ships that instead of the
raw directory. The running node is untouched; the restored node simply starts
with only the current state. Needs a trie walker (the MPT library already has
the traversal primitives), a runtime budget for walking millions of nodes at
snapshot time, and a check that the copied trie recomputes the same state
root. It does not stop the disk growth of long-running nodes.

**B2. Prune in the node.** Garbage-collect trie nodes not reachable from the
last N state roots, for example every root older than PBFT finality depth
plus a safety margin. Solves the growth problem for every node but is a core
change with the widest blast radius: reorg handling (finality makes this
tractable), historical `eth_call` / `eth_getStorageAt` / proofs at old blocks,
re-indexing paths that replay history, `vm-runner` bootstrap, and anything
that reads `sequencer_dependent_blocks` against old roots.

**B3. Do nothing.** Snapshots keep growing with the chain; the
`pull` command hides the download behind a running node but not the
extraction or the disk.

### Measure first

On an offline copy of `.ethereumH/state` (a restored snapshot, not a running
node, since LevelDB holds a lock): walk the trie from the snapshot's state
root and sum the bytes of the reachable nodes. Compare with the directory
size. The walker is also the first half of B1, so the measurement is not
wasted work.

### Questions for the team

1. Does any product feature, tool, test or support procedure read state at a
   historical block (calls or storage reads with an old block number, state
   proofs, forensics)? Which ones, and how far back?
2. Is "state older than finality depth plus margin" an acceptable pruning
   boundary for validators, or does anything re-execute finalized blocks?
3. Who owns the MPT library and `vm-runner`, and can they scope the walker
   (B1) and estimate B2?
4. Is B1 acceptable as a first step even though it only helps restored nodes,
   given that it also produces the measurement?
5. Are there other LevelDB stores that grow the same way? On the helium node
   `hash`, `code`, `blocksummarycachedb` and `sequencer_dependent_blocks`
   together are 220 MB, so today the answer is no, but that should be
   confirmed for the design.

## Proposal C: stop duplicating blocks in Redis, or make it rebuildable

### Details

`strato/core/strato-redis-blockdb` keeps a full block store in Redis. On the
helium node it holds 4.1M keys and 1.8 GB in memory: block headers (`h:`),
raw transactions (`t:`, up to several KB each), block-number sets (`n:`),
children sets (`c:`), and three smaller families (`p:`, `u:`, `q:`). The same
headers and transactions are in Postgres `eth` (`block_data_ref`, 567K rows,
588 MB with indexes; `raw_transaction`, 691K rows, 954 MB with indexes).

Modules that import `Blockchain.Strato.RedisBlockDB`: `strato-p2p`
(`Blockchain.Context`), `strato-sequencer` (`Main`, `Sequencer.Monad`),
`vm-runner` (`BlockChain`, `Bootstrap`, `EthereumVM`, `EthereumVM2`),
`vm-tools` (`VMContext`, `Wiring`), `blockDB` (`BlockDB`, `SyncDB`),
`ethereum-discovery` (`ContextLite`), `strato-api` (`Main`,
`Handlers.Metadata`), `slipstream` (`MessageConsumer`), and the
`blockapps-tools` Redis tool. In other words, every core process reads it.

In the snapshot, Redis is the append-only file, which Redis rewrites on its
own only once it has doubled: on the helium node it was 1.54 GB against a
0.82 GB base, and 1.49 GB against a 1.49 GB base right after a rewrite (the
node was still catching up, so the dataset itself grew in between). It compresses 2.6x and is 5 to 10% of an archive. On a running
node it is also 1.8 GB of RAM holding data that Postgres already has on disk.

### Justification

Redis is a second source of truth for blocks that has to be kept consistent
with Postgres, costs RAM on every node, and lands in every snapshot. The
AOF compaction in `create` trims up to half of its snapshot footprint; the
remaining options change the architecture, so they need agreement.

### Options

**C1. Rebuild Redis from Postgres on restore.** Drop `redis/` from the
snapshot; `strato-snapshot restore` (or the node on first start) repopulates
Redis from the `eth` tables. Requires that every key family is derivable
from Postgres. `h:`, `t:` and `n:` clearly are. `u:` holds one-byte values
and `p:` and `q:` 33-byte values that look like sync or parent bookkeeping;
whether they can be recomputed is the first thing to check in
`RedisBlockDB/Models.hs`. Repopulating 4M keys takes minutes and moves time
from download to restore unless it runs in the background after start.

**C2. Bounded retention.** Keep only the last N blocks in Redis if its
readers only need recent blocks (sync, block propagation, the metadata
handler). Then the snapshot's Redis payload is a constant, small size and RAM
stops growing. Needs an audit of each reader listed above for reads of
arbitrary old blocks.

**C3. Keep as is.** AOF compaction before `create` is already done; the
payload stays at roughly the dataset size and grows with the chain.

### Questions for the team

1. For each reader above, does it look up arbitrary historical blocks or
   transactions in Redis, or only recent ones? `vm-runner` bootstrap and the
   API metadata handler are the likely ones to need history.
2. What are the `p:`, `u:` and `q:` key families, and are they derivable
   from Postgres or from the chain? Whoever owns `RedisBlockDB/Models.hs` can
   answer this quickly.
3. Is Redis the canonical block store for serving blocks to peers over p2p,
   and if so, would peers tolerate only recent blocks being served (C2)?
4. If C1: is a restore that is several minutes slower acceptable in exchange
   for a 5 to 10% smaller download, or should the rebuild run in the
   background after the node starts?
5. Is anyone already planning to retire the Redis block store? If so, the
   snapshot work should wait for that rather than build a rebuild path.

## Appendix: how the numbers were obtained

All read-only, on 2026-09-17, against a helium node directory (`<node-dir>`)
and a cached upquark archive (`<archive>.tar.zst`). Container names are the
ones `docker compose -p strato` gives every node.

```bash
# Archive composition by payload directory (uncompressed bytes).
zstd -dc <archive>.tar.zst | tar -tvf - | awk '{s[$6]+=$3} END {for (k in s) print s[k], k}'

# Node directory sizes.
du -sh <node-dir>/.ethereumH <node-dir>/postgres <node-dir>/redis <node-dir>/jlog

# Postgres: per-table, per-index sizes and scan counts.
docker exec strato-postgres-1 psql -U postgres -d cirrus -c "
  SELECT relname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)), idx_scan
  FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC;"

# Redis: dataset vs append-only file.
docker exec strato-redis-1 redis-cli info memory | grep used_memory_human
docker exec strato-redis-1 redis-cli info persistence | grep -E 'aof_current_size|aof_base_size'
docker exec strato-redis-1 redis-cli dbsize

# Compressibility of a component.
cat <node-dir>/.ethereumH/state/*.ldb | head -c 300M | zstd -3 -c | wc -c
```
