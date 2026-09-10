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

## Stage 3: `vm-query`, a SQL-backed query VM (spike before building)

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
