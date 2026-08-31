# Verified VM replay

`vm-replay` applies recorded `OutputBlock` values through the normal ordered VM
path. Every block still runs transaction execution, `verifyBlock`, and the
state-root comparison. Successful blocks persist pending Merkle Patricia nodes
and the block-hash-to-root mapping before the command reports success.

The replay dataset is restricted and is not stored in this repository. A run
must pin the block file, genesis, LevelDB snapshot manifest, executable, source
commit, runtime flags, and expected root by hash.

## Commands

```text
vm-replay apply <blocks.bin|-> [from] [to]
vm-replay apply-stream <blocks.bin|-> <chunk-size> [from] [to]
vm-replay apply-stream-full <blocks.bin|-> <chunk-size> [from] [to]
vm-replay apply-preloaded <blocks.bin> [from] [to]
vm-replay audit <blocks.bin|-> [from] [to]
vm-replay hash-leveldb <database-dir>
```

`apply` uses the bounded streaming implementation with a 1,024-block default.
`apply-preloaded` exists only to compare the historical harness; it retains the
decoded block list and must not be used for qualification or full-file runs.

`apply` and `apply-stream` are diagnostic modes: they persist pending trie nodes
every 256 blocks and discard output events. `apply-stream-full` uses the normal
one-block pending-node flush interval and synchronously publishes every normal
VM/index event to Kafka. Only `apply-stream-full` qualifies as a full-pipeline
measurement. `hash-leveldb` hashes the ordered logical key/value stream with
length framing, so its digest is independent of LevelDB SST layout and
compaction history.

Set `VM_PROFILE_PHASES` to `1` (default output
`vm-profile-phases.jsonl`) or to an explicit output path to enable the optional
exclusive phase profiler. Allocation deltas use GHC's current-thread allocation
counter (accurate to about 4 KiB); benchmark with one capability so replay work
does not escape that accounting boundary. Set `VM_PROFILE_OUTPUT_HASH=1` to add
length-framed SHA-256 payload hashes by Kafka topic to the final profile summary.
Per-block phase distributions and invocation counts are always recorded. Set
`VM_PROFILE_RUN_CODE_DETAIL=1` for short diagnostic runs that split call and
creation totals into the nested SolidVM phases, including statement storage,
builtin, and interpreter residuals plus cold compiler/import stages. Detailed
mode forces builtin results within their timing boundary so lazy pure work is
not charged to a later consumer. In the default qualification
mode, runCode wall, CPU, and allocation totals remain separated by call versus
creation without timing every hot inner scope. Detailed mode records exact wall
and allocation deltas for those children while their CPU remains measured at
the enclosing call/creation root. Add `VM_PROFILE_PHASE_SPANS=1` only when a
short deep-profile run also needs per-invocation distributions and CPU deltas
for every child; it implies runCode detail mode.
Set `VM_PROFILE_DB_DETAIL=1` only for diagnostic runs that also need Merkle,
LevelDB, cache, account, and storage-key counters. This is deliberately
independent of `VM_PROFILE_PHASES`: stringifying every account/storage key and
incrementing counters on every trie operation materially perturbs hot-path
timing on large ranges.
The profiler is hierarchical: time spent in a nested trie flush or Kafka enqueue
is subtracted from its enclosing phase.
`unattributed_residual` is reported separately and is never silently folded
into a named phase. Summarize one or more runs with:

```bash
python3 replay/analyze_vm_profile.py run-1.jsonl run-2.jsonl run-3.jsonl
```

The authoritative timing schema is `streamed-apply-v1`. It begins before
context initialization and ends after the selected blocks are processed and
pending MP nodes are finalized. Artifact checksum verification, snapshot
restore, and the fresh-process audit are outside this interval.

## Reproducing a run

1. Build the optimized executable with `stack build vm-runner:exe:vm-replay`.
2. Copy `manifests/helium-20k.env.example` outside the repository and fill in
   the restricted artifact paths and snapshot-manifest hash.
3. Create an isolated run directory, install its dedicated `ethconf.yaml`, and
   mark the directory as intentionally disposable replay state.
4. Ensure no `vm-runner` or other `vm-replay` is running and dedicate Redis DB
   3 to the replay.
5. Source the manifest and run `./run-benchmark.sh`.

```bash
mkdir -p /secure/path/run/.ethereumH
install -m 0644 /secure/path/replay-ethconf.yaml \
  /secure/path/run/.ethereumH/ethconf.yaml
touch /secure/path/run/.solidvm-replay-run
set -a
source /secure/path/helium-20k.env
set +a
strato/core/vm-runner/replay/run-benchmark.sh
```

The wrapper restores only the named replay namespaces under `RUN_DIR`, runs
`apply-stream`, then launches a second OS process for `audit`. It refuses to
append a result unless apply exits successfully, the selected range and count
match, the expected root and executable hashes match, the performance floor is
met, and the fresh-process audit prints `AUDIT ok`. Each invocation writes
label-specific stdout, stderr, metadata, and a TSV row.

For a full run, use a separate manifest with `FROM` and `TO` unset and the full
expected state root. Never point the wrapper at a live node directory or Redis
DB 0/2.

## Correctness boundary

The replay gate proves ordered application, per-block verification, final-root
equality, and fresh-process readability of the final block-hash, account, and
contract-storage tries. It does not prove parity of non-state outputs such as
transaction-result events, ASM, action messages, logs, traces, or indexing.
Those require normal-mode integration tests and canonical output digests.

## Current evidence and limitations

See [results/2026-08-20-solidvm-live-sync.md](results/2026-08-20-solidvm-live-sync.md)
for the frozen replay and live-sync measurements. See
[OPTIMIZATION_INVENTORY.md](OPTIMIZATION_INVENTORY.md) for the accepted cuts,
rejected experiments, and remaining PR gates.

The current optimizer deliberately trades memory for fewer LevelDB reads and
less repeated SolidVM compilation. The measured VM RSS increase is material.
Process-global caches and unbounded code/reverse-hash caches must be made
context-local and byte-bounded before this is presented as a production-ready
general VM change.
