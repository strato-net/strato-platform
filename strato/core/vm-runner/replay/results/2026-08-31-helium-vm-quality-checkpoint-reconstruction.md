# Helium VM quality-checkpoint reconstruction

This document reconstructs the targeted Helium replay work after the host
interruption on 2026-08-31. It distinguishes the recovered source checkpoint
from performance that can still be reproduced.

## Recovered checkpoint

The last correctness-safe candidate was `cfgfallback137`:

| Field | Recovered value |
|---|---|
| Base commit | `4930d102748921e633116d612b617acd57acfd03` |
| Dirty source tree | `1b86bc5f698d2a4256ebeb212d5970dac0569d82` |
| Source patch SHA-256 | `d6da7dd99c40b6918306dd1b8a1696f06e8049d483bcd6cd89b8f115f71e6b81` |
| Original measured binary | `f21e36b38483e9afc2e95219ba3ec9d36c64cfb53eff60600e0b896820b32f00` |
| Rebuilt binary | `1cf986ccad86550d62df9747637101b2f5a68b613cd1f821ea4377cce9117c9e` |
| Historical-sequence rebuild | `c72cc6ed2b56d388b2136077903fa6203e1ad6a492ddc835d601b4c385de1109` |

The archived patch reconstructed to the exact recorded dirty tree before this
report and `BUILD_METADATA` were added. Comparing this branch commit with tree
`1b86bc5f698d2a4256ebeb212d5970dac0569d82` shows that the only differences
are this report and `BUILD_METADATA`: the VM code is the exact quality-run
code.

The high-throughput build did happen. The transcript records the complete
repository-default `--force-dirty` build, including rebuilding the local
dependency graph, compiling all 17 SolidVM modules, relinking `vm-replay`, and
completing 49 Stack actions. It produced binary
`f21e36b38483e9afc2e95219ba3ec9d36c64cfb53eff60600e0b896820b32f00`.
That executable did not survive the host interruption, but its code, build
command, provenance, and quality-run receipts did.

## Run-log inventory

`artifacts/vm-target-400/vm-run-throughput-timeline.csv` was regenerated from
the persistent result receipts. It contains 741 replay rows, including 235
strictly comparable targeted rows: plain, full pipeline, blocks
40,000-44,999, `-N2`, `-A128m`, default LevelDB cache, and successful final
audit. Diagnostic, profiled, short-gate, and differently configured rows are
not compared as if they were qualification runs.

The measured progression was cumulative:

| Stage | Representative targeted evidence | Result |
|---|---|---:|
| Initial qualified window | `reward-gate-01` / `fastast-off-01` | 62.82 / 68.97 blk/s |
| Durable Merkle batching | `durable-merkle-batch-candidate-5k` repeats | 150.03-154.25 blk/s |
| Expanded native IR path | `admin-stage23-full` | 188.71 blk/s |
| Stable IR and hashing | `opaqueir69-v3-pair3-candidate-n2` | 204.24 blk/s |
| Compiler prewarm | `precompile70` paired candidates | 198.12 / 201.50 blk/s |
| Existing-call prewarm | `callprewarm71` paired candidates | 197.61 / 201.07 blk/s |
| Transaction-argument fast path | `20260831-txargfast121-01-txargfast.experiment.txt` | +3.96% paired mean |
| Pending-node lookup | `20260831T031416Z-pendinglazy131default.experiment.txt` | 244.40 blk/s mean, +3.73% |
| Exact Merkle lookup | `20260831T042432Z-exactlookup132default.experiment.txt` | 251.44 vs 250.94 blk/s mean |
| Mapping-address fix | `mapaddressfix135-ordinary-40000-44999-01` | 277.26 blk/s |
| Final CFG-safe fallback | `cfgfallback137-ordinary-40000-44999-01` | 269.05 blk/s |
| Expanded range | `cfgfallback137-checkpoint-45000-97125-01` | 194.19 blk/s |

The final source retained the safety fixes even though the immediate
40,000-44,999 number was lower than `mapaddressfix135`. Candidate 135 failed
later control-flow-sensitive contract cases. Candidates 136 and 137 added
conservative and CFG-sensitive fallback handling so the larger range could
complete with the expected execution-error set and exact audit.

The retained optimization groups are:

1. Batched VM output publication and durable Merkle writes.
2. Expanded FastUIntIR coverage, including native hex and byte operations.
3. Contract compiler and existing-call prewarming.
4. Root-keyed storage reads and removal of duplicate key/hash work.
5. Direct address decoding and fixed-width address output.
6. Batched pending FastIR writes and faster transaction argument preparation.
7. Pending Merkle-node lookup before persistent cache lookup.
8. Mapping-address correctness and CFG-sensitive fallback guards.

Individual percentages from the evolving sequence must not be added together.
Every retained checkpoint still requires broad semantic review before any
production PR.

## Restored quality-run evidence

The original `cfgfallback137` receipts used corpus SHA-256
`8cbed7658bb66bd5fb5208388c5769b1cfc030d8809d8d17eb4516c4792624c1`
and `ethconf.yaml` SHA-256
`7f70d9b800318d0872a7bae70c133a1a6d80bf3854f8f99e97a83a43be378e3f`.

| Range | Blocks | Transactions | Inner rate | Process wall | Peak RSS | Audit |
|---|---:|---:|---:|---:|---:|---|
| 30,000-39,999 | 10,000 | 24,553 | 263.85 blk/s | 38.12 s | 3.30 GB | exact |
| 40,000-44,999 | 5,000 | 5,056 | 269.05 blk/s | 18.78 s | 2.59 GB | exact |
| 45,000-97,125 | 52,126 | 96,522 | 194.19 blk/s | 269.03 s | 7.88 GB | exact |

The final range completed with 59 expected execution errors and matched the
final block hash, state root, 7,212 accounts, and 62,691 storage entries.

## Post-crash reproduction

The replacement corpus has SHA-256
`6c3dc85770faeacc164b87843e28beaf65ad4bd46ed64e4942a53ac104a88609`.
Its rebuilt block-39,999 checkpoint and `ethconf.yaml` are physically different
from the lost inputs even where terminal logical audits match.

| Range | Original | Rebuilt | Correctness result |
|---|---:|---:|---|
| 40,000-44,999 | 269.05 blk/s | 139.73 blk/s | exact terminal hash/root/counts |
| 45,000-97,125 | 194.19 blk/s | 55.91 blk/s | exact terminal hash/root/counts |

These post-crash runs used a different executable, corpus encoding,
`ethconf.yaml`, and physical checkpoint. They are not reproductions of the
quality run and do not invalidate its receipts. This branch restores the exact
quality-run code and evidence; it does not claim to have recreated the lost
`f21e36b...` executable byte-for-byte.

An additional reconstruction attempted a fast SolidVM library build followed
by the repository-default, forced-dirty `vm-replay` build. The resulting
binary was banked as
`vm-replay-cfgfallback137-restored-historical-sequence-20260831-bin`; it still
did not reproduce the lost binary or input identity. Its controlled
full-pipeline replay on the replacement corpus and checkpoint, blocks
40,000-44,999, completed at 135.09 blk/s with 37.24 seconds process wall time,
3,806,347,264 bytes peak RSS, and 115,082,418,936 allocated bytes.
The terminal block hash, state root, 5,980 accounts, 47,759 storage entries,
5,056 transactions, and two expected execution errors all matched the rebuilt
checkpoint evidence exactly.

## Restored source checks

The reconstructed source compiled through all 49 actions required for the
repository-default `vm-replay` build. Focused suites produced:

- Merkle Patricia: 10 examples, 0 failures.
- STRATO storage: 19 examples, 0 failures.
- STRATO model: the new address serialization checks passed; the wider suite
  retained one unrelated legacy JSON fixture failure in `CodePtr` EVM object
  parsing (43 examples, 1 failure).
- The wider SolidVM suite remains blocked by pre-existing test-build problems:
  name-shadowing warnings promoted to errors and missing test dependencies.

These outcomes are recorded as partial semantic evidence, not as a claim that
the complete repository test suite is green.

## Qualification boundary

The 40,000-44,999 range is an iteration benchmark only. Final validation
requires a genesis-to-tip `apply-stream-full` replay of the available
361,200-block Helium corpus, with:

- final block hash, state root, audit counts, events, and logical LevelDB hash;
- sustained and segment-level block and transaction throughput;
- process wall time, CPU, RTS allocation, and peak process RSS;
- low-overhead phase timing with output hashes enabled;
- exact source, executable, corpus, genesis, `ethconf.yaml`, RTS, and checkpoint
  provenance banked before the run.

Until that completes, this branch is deliberately named `donotmerge`.
