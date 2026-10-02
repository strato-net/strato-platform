# RPC decoupling

Phase 5 of the tiered deployment. Goal: the JSON-RPC tier stops depending on
the consensus vm-runner and the core's Kafka, in three stages. Stages 1 and 2
are on the branch; stage 3 is a design with a spike to run before building.

## Stage 1: balances and storage from the SQL mirror (done)

`ethereum-jsonrpc` used to answer `eth_getBalance` by writing a `balanceOf`
`eth_call` to `vm_tasks` and long-polling `jsonrpcresponse`, so every wallet
refresh competed with block execution on vm-runner. `eth_getStorageAt` was
unimplemented. Both are now answered by the new `SqlState` module through
strato-api's Postgres-backed endpoints (`/eth/v1.2/account`, `/eth/v1.2/storage`),
which on an API-role node read the Aurora reader endpoint:

- **`eth_getBalance`**: the native token's balances mapping row
  `_balances[<40 lowercase hex digits>]` on `nativeTokenAddress`
  (`storage` table, joined to `address_state_ref`). A missing row is a zero
  balance. The mapping name is configurable as
  `contracts.nativeTokenBalancesField` in ethconf (default `_balances`,
  the OpenZeppelin layout the Mercata token uses). With no native token
  configured (`nativeTokenAddress = 0`) the account's own balance column is
  the answer. If the mirror cannot answer (strato-api unreachable, the token
  is an EVM contract, or the value is not an integer) the old vm-runner path
  runs as a fallback and the reason is logged, so behaviour on a chain the
  mirror does not cover is unchanged. Whether the token is a SolidVM contract
  is resolved once per process.
- **`eth_getStorageAt`**: the key is either an EVM slot (`0x` hex) or, as a
  STRATO extension, a SolidVM storage path (`owner`, `_balances[00..ab]`,
  `positions[3].size`). SolidVM contracts have no numbered slots, so a slot key
  on one reads as an empty word, which is what EIP-1967 proxy probes and
  similar tooling expect. A missing path is an empty word. Values are
  right-aligned into 32 bytes (integers, booleans, addresses, enums); strings,
  bytes and decimals come back as their raw bytes. Accounts without a contract
  name but with code are EVM contracts, whose storage the statediff writer
  does not mirror (`EVMDiff` is skipped), so those return an error rather
  than a wrong zero.

Both are latest-only: the block tag is accepted for wire compatibility and
ignored, as the VM path already ignored it. `eth_getCode` and
`eth_getTransactionCount` were already SQL-served. The methods still routed
to vm-runner are `eth_call`, `strato_simulateV1` and the `strato_trace*`
family.

## Stage 2: follower-core RPC cells (setup support done)

An RPC cell is a whole node (`--role=node`) whose sequencer never votes,
proposes or drives round changes, even if its key is in the validator set:

```
strato-up --role=node --validatorBehavior=false --jsonrpc <dir>
```

`strato-setup --validatorBehavior=false` renders
`strato-sequencer ... --validatorBehavior=false` into `commands.txt`
(blockstanbul's `createNewViewTimer` and vote paths already honour the flag;
the sequencer help lists it as `--validatorBehavior[=BOOL]`). Everything else
is a normal node: it syncs by P2P, executes every block on its own vm-runner,
indexes into its own Postgres, and its `ethereum-jsonrpc` talks to its own
local Kafka for `eth_call`. Put N of them in an NLB target group and move
weight from the validators' RPC endpoints to the cells. `--regenerate` may
flip the flag on an existing directory (it is not part of the network
identity guard).

What a cell does not do: it does not reduce Postgres count, since each cell
indexes for itself. That is the reason stage 3 exists.

## Stage 3: `vm-query`, a SQL-backed query VM (spike done, see results below)

### Finding: the handlers are already monad-generic

vm-runner's JSON-RPC handlers (`Blockchain.JsonRpcCommand.runJsonRpcCommand'`)
are written against the `VMBase m` constraint set (`vm-tools`
`Blockchain.VMContext`), and sandboxed execution
(`runJsonRpcCommandSandboxed`) layers `MemContextM 'Sandboxed` over any
`VMBase m`. So `vm-query` is not a second VM: it is a new base monad,
`SqlContextM`, whose instances read Postgres instead of LevelDB, running the
existing handlers unchanged. The constraints and where each would read:

| `VMBase` constraint | Today (vm-runner) | `SqlContextM` |
|---|---|---|
| `Address Alters AddressState` | state trie | `address_state_ref` (nonce, balance, code hash, contract root). The `CodeHash` variant (externally owned vs SolidVM collection) must be rebuilt from `contract_name`; verify against the trie. |
| `Keccak256 Alters DBCode` | LevelDB code DB | `code_ref` (`code` is source text). SolidVM must then parse and typecheck per hash, so keep an in-process code collection cache keyed by hash, as vm-runner's LevelDB cache does. |
| `RawStorageKey Alters RawStorageValue` | storage trie via mem caches | `storage` joined to `address_state_ref` by `(address, key)`. The mem-cache layers (`getMemRawStorageTxDB`) stay, so a slot is read once per command. |
| `Keccak256 Alters BlockSummary` | block summary DB | `block_data_ref` by hash (needed for `block.blockhash`, header fields). |
| `Maybe Word256 Alters MP.StateRoot` | best state root by block | `block_data_ref` state root, or unused when every read goes through the rows above. |
| `MP.StateRoot Alters MP.NodeData`, `NibbleString Alters NibbleString` | trie nodes and hash preimages | Not served. Instances fail loudly. Any handler path that hits them (whole-struct copies or deletes via `getAllSolidStorageKeyVals'`, flushes) is exactly what the spike must find. |
| `HasCodeDB`, `HasMemAddressStateDB`, `HasMemRawStorageDB`, `Modifiable MemDBs / ContextState / GasCap / BlockHashRoot / CurrentBlockHash / DebugSettings / VmTracer`, `HasPendingMPNodes` | in-memory | in-memory, reused as is. |

### Semantics

- **Latest only.** The mirror holds one version of each row. A command runs
  inside one `REPEATABLE READ` transaction on the reader so every read sees
  the same block; `indexer_progress` read at the start says which block that
  was, and the response should carry it (log line now, header later).
- **Historical block tags** stay unsupported, as they effectively are today.
- **Writes** never leave the sandbox overlay, as now.

### Spike plan (one week, needs a follower core with `sqlDiff` on)

1. **Storage parity.** On a quiesced follower, for every `address_state_ref`
   row compare the `storage` rows with `getAllSolidStorageKeyVals'` from the
   trie at the same block. Watch the text round trip in particular: values
   are stored through `formatBasicValue` and read back through `basicParse`,
   and `BBytes` (`hex"..."`) and `BDecimal` have no matching parse pattern,
   so those rows may not round-trip at all. That is a bug to fix in the
   mirror before `vm-query`, and it also affects stage 1's
   `eth_getStorageAt` for such fields.
2. **Result parity.** Capture a day of mainnet `eth_call` traffic, replay it
   through `SqlContextM` and through vm-runner, diff outputs and gas.
3. **Latency.** Count SQL round trips per call for the top contracts
   (PriceOracle-heavy calls touch tens to hundreds of slots). One local
   round trip is roughly 0.2 to 0.5 ms, one to an Aurora reader about 1 ms,
   so a 200-slot call moves from a few ms to 200 ms without prefetching.
   Mitigations to measure: prefetch all rows of the callee address in one
   query when the address has fewer than N rows; prepared statements; a
   short-lived per-address row cache invalidated by `indexer_progress`.
4. **Trie walks.** Run the replay with the trie instances failing loudly and
   list every handler path that reaches them.

Go/no-go: parity clean after the mirror fix, p99 latency within 2x of
vm-runner for the top 20 contracts. Then build `vm-query` as an executable in
`core/vm-runner`, wire `ethereum-jsonrpc` to call it in-process (or over
localhost) for `eth_call`, simulate and trace, and the RPC tier is
Postgres-only.

## Spike results (2026-09-10)

Built as `core/vm-query`: `Blockchain.VmQuery.SqlContext` is a base monad
satisfying `VMBase` from Postgres (accounts from `address_state_ref`, slots
from `storage`, code from `code_ref`, headers from `block_data_ref`, writes
into the per-command overlay, trie reads failing loudly), and vm-runner's
`runJsonRpcCommand'` runs on it unchanged. `core/vm-query/spike/run-spike.sh`
brings up a throwaway Postgres, migrates the eth tables, seeds a SolidVM
contract with a scalar and a 256-key mapping through the same rows the
indexer writes, and runs `eth_call` cold and warm.

**Finding 1, a VM change was needed.** SolidVM's state machine has its own
`Alters` instances for accounts and storage whose fallback called the
memory-overlay helpers directly, and those hardcode the trie walk, so a SQL
base was never consulted and every call failed with "no contract deployed".
The fallbacks now delegate to the base monad's instances after the frames
and the run's own overlay maps (`Blockchain.SolidVM.SM`). For vm-runner the
base instance is the same overlay-then-trie lookup it called before, so
consensus execution is unchanged; the change is what lets any other base
serve state.

**Finding 2, the mirror's value decoder was the bottleneck, not Postgres.**
`basicParse` compiled seven regular expressions per value: about 90 µs per
integer, 22 ms to decode 257 slots. It now compiles them once and takes a
digits-only fast path: 0.3 µs per integer (300x), 9 µs per address (5x).
strato-api's storage endpoint and the history service's Cirrus reads benefit
equally; the change is semantics-preserving (the same patterns in the same
order).

**Finding 3, no handler path walked the trie.** The only trie read was the
empty-trie root the sample's account carries as its contract root, which the
context answers; the counter stayed at zero across every call. Real data
(non-empty contract roots) will show whether any handler still walks a
storage trie; that is the one thing this harness cannot prove.

**Parity.** Every call returned the expected value, and `total(64)` matched
the in-memory VM fed the same rows byte for byte.

**Cost, warm, local Postgres, per call** (two round trips per call: the
account row, cached per command, and one whole-contract prefetch of its
storage, with a per-slot query only for contracts above 4096 rows):

| Call | Slots touched | SQL round trips | p50 latency |
|---|---|---|---|
| `get()` | 1 | 2 | 2.2 ms |
| `at(7)` | 1 | 2 | 2.1 ms |
| `total(16)` | 16 | 2 | 3.1 ms |
| `total(64)` | 64 | 2 | 3.9 ms |
| `total(256)` | 256 | 2 | 5.6 ms |

Before the caches and prefetch it was two round trips per slot (514 for
`total(256)`, 230 ms), and before the decoder fix the prefetch alone cost
30 ms. Against an Aurora reader at about 1 ms per round trip, a call costs
roughly 2 ms plus the prefetch parse.

**Go/no-go.** Go for the read path: the handlers run unchanged, results
match, and a call is a handful of milliseconds. Before building it out:

1. Run the harness's parity mode against a follower core's mirror on real
   contracts (PriceOracle, the pools), where contract roots are real and
   any remaining trie walk will throw `TrieAccess`.
2. Decide the prefetch threshold from the mirror's row-count distribution;
   contracts far above 4096 rows fall back to one query per slot.
3. ~~Wrap it as a service.~~ Done, see below.

## The service (2026-09-10)

`vm-query serve` (port 8546) is the wrapper. It speaks the queue's own wire
format: `POST /command` takes a Binary-encoded `JsonRpcCommand` and returns
a Binary-encoded `JsonRpcResponse`, so ethereum-jsonrpc's `callVM'` posts the
same bytes it would have put on `vm_tasks` and reads the same reply. Each
request runs on a fresh context over a shared connection pool (its own
overlay and caches; the code collection cache is process-wide); the best
block header is re-read from the mirror at most once a second. A semaphore
bounds concurrent commands (`--maxConcurrent`, 16); past twice that many
waiting, requests are shed with 503. `GET /health` reports the mirror's best
block and its age; `/metrics` has request counts by command and outcome, a
latency histogram and the in-flight gauge. Request spans continue the
caller's trace (`traceparent`).

**Routing.** With `vmConfig.vmQueryUrl` set, ethereum-jsonrpc sends
`eth_call`, `eth_call` v2, `strato_traceCall` and `strato_simulateV1` to the
service and everything else to the queue as before. The service answers
what the mirror holds and declines the rest with an error whose message
starts with `vm-query:` (a historical block, a trace-bound read, a block
replay), and ethereum-jsonrpc then falls back to the consensus VM for that
command, as it does when the service is unreachable. Nothing is lost by
turning it on; what is gained is that the read traffic leaves vm-runner.

**Turning it on.** `strato-setup --vmQuery` adds the process to
`commands.txt` and sets the URL in ethconf; the API container takes
`VM_QUERY=true` (the api-tier app's `-c vmQuery=true`), and the API image
ships the binary.

**Context pool and the per-block read cache.** Contexts are pooled and
reset between requests (acquire and reset measured at 6 to 10 µs, so the
per-request context was never the cost: about 90 percent of a warm call
was its two Postgres round trips, 3 to 4 ms on a warp thread against 2.3 ms
from a plain main thread, a runtime and IO-manager effect that running the
command on a bound thread narrows only within run-to-run noise). What
changes the picture is keeping the mirror reads: account rows, prefetched
storage and single slots stay cached across requests while the mirror's
best block is unchanged, and are dropped when it advances. That is sound
because strato-indexer commits a block's header and its state diffs in one
transaction, so an unchanged best block means unchanged rows. Measured
through the service against local Postgres, 200 back-to-back calls over one
connection: 0.15 ms per round trip including the HTTP hop, zero SQL round
trips per call, 0.14 ms mean inside the service (the first call after a
block advances pays the two queries, 2 to 4 ms). The command's own writes
still live in the per-request overlay, consulted before the cache, so a
sandboxed write never leaks between requests.

**One snapshot per block epoch.** Each epoch is a `REPEATABLE READ`,
read-only transaction held open on a pooled connection, with the best
header read inside it; every cache miss of the epoch runs on that
connection (serialised by an MVar, which only misses contend for), so the
rows a call sees are exactly the state of the header it executes against,
never a row from the next block. Every header refresh interval
(`--headerMaxAgeSeconds`, 1 s) the service looks at the mirror through a
fresh transaction: same best block and an epoch younger than
`--snapshotMaxAgeSeconds` (30 s) keeps the epoch; otherwise the fresh
transaction becomes the epoch, the old one is retired, and its connection
returns to the pool once the last request holding it finishes (requests
hold epochs by reference count). The maximum age exists because a reader
endpoint may cancel a long transaction; re-pinning on the same block keeps
every cache valid. `/health` reports `snapshotAgeSeconds`. The harness
advances the mirror by a block mid-run and checks that the service reports
the new block, drops its caches and pays its queries on the new snapshot.

Reads are therefore consistent within an epoch and at most one refresh
interval behind the mirror.

**Cache cap.** Each pooled context caps its row cache (`--cacheMaxRows`,
200000 by default, a few hundred bytes per row) and its account cache at a
tenth of that. The cap is enforced before a fill, never between a fill and
the read that needed it, so a read always sees what it just loaded; past
the cap the caches are dropped whole and refilled on demand. A contract
with more rows than the cap (or than the 4096-row prefetch limit) is read
slot by slot instead of prefetched, and remembered as such for the epoch.
A context's memory is therefore bounded at about twice the cap, and the
service's at that times the pool size. `vm_query_cache_rows` and
`vm_query_cache_evictions_total` show what it is doing; the harness runs
the service with caps of 100 and 30 rows against a 257-row contract and a
call touching 64 slots, checks the results are unchanged, and reads the
eviction counter.

**Parity against testnet (2026-09-10).** `spike/run-testnet-parity.sh`
imports real contracts from a node's public read API (`vm-query import
<nodeUrl> <address>...`: last block header, `/account`, `/code/{hash}` and
`/storage` rows, proxies followed through their `logicContract` slot) into
a throwaway Postgres and compares `eth_call` on the query VM with the node's
own JSON-RPC, which runs the trie-backed consensus VM. Against
`app.testnet.strato.nexus` at block 543180: the price oracle proxy (356
rows), the lendUSDST token proxy (37 rows) and the native token (1056
rows) plus their three logic contracts imported cleanly with every code
hash verified, and all 16 calls matched byte for byte: queue size, oracle
rates and rebase factors, total supplies, decimals, funded and unfunded
balances, name and symbol. The query VM reproduces the node's answers even
where those are quirks of the node itself (a populated public mapping whose
getter answers zero, string getters that return only the offset word), which
is the point: the handlers run unchanged, only the state provider differs.

One importer lesson: the API serves stored code as JSON, so a single-file
source arrives as a JSON string and a multi-file collection as a JSON
array. The importer decodes the string form before storing it (the VM
compiles the stored text as a literal source otherwise, which yields a
contract with no functions), and it checks the keccak of what it stores
against the account's code hash.

The import is a snapshot of the mirror tables as a follower core would
hold them, taken through the same decoder strato-api uses, so it exercises
the SQL representation the service will read in production. What it does
not exercise is the indexer writing those rows block by block; the
follower-core deployment does that, and its parity run is this harness
pointed at the follower's own database.

**Reader endpoint (2026-09-10).** Epoch snapshots are opened on the eth
database's read pool (`sqlReaderPool`), which `createSQLDB` points at
`sqlReaderConfig` when ethconf names one and at the writer otherwise. On an
API-role node `api-doit.sh` already derives `sqlReaderConfig` from
`postgres_reader_host`, so vm-query in that container reads the Aurora
reader with no further configuration; the service logs which endpoint it
uses at startup and reports it as `sqlEndpoint` in `/health`. Because the
header is read inside the snapshot transaction, a lagging replica only
makes the service answer as of the replica's block, never with rows from
one block and a header from another. A reader may also cancel a snapshot
transaction that conflicts with replay, or drop it on a failover. The
service treats a Postgres or socket error under a command as a mirror
failure rather than a VM error: the epoch is marked broken (its connection
is destroyed instead of returned to the pool), the refresh replaces it at
once whatever the block, and the command runs a second time on the new
epoch before any error reaches the caller. `vm_query_requests_total` counts
these under `outcome="mirror_failure"`, and the log says when an epoch
rotates and why. The harness runs its service with a distinct reader pool
(the same database under another host spelling), terminates the epoch's
backend with `pg_terminate_backend`, and checks that the next cold call is
answered with one logged retry.

**Prefetch threshold (2026-09-10).** The whole-contract prefetch reads a
contract's rows in one query the first time a context touches one of its
slots in an epoch; above the threshold the contract is read slot by slot.
The threshold was set from two measurements.

*What a prefetch costs.* `spike/run-prefetch-bench.sh` grows one contract
from 256 to 262144 rows inside a 2M-row storage table (20k other contracts;
testnet's table holds 2.27M rows) and times a cold call, in SQL, on local
Postgres:

| rows | prefetch | one slot, slot by slot | 64 slots, slot by slot |
|---|---|---|---|
| 256 | 3.5 ms | 3.1 ms | 36 ms |
| 1024 | 8.6 ms | 3.1 ms | 33 ms |
| 4096 | 21.6 ms | 2.9 ms | 36 ms |
| 16384 | 70 ms | 15 ms | 37 ms |
| 65536 | 251 ms | 6.2 ms | 44 ms |
| 262144 | 698 ms | 6.5 ms | 43 ms |

So a prefetch costs about 2 ms plus 3 to 5 µs per row (transfer plus row
decode), and a slot read costs one round trip, 0.5 ms here in a batch and
about 1 ms against an Aurora reader. In round trips, prefetching N rows
costs roughly N/250. It is paid once per epoch per context (each pooled
context has its own cache), so the tax of a threshold T is at most
T x 4 µs on the first call after each block, per hot contract, per
context.

The same bench found that the mirror had no index on the storage table's
`address_state_ref_id` column (only on `key`), so reading one contract's
rows scanned the whole table: the 256-row prefetch cost 26 ms at 2M rows,
and would grow with the mirror. `DataDefs.indexAll` now creates
`storage_address_state_ref_id_key_idx` on `(address_state_ref_id, key)`,
which the indexer applies at bootstrap (concurrently, so a live mirror
gets it on its next indexer start) and which also serves the single-slot
read and strato-api's `/storage?address=`. The table above is with that
index; the harness seeds it too.

*What contracts look like.* A survey of every storage row through the
public read API (mainnet at 370k rows, testnet at 2.27M):

| | mainnet | testnet |
|---|---|---|
| contracts with storage | 24323 | over 90000 (sampled) |
| at most 100 rows | 99.9% | about 99.9% |
| above 1024 rows | 7 | about 15 |
| above 4096 rows | 4 | 12 |
| largest | 34255 (OrderBook: `allOffers[]`, `isBookOffer[]`) | 247226 (RollupCore: `blocks[]`) |

On mainnet the contracts that `eth_call` traffic concentrates on all sit
under the threshold: the price oracle proxy at 241 rows, the native token
at 1223 (887 balances), the token factory at 1755, the lending pools and
tokens in the hundreds. The contracts above it are append-only logs and
registries (the order book, a bridge's `processedEvents[]` at 12.7k, the
deposits and withdrawals ledger at 12.7k, the market factory at 9.6k),
whose calls read a few slots each; prefetching them would cost 45 to 150
ms per epoch per context for nothing. Testnet, with six times the rows, tells the same story: the contracts above the threshold are five rollup cores (`blocks[]` and `batches[]` ledgers of 10k to 247k rows), two order books (177k and 64k), the same bridge and market-factory shapes, and the light client's `committeePubkeys[]` at 4.9k, while the oracle (356 rows), the native token (1056), the vault registry (459) and the lending token (37) all prefetch. The testnet numbers come from every tenth page of the table plus exact counts of the contracts the sample ranked highest; the mainnet ones from every row.

*Decision.* The threshold stays at 4096 rows (`--prefetchMaxRows`), now
for a reason: it holds every hot contract on both networks with headroom
for the native token to triple its holders, its worst first-call penalty
is about 20 ms, and everything above it is a log or registry. Two things
guard the cliff at the threshold. `vm_query_prefetch_rows` (a histogram of
prefetch sizes) and `vm_query_prefetch_declined_total` show when a hot
contract grows past it. And a contract above the threshold is promoted: a
context that has read 64 of its slots in one epoch (`--prefetchAfterSlots`)
prefetches it whole after all, up to the cache cap, so a call that walks
an array of offers pays one query instead of one per element
(`vm_query_prefetch_promoted_total`). The harness checks this with a
100-row threshold on its 257-row contract: `total(64)` costs 35 round
trips with promotion after 32 slots and 67 without, and the next call
none.

**Live follower mirror (2026-09-11).** The run happened on a core cell
deployed with the ha-infra repo's `core-cell` into a personal AWS account against an
Aurora cluster from its `data-plane`: a full node (`--role=node`) that
synced Mercata **mainnet** from genesis (194.8k blocks in about eight hours,
bound by the p2p block fetch) and then followed the live tip, its indexer
holding the writer lease and building the SQL mirror in Aurora as it went.
`spike/run-follower-parity.sh` ran on the host itself (`VMQ_BIN` pointing at
the image's vm-query, `STRATO_CONF` at the node's own ethconf), so no
database credential left the machine. At block 194837 all 16 calls matched
byte for byte twice over: against the same node's JSON-RPC (the trie-backed
consensus VM reading the same LevelDB) and against the public mainnet RPC
at app.strato.nexus. The oracle, the lendUSDST token and the native token
on mainnet hold 250, 103 and 1223 rows; the funded balances and total
supplies compared were non-zero.

Costs seen on that host (an m6i.xlarge with Aurora db.t4g.medium in the
same VPC): the first call on a contract in an epoch is 400 to 860 ms, which
is the SolidVM code-collection compile of the contract's source plus the
whole-contract prefetch over the network, and every call after that is 0.8
to 1 ms end to end over the wire, matching the local harness. The 16 calls
prefetched 1576 rows. The cell was given the composite storage index by the
indexer's own bootstrap, so the prefetches were index reads from the start.

Two things the run surfaced that were not visible locally: the per-cell
peer store cannot be used yet (strato-p2p reads block data through the same
pool it uses for peers, so a separate peer database stops the sync), and
the compile cost of the first call per contract per epoch is the largest
remaining latency term for the query VM; caching compiled code collections
across epochs (the source does not change with the block) is the obvious
next step.

`spike/run-follower-parity.sh` compares against whichever RPC `NODE` names
and takes the contract and holder addresses from the environment, so the
same run works on testnet (`--network=helium`) once a cell follows it.
