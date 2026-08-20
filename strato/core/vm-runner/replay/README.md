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
vm-replay apply-preloaded <blocks.bin> [from] [to]
vm-replay audit <blocks.bin|-> [from] [to]
```

`apply` uses the bounded streaming implementation with a 1,024-block default.
`apply-preloaded` exists only to compare the historical harness; it retains the
decoded block list and must not be used for qualification or full-file runs.

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
