# Helium VM quality-checkpoint reconstruction

This document reconstructs the targeted Helium replay work after the host
interruption on 2026-08-31. It records both the recovered source checkpoint
and the subsequently reproduced quality-run performance.

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
report and `BUILD_METADATA` were added. Commit `abf4b9d7e6` records that exact
quality checkpoint: compared with tree
`1b86bc5f698d2a4256ebeb212d5970dac0569d82`, its only differences are this
report and `BUILD_METADATA`. The follow-up commit on this branch adds the two
corrections found by the first genesis-to-tip attempt, while preserving
`abf4b9d7e6` as the immutable reconstruction point.

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

### Controlled clean-service reproduction

The exact recorded candidate-136-to-candidate-137 source and build sequence was
then replayed in its original worktree path. It deterministically produced
binary SHA-256
`1cf986ccad86550d62df9747637101b2f5a68b613cd1f821ea4377cce9117c9e`,
with source tree
`1b86bc5f698d2a4256ebeb212d5970dac0569d82` and patch SHA-256
`d6da7dd99c40b6918306dd1b8a1696f06e8049d483bcd6cd89b8f115f71e6b81`.
The lost `f21e36b...` executable therefore remains non-byte-reproducible, but
the exact source and build history are reproducible.

A compact, audited block-29,999 checkpoint was built from genesis. Running the
reconstructed binary against previously reused Redis/Kafka services produced
only 146.23 blk/s over blocks 30,000-39,999 and allocated 195,101,108,920
bytes. Repeating the same range and binary with an empty Redis database and a
new Kafka broker restored the historical allocation fingerprint and
throughput. Each subsequent range also used an empty Redis database and a new
Kafka broker, with service resets disabled so no existing benchmark state was
deleted.

| Range | Blocks | Transactions | Reproduced rate | Process wall | Peak RSS | Allocated bytes | Audit |
|---|---:|---:|---:|---:|---:|---:|---|
| 30,000-39,999 | 10,000 | 24,553 | 273.15 blk/s | 36.80 s | 3,600,154,624 | 153,310,193,144 | exact |
| 40,000-44,999 | 5,000 | 5,056 | 282.25 blk/s | 17.89 s | 2,689,646,592 | 80,284,846,352 | exact |
| 45,000-97,125 | 52,126 | 96,522 | 203.12 blk/s | 257.12 s | 10,136,256,512 | 928,637,338,680 | exact |

The corresponding result receipts are:

- `cfgfallback137-recovery-fresh-services-contract-30000-39999-20260831-05.result.txt`
- `cfgfallback137-recovery-fresh-services-ordinary-40000-44999-20260831-06.result.txt`
- `cfgfallback137-recovery-fresh-services-checkpoint-45000-97125-20260831-07.result.txt`

All three rates exceed the original 263.85, 269.05, and 194.19 blk/s
checkpoints. Their terminal block hashes, state roots, account counts, storage
entry counts, transaction counts, and expected execution-error counts match
the historical receipts. The allocation differences from the historical runs
are only 94,640 bytes, 3,920 bytes, and 279,328 bytes respectively. This
isolates reused benchmark-service state, rather than a lost source
optimization, as the cause of the misleading slow reconstruction result.

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

## First full-replay attempt and follow-up correction

The first replacement-corpus `apply-stream-full` attempt started from genesis
with the restored quality source and the canonical genesis root installed by
the replay harness. It processed 100,000 input blocks in 745.689 seconds
(134.10 blk/s, 160,294 transactions, 13,544,964,096 bytes peak RSS), but it is
not an accepted performance result: exact verification stopped at block
97,126. The header expected state root
`3c566a31fd4a90df71b0fd69da19947efbab1003ade6916f7461f4e77a83b2c6`,
while the candidate derived
`a439931feb8beae7db2ef8a6b7eb49ba6b5638897675dfbe1512f7ed24538dd0`.

The mismatch reproduced with FastIR disabled. The pre-optimization binary
processed the same block from the same audited block-97,125 checkpoint and
matched the expected root. A lookup trace then identified the regression: the
new canonical `onlyOwner` shortcut tried to call `castVoteOnIssue` on
`0x101a31a25295a5dd95187ea2b0725c91443db7b7`, whose account is externally
owned, bypassing the consensus evaluator's try/catch behavior. The correction
keeps the shortcut for SolidVM contract owners and falls back to the canonical
evaluator for externally owned or missing owner accounts.

The replay harness also now installs and selects the canonical genesis root
before processing block zero, matching normal VM startup. The resulting
repository-default forced-dirty binary is banked as
`vm-replay-cfgfallback137-genesis-owner-guard-20260831-bin`, SHA-256
`bdcd8cd54873e88e5d07e06a7e5968284edcdd23a1832bbcaf414be4b2e7be4d`,
with source worktree tree
`b9044d85d82e325fc74b42b3e419992c121e49a7`.

Exact diagnostic gates for that banked binary passed:

- Genesis blocks 0-1 matched the canonical block-1 state root.
- Block 97,126 matched the expected state root from a fresh audited
  block-97,125 checkpoint.
- Blocks 97,127-100,000 then matched every header root, completing at
  157.04 blk/s over 2,874 blocks. This is a diagnostic continuation, not a
  full-pipeline qualification rate.

A new genesis-to-tip full-pipeline run remains the final acceptance gate.

## Slow-segment optimization checkpoint

Profiling blocks 128,445-128,494 after the DA-commitment work attributed
40.5% of profiled body time to cryptographic builtins. Eight calls each to
`PlonkVerifier.verifyProof` and `PlonkVerifier.verify` dominated the Solidity
function profile. Moving additional PLONK helper builtins into FastUIntIR was
correct but improved the identical 50-block slice only from 26.01 to 26.48
blk/s, so the remaining bottleneck was the legacy Haskell BN254 implementation.

The optional `native-bn254` build flag links an Arkworks 0.5 Rust static
library for EIP-196 addition/multiplication and EIP-197 pairing. Invalid native
inputs fall back to the original Haskell functions so their exception behavior
remains the oracle. The Rust suite passes its G1 identity checks, malformed
input checks, and a two-pair Ethereum vector. The repository-wide SolidVM test
target remains blocked by the pre-existing test-build failures listed above.

The provenance-banked dirty candidate has binary SHA-256
`f86bfefebc15da75e4dfcc3d29fcc25e7203a153446a1f805f5113ca57a0dbaf`
and source tree `00492561a04c76e3aa3502b8ec577f42d4047a50`. Its static BN254
symbols were independently confirmed in the executable before replay.

| Identical diagnostic range | Prior candidate | Native BN254 | Allocation change | Correctness |
|---|---:|---:|---:|---|
| 128,445-128,494 | 26.01 blk/s | 33.43 blk/s | 11.05 GB to 8.74 GB | exact root/hash/audit |
| 125,000-129,999 | 60.04 blk/s | 149.17 blk/s | 231.44 GB to 133.66 GB | exact root/hash/audit |

The 5,000-block run also reduced peak RSS from 2,100,822,016 to
1,834,844,160 bytes. Its receipt is
`cfgfallback137-native-bn254-linkfix-125000-129999-20260901-59.result.txt`;
the prior identical-input receipt is
`cfgfallback137-dacommit-candidate-125000-129999-20260901-48.result.txt`.
This is a 2.48x iteration-segment speedup, not a genesis-to-tip qualification.

The clean committed native build is banked as
`vm-replay-cfgfallback137-native-bn254-c521b1cfa0-20260901-bin`, binary
SHA-256 `c1b51bccb5f84d4fb7b5370fe5dce8d6f0df55b20a6e4045fcbb31e6fc92f6ce`.
It repeated the 50-block slice at 45.87 blk/s and the 5,000-block segment at
142.47 blk/s, allocating 133,662,353,992 bytes with 1,802,354,688 bytes peak
RSS on the longer run. Both matched the same final state root, block hash, and
audit as the prior candidate. The clean sustained result is therefore a 2.37x
speedup over 60.04 blk/s. The receipts are
`cfgfallback137-native-bn254-clean-128445-128494-20260901-60.result.txt` and
`cfgfallback137-native-bn254-clean-125000-129999-20260901-61.result.txt`.

### Storage-backed event correction

The next full-pipeline boundary exposed a receipt-only FastIR mismatch at
block 250,003: state and block execution matched, but `OfferCancelled` omitted
its initialized storage-backed `maker` address. Canonical event evaluation has
two distinct behaviors for a direct storage variable. An initialized slot is
materialized as its typed value; a default slot remains an `SReference`, which
receipt encoding intentionally drops. The previous FastIR correction always
selected the latter behavior.

FastIR now loads direct storage event arguments at emit time, preserving their
stored type and consulting writes buffered earlier in the same IR execution.
The same banked candidate passed both opposing full-pipeline gates:

- block 112,830 retained the default-slot reference behavior and matched its
  final state root, block hash, and audit;
- block 250,003 materialized the initialized maker address and matched the
  header receipt root, final state root, block hash, and audit.

The correction did not regress the optimized segment. The identical 50-block
slice completed at 46.07 blk/s, and blocks 125,000-129,999 completed at 145.31
blk/s with exact terminal root/hash/audit and 133,746,763,896 allocated bytes.
Their receipts are
`cfgfallback137-event-storage-native-128445-128494-20260901-68.result.txt` and
`cfgfallback137-event-storage-native-125000-129999-20260901-69.result.txt`.
The exact correctness receipts are
`cfgfallback137-event-storage-native-112830-20260901-67.result.txt` and
`cfgfallback137-event-storage-native-250003-20260901-66.result.txt`.

The clean pushed binary then completed the first 255,000 blocks of a new
genesis replay in 1,277.115 seconds: 199.67 blk/s, 330,527 transactions,
3,862,633,337,216 allocated bytes, and 12,649,168,896 bytes peak RSS. Exact
verification stopped at block 254,918 on a receipt-only mismatch; the partial
rate is therefore performance evidence, not a completed qualification.

Receipt tracing at that block isolated a second form of the same storage-event
rule. `StratoStaking.setUsdstToken` buffered a zero write to `trackedUsdst`.
FastIR emitted that pending value as `TAInt 0`, while the storage layer
normalizes typed zeroes to `BDefault`, so canonical execution emitted an
`SReference` that receipt encoding dropped. Pending event values now pass
through the same `MS.isDefault` normalization as persisted storage; opaque
pending values use the same path as scalars.

The corrected candidate passes all three opposing full-pipeline gates at
blocks 112,830, 250,003, and 254,918 with exact receipt root, state root, block
hash, and audit. The corresponding receipts are
`cfgfallback137-event-default-normalized-112830-20260901-75.result.txt`,
`cfgfallback137-event-default-normalized-250003-20260901-76.result.txt`, and
`cfgfallback137-event-default-normalized-254918-20260901-74.result.txt`.
It also repeated blocks 125,000-129,999 at 151.69 blk/s with exact terminal
root/hash/audit and 133,749,262,528 allocated bytes; that receipt is
`cfgfallback137-event-default-normalized-125000-129999-20260901-77.result.txt`.

An audited block-254,917 checkpoint was retained after an exact 4,915-block
full-pipeline continuation at 225.28 blk/s. It permits continued semantic
discovery toward corpus tip without weakening the required final
genesis-to-tip rerun.

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
