# merkle-patricia-db-baremetal

A C implementation of the Merkle Patricia trie with the same Haskell module
names and function names as `merkle-patricia-db`, so the trie backend is
chosen by a package line and nothing else.

## Switching the node to the C trie

Two `package.yaml` lines. Stack regenerates the `.cabal` files on `make`;
commit both.

| file | from | to |
|---|---|---|
| `strato/libs/composable-monads/statedb-monad/package.yaml` | `merkle-patricia-db` | `merkle-patricia-db-baremetal` |
| `strato/core/blockapps-mpdbs/package.yaml` | `fastMP` | `merkle-patricia-db-baremetal` |

Then `make` from the repo root. Switching back is the same two lines in
reverse. No other file changes; the rest of the system is written against
`Control.Monad.Composable.StateDB`, which re-exports the trie library.

To confirm which trie a binary has: `strings ~/.local/bin/vm-runner | grep -c mp_db_`
(0 = Haskell, >0 = C).

## How the dispatch works

- `Blockchain.Database.MerklePatricia` (this package) shadows the
  `merkle-patricia-db` module of the same name. `openMPDB` opens the C store
  over the state LevelDB and sets a process-global active handle; each trie
  function checks it (`active`) and either calls C (`viaC`) or falls through
  to the Haskell implementation imported with `{-# LANGUAGE PackageImports #-}`.
- `Blockchain.Database.MerklePatricia.Diff` / `.Map` and `BatchMerge`
  shadow the Haskell/`fastMP` modules the same way (state-diff walker, key/value
  iteration, per-block storage batch merge).
- `tick` / `flush` / `withSandbox` are the lifecycle hooks the node calls
  through `tickNodeDB` / `flushNodeDB` / `evalSandboxedContextM`. In
  `merkle-patricia-db` they are no-ops / `id`; here they drive the C store's
  pending-node flush (every `flushEvery` = 256 ticks, i.e. blocks) and the
  sandbox overlay.
- A node the C store doesn't have returns `MP_ERR_MISSING` with the hash;
  `viaC` fetches it from the Haskell node store (which may ask peers), inserts
  it into C, and retries. Nothing outside this package sees trie nodes.
- `cbits/mp_trie.c`: open-addressed node cache in front of LevelDB
  (`leveldb_t*` shared with the Haskell `DB` handle), CLEAN / PENDING /
  SCRATCH entries, overlay depth for sandboxes, `mp_db_for_each`, `mp_db_diff`,
  `mp_db_get_proof`, `mp_db_set_fetcher`. The modules that read the global
  handle use `-fno-full-laziness -fno-cse` and `NOINLINE`; GHC otherwise
  floats the handle read out and the second store opened in a process sees
  the first one's pointer.

Tuning knobs, all in `src/Blockchain/Database/MerklePatricia.hs`:
`cacheNodes` (200000; 20000 performed the same) and `flushEvery` (256).

## Where the state DB is opened

`Control.Monad.Composable.StateDB.runStateDBAt path opts` opens it and
provides `StateDBEnv`; `Blockchain.VMContext.runContextM` /
`runTestContextM` call it at the process entry point, next to the stream
and Redis runners. `runMemStateDBM` is the in-memory variant for the CLI,
fuzzer and benchmarks (Haskell trie over a map; the C `openMemory` is not
wired to it).

## Measuring

Standard metric: highest block inserted 300 s after block #1 on an Upquark
sync from scratch. Lifecycle is strictly `strato-down` → move/remove
`mynode` → `strato-up mynode`. Block #1 time:
`grep -m1 'Inserted block became #1 ' mynode/logs/vm-runner`.

| trie | blocks at 300 s |
|---|---|
| Haskell | 158,274 |
| C | 209,334 – 217,829 |

Things that make a run look slow and are not the trie:

- **SSD without TRIM.** The state LevelDB rewrites ~10× what it ingests
  (~60 GB through the disk in 10 minutes). If the drive thinks it is full
  (old `mynode.backup.*` dirs deleted but not trimmed), its compactor slows
  down and LevelDB stops the writer: `grep -c waiting mynode/.ethereumH/state/LOG`
  (`Too many L0 files; waiting...`). A healthy run has 0–2 in the first
  5 minutes; an untrimmed drive gave 160–650 and 135k–192k blocks. Fix:
  `sudo fstrim -v /` after deleting old run directories, then let the disk
  idle a few minutes. Everything the node writes goes through one drive
  (postgres/indexer alongside), so compare disk state before comparing code.
- **Bootnode peer slots.** All five Upquark bootnodes answering
  `Disconnect(TooManyPeers)` in `mynode/logs/strato-p2p` means waiting;
  it has taken 1 to 14 minutes. Not a node-side problem. Quick restarts make
  it worse (stale slots on the remote).
- **Sequencer starvation.** A silent gap in `vm-runner` right after a batch
  ends with no `Committed block` lines in `strato-sequencer` for the same
  window is upstream, not the VM.

Log noise that is not a state-root mismatch: `runSM/error ... tuple arity
mismatch` (SolidVM type error in a transaction) and `lookupInMPDB ... does
not reference any known contract code` (code-DB lookup while building the
SQL feed).

## Not done

- Swap-back is compile-verified only; the Haskell path has not been
  sync-tested since the `runStateDBAt` wiring.
- The state-root-mismatch diagnostic (`hasStateRoot`, `insertNode`,
  `withMissingNodeFetcher`) still goes through the Haskell node store, not C.
- `test/Spec.hs` predates the renamed C API and is not built by `make`.
- No C-vs-Haskell equivalence test for `for_each` / `diff` / `get_proof`.
