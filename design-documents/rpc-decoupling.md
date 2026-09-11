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

**Measured through the service** (harness, local Postgres): 202 commands, a
mean of 5.4 ms per command inside the service including the per-request
context and the prefetch, against 2.2 ms for the same call in-process. The
gap is the fresh context and two extra middleware layers per request; a
context pool would close most of it if it matters.

**Still open.** Parity on a follower core's real mirror before routing
mainnet traffic; the prefetch threshold from real row counts; and the
API-role directory today runs vm-query against its own `sqlConfig` (the
writer endpoint), so point `sqlReaderConfig` at the reader before scaling
it out.
