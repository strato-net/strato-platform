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

At this stage, a new genesis-to-tip full-pipeline run remained the final
acceptance gate. The completed acceptance replay is recorded below.

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

That acceptance run has now completed. The branch remains deliberately named
`donotmerge` because the optimization series still needs normal review before
any production merge.

## Final optimized acceptance checkpoint

The final clean code checkpoint is commit
`c8d81d5f3adad4e3280ee7371c3a9a2cb93e4c1a`. Its provenance-banked
`vm-replay` executable has SHA-256
`cba1b3eae3a69e6ccebdb7b183e849a9df3377d7aa63c2a1505c36dfea220e97`.
The build used Stack with GHC 9.8.4, the repository release/O2 settings, and
`--flag solid-vm:native-bn254`; the native cryptography dependency used the
Arkworks 0.5 Rust implementation.

The following table separates the historical quality receipts from the
accepted optimization-series measurements. The first two optimized short
ranges were measured at `01428f4f82`, the expanded range at `0a2def7359`, and
the tail and full replay at the final `c8d81d5f3a` checkpoint. All rows are
plain, `-N2`, `-A128m`, full-pipeline runs with exact terminal audit. The
full-corpus reference is the prior accepted genesis-to-tip candidate at
`0a2def7359`; the other references are the original pre-crash
`cfgfallback137` quality receipts.

| Range | Reference blk/s | Optimized blk/s | Change | Optimized tx/s | Process wall | Allocated bytes | Audit |
|---|---:|---:|---:|---:|---:|---:|---|
| 30,000-39,999 | 263.85 | 278.39 | +5.51% | 683.5277 | 36.13 s | 151,939,435,144 | exact |
| 40,000-44,999 | 269.05 | 280.07 | +4.10% | 283.2017 | 18.04 s | 80,515,591,624 | exact |
| 45,000-97,125 | 194.19 | 205.69 | +5.92% | 380.8731 | 253.93 s | 934,065,550,064 | exact |
| 315,969-361,199 | - | 133.69 | - | 149.7231 | 339.33 s | 968,058,756,696 | exact |
| 0-361,199 | 167.60 | 170.09 | +1.49% | 211.2727 | 2,125.08 s | 5,969,387,281,120 | exact |

The authoritative full replay processed 361,200 blocks, 448,649 transactions,
and 294 expected execution errors. It ended with the same block hash and state
root as the prior accepted full run and audited 80,716 accounts and 1,256,107
storage entries. Peak process RSS was 16,520,200,192 bytes. An earlier raw
full-run receipt with suffix `-158` also reached the exact final audit, but the
laptop slept during it; its timing is not accepted. The `-159` repeat ran
under `caffeinate` and is the authoritative performance result.

The exact receipts are stored under `artifacts/vm-target-400/results` in the
workspace root:

- `cfgfallback137-fees-rewards-contract-30000-39999-01428f4f82-20260901-110.result.txt`
- `cfgfallback137-fees-rewards-ordinary-40000-44999-01428f4f82-20260901-109.result.txt`
- `cfgfallback137-public-map-getter-msgsig-checkpoint-45000-97125-0a2def7359-20260901-135.result.txt`
- `cfgfallback137-canonical-block-reward-call-tail-315969-361199-c8d81d5f3a-20260901-157.result.txt`
- `cfgfallback137-canonical-block-reward-call-final-repeat-0-361199-c8d81d5f3a-20260901-159.result.txt`

### Reproduce the accepted full replay

The accepted executable remains banked locally at the path below. The replay
harness verifies the banked provenance, checkpoint manifest, corpus hash, and
benchmark configuration hash before it starts. Use a new result label because
the harness refuses to overwrite an existing receipt.

```bash
workspace=/Users/kierenjameslubin/software/clean-clone-ii
runner="$workspace/artifacts/vm-target-400"
bank=/private/tmp/vm-replay-vm-replay-cfgfallback137-canonical-block-reward-call-c8d81d5f3a-clean-20260901-bin
baseline="$runner/checkpoints/genesis-cfgfallback137-v2-helium-361199"
corpus="$runner/corpus/helium-vm-tasks-0-361199.bin"
bench_ethconf=/private/tmp/vm-recovery-bench-config.FuTRf6/ethconf-full-quality-db5-kafka4.yaml
label=cfgfallback137-canonical-block-reward-call-final-repro

"$runner/verify-vm-replay-provenance.sh" \
  "$bank/vm-replay" "$bank/provenance"
shasum -a 256 "$bank/vm-replay" "$corpus" "$bench_ethconf"

caffeinate -dimsu env \
  VM_REPLAY_BASELINE="$baseline" \
  VM_REPLAY_BASELINE_BLOCK=-1 \
  VM_REPLAY_CORPUS="$corpus" \
  VM_REPLAY_CORPUS_SHA256=6c3dc85770faeacc164b87843e28beaf65ad4bd46ed64e4942a53ac104a88609 \
  VM_REPLAY_BENCH_ETHCONF="$bench_ethconf" \
  VM_REPLAY_BENCH_ETHCONF_SHA256=5483aee90b68ff17534e9f6875371b29d95a889d4448dcbadb1eb0fe64180320 \
  VM_REPLAY_RTS_CAPS=2 \
  VM_REPLAY_RTS_ALLOC_AREA=128m \
  VM_REPLAY_CHUNK_SIZE=1024 \
  VM_REPLAY_ACTIVE_GROUP_ID=helium-fastir-opt \
  VM_REPLAY_RESET_KAFKA=1 \
  VM_REPLAY_RESET_REDIS=1 \
  VM_REPLAY_KEEP_STATE=0 \
  VM_REPLAY_FINAL_ACCEPTANCE=1 \
  "$runner/run-target.sh" "$label" "$bank/vm-replay" plain full 0 361199
```

The three hashes printed before the run must be, in order:

```text
cba1b3eae3a69e6ccebdb7b183e849a9df3377d7aa63c2a1505c36dfea220e97
6c3dc85770faeacc164b87843e28beaf65ad4bd46ed64e4942a53ac104a88609
5483aee90b68ff17534e9f6875371b29d95a889d4448dcbadb1eb0fe64180320
```

Acceptance requires both `RESULT ok` for blocks 0-361,199 and the following
`AUDIT ok`, including 80,716 accounts and 1,256,107 storage entries. A partial
rate, a diagnostic-pipeline result, or a run without the exact final audit is
not a replacement for this checkpoint.

If the banked executable is lost, rebuild the code checkpoint from a clean
worktree with the recorded recipe, then bank the resulting executable before
running it. A different worktree or toolchain can change executable bytes, so
the rebuilt binary must be treated as a new candidate and pass the same exact
full replay rather than being assumed equivalent.

```bash
workspace=/Users/kierenjameslubin/software/clean-clone-ii
repo="$workspace/strato-platform-vm-quality-checkpoint"
build_parent=$(mktemp -d /private/tmp/strato-vm-build.XXXXXX)
build_tree="$build_parent/strato-vm-c8d81d5f3a"
code_commit=c8d81d5f3adad4e3280ee7371c3a9a2cb93e4c1a
bank_label=vm-replay-c8d81d5f3a-rebuild

git -C "$repo" worktree add --detach "$build_tree" "$code_commit"
stack --stack-yaml "$build_tree/strato/stack.yaml" build \
  vm-runner:exe:vm-replay --flag solid-vm:native-bn254
install_root=$(stack --stack-yaml "$build_tree/strato/stack.yaml" \
  path --local-install-root)

VM_REPLAY_SOURCE_REPO="$build_tree" \
VM_REPLAY_SOURCE_PATHSPEC=strato \
VM_REPLAY_EXPECTED_SOURCE_HEAD="$code_commit" \
VM_REPLAY_EXPECTED_SOURCE_TREE=2d62953f54a6b75ffb34bf6409607f31e43f411d \
VM_REPLAY_BUILD_PROFILE=stack-release-O2-native-bn254-bls12381-fastir-canonical-block-reward-call-clean-v17 \
VM_REPLAY_BUILD_RECIPE="stack build vm-runner:exe:vm-replay --flag solid-vm:native-bn254" \
VM_REPLAY_BUILD_TOOLCHAIN="stack ghc-9.8.4 rust arkworks-0.5" \
  "$workspace/artifacts/vm-target-400/bank-vm-replay.sh" \
  "$bank_label" "$install_root/bin/vm-replay"
```

## Integrated VM, Kafka, Redis, and PostgreSQL checkpoint

The isolated VM acceptance run does not include the normal node's SQL and
Redis consumers. A fresh-node integrated run showed that the VM could sustain
about 124-126 processed blocks per second through 50,000 blocks while the
indexer accumulated more than 14,000 Kafka messages of lag. Redis batching
reduced logging and transaction overhead but did not remove that backlog.

The dominant growth-sensitive SQL path was direct storage indexing. For every
set of touched contracts, it selected and decoded every existing storage row
for those contracts before replacing only the touched keys. The `storage`
table had no index beginning with `address_state_ref_id`; one measured contract
already had 11,826 storage rows. On the copied benchmark database, the old
lookup scanned 83,005 rows and returned 11,826 in 4.095 ms. The exact
`(address_state_ref_id, key)` lookup used the new composite index and completed
in 0.167 ms.

The indexer now deletes only the exact touched composite keys, bulk-inserts
their replacement values, bounds large batches below PostgreSQL's parameter
limit, and creates its indexes idempotently. The VM emits its already
materialized write set only after a block becomes the direct canonical child;
nonlinear best-block replacement retains the original trie-diff fallback.
Block SQL and Redis writes are also batched by Kafka input batch.

| Fresh genesis run | Elapsed | VM processed | Processed blk/s | Final indexer lag | SQL state height | Audit |
|---|---:|---:|---:|---:|---:|---|
| Canonical direct state, prior Redis path | 405 s | 50,226 | 124.01 | 15,659 | 47,021 | exact |
| Batched Redis block writes | 400 s | 50,366 | 125.92 | 14,609 | 47,904 | exact |
| Exact indexed storage writes | 412 s | 51,828 | 125.80 | 2 | 51,693 | exact |

The final row reduced terminal indexer lag by 99.986% relative to the Redis
batch candidate while leaving VM throughput essentially unchanged. These are
live-testnet input runs, so the VM-rate columns include startup and differing
network arrival bursts; the meaningful SQL result is that the indexer reached
the cutoff with only two messages of lag. Its stopped-state audit matched SQL
exactly at block 51,693: 6,191 accounts, 49,847 storage entries, zero orphaned
storage rows, and zero duplicate storage keys.

The locally committed do-not-merge source checkpoint is
`6cf91abca1ac65ffd69021538692ef4dc91e3918`, tree
`9a951a6634eb8592f0e60681e9b03e65e20bcfb7`. The measured candidate already
contained the exact-key algorithm and composite index; the commit additionally
bounds unusually large batches and makes all index creation idempotent. Both
executables compiled after those mechanical hardening changes, but the longer
committed-binary run is recorded separately rather than being inferred from
the dirty-candidate measurement. The committed provenance-banked binaries are:

- `vm-runner`: `bf93173a2e7be92c4cfa31f47cf6af6badffa5d70bb00254f31c01112f0589b7`
- `strato-indexer`: `160a0141b35e23c8b214769724782d4051c6c7f9efb1b0d59668112b29e10ff2`

### Reproduce the integrated run

Use a new node and bootstrap directory for every run. The wrapper refuses to
reuse an existing node directory and records binary hashes, source provenance,
Kafka lag, component memory, SQL counts, and the exact launch command. Stop a
completed node only with `strato-down` before running the offline VM audit.

```bash
workspace=/Users/kierenjameslubin/software/clean-clone-ii
artifacts="$workspace/artifacts/helium-direct-state-updates-20260902"
bin="$artifacts/bin-integrated-sql-6cf91ab"
node="$artifacts/node-integrated-sql-6cf91ab-0-50000-01"
bootstrap="$artifacts/bootstrap-integrated-sql-6cf91ab-0-50000-01"

caffeinate -dimsu env \
  HELIUM_SYNC_VM_BINARY="$bin/vm-runner" \
  HELIUM_SYNC_INDEX_BINARY="$bin/strato-indexer" \
  HELIUM_SYNC_NODE_DIR="$node" \
  HELIUM_SYNC_BOOTSTRAP_DIR="$bootstrap" \
  HELIUM_SYNC_STOP_VM_PROCESSED=50000 \
  HELIUM_SYNC_SQL_DIFF=true \
  HELIUM_SYNC_MIN_LOG_LEVEL=LevelError \
  HELIUM_SYNC_AB_VARIANT=integrated-canonical-state-sql \
  HELIUM_SYNC_OPTIMIZED_CODE_SHA=9a951a6634eb8592f0e60681e9b03e65e20bcfb7 \
  HELIUM_SYNC_EXPECTED_VM_SHA=bf93173a2e7be92c4cfa31f47cf6af6badffa5d70bb00254f31c01112f0589b7 \
  HELIUM_SYNC_EXPECTED_INDEX_SHA=160a0141b35e23c8b214769724782d4051c6c7f9efb1b0d59668112b29e10ff2 \
  HELIUM_SYNC_VERSION=18.4-helium-integrated-sql-6cf91ab \
  "$workspace/artifacts/helium-full-sync-20260902/run-helium-full-sync-optimized.sh"

"$workspace/strato-platform-helium-rerun/bin/strato-down" "$node"
```

The exact 50,000-block receipts are under
`artifacts/helium-direct-state-updates-20260902/node-storage-exact-index-levelerror-0-50000-02/sync-timing`.
This checkpoint qualifies the integrated short gate; a fresh longer
genesis-to-tip sync remains the final live-node acceptance run.

## Full integrated live-node acceptance

That longer run completed on 2026-09-02 from a new node directory with the
committed VM and primary-indexer binaries above, Kafka, Redis, PostgreSQL, and
the batched Slipstream/Cirrus path enabled. The initial controller stopped at
250,163 processed blocks, but that metric included 1,901 replayed or
noncanonical blocks: canonical VM height was only 248,262. The result was not
mislabelled. The same untouched node continued to the fixed start-tip target
of 491,153 and then to terminal consumer lag zero.

| Observed milestone | Elapsed from launch | VM | ETH SQL | Cirrus | Primary lag | Slipstream lag | Average rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| VM first sampled beyond fixed target | 7,360 s | 492,038 | 492,038 | 419,701 | 0 | 150,967 | 66.85 blk/s to observed VM height |
| All integrated consumers caught up | 8,474 s | 492,340 | 492,340 | 492,341 | 0 | 0 | 58.10 blk/s to observed VM height |

The chain remained live while the backlog drained. A barometer capture after
completion reported best block, best sequenced block, and world best block all
at 492,348, with both sync flags true. The nearby stopped-state SQL capture at
block 492,358 contained 589,572 raw transactions, implying approximately
69.57 end-to-end tx/s over the 8,474-second synchronized run. Its block join
had 589,571 rows because the capture raced one live transaction; this is not
reported as exact transaction-table equality.

The primary indexer repeatedly accumulated bursts of tens of thousands of
Kafka records, but drained them and ended at committed offset 3,515,526 with
zero lag. Slipstream ended at committed offset 1,086,030 with zero lag. The VM
reached the fixed target 1,114 seconds before Cirrus drained, so the remaining
end-to-end cost is downstream of VM execution and primary ETH-state indexing.

### Full-range correctness and bottleneck receipts

The stopped node was copied into an isolated audit environment and dumped as
492,386 blocks, numbers 0-492,385, containing 589,602 transactions:

```text
corpus=artifacts/vm-target-400/corpus/helium-vm-tasks-0-492385.bin
bytes=1007953820
sha256=b46074d64e834e40aa058f011111fc90eadee91a679f7253e509a250904c7c94
```

An exact audit at the SQL snapshot height 492,358 matched the canonical header
state root and the SQL state counts: 122,935 accounts and 1,977,791 storage
entries. SQL also had zero orphan storage rows, zero duplicate composite
storage keys, address digest `a8194a9d5ea362e83a9ece39d496d085`, and
storage digest `6f2e2c50d269c0dacfe2f970826d7517`. The primary
indexer logged no errors. Slipstream logged only 41 handled missing-column
compatibility errors of the same class retained by its controlled baseline;
no other SQL or decode errors were found.

The full run confirms the next optimization boundary rather than hiding it.
Slipstream recorded 8,163.396 seconds of batch time, of which Cirrus SQL used
7,600.879 seconds, or 93.11%. At rest, `cirrus` occupied 19 GB versus 3,086 MB
for `eth`. The largest Cirrus relations were:

| Relation | Approximate rows | Total size |
|---|---:|---:|
| `history@mapping` | 8.05 million | 11 GB |
| `history@storage` | 3.40 million | 3.3 GB |
| `event` | 2.53 million | 2.7 GB |
| `mapping` | 710 thousand | 817 MB |
| `event_array` | 1.40 million | 760 MB |

This makes the row-history trigger and index volume the next isolated SQL
target. Removing history semantics or its keys is not an acceptable shortcut;
any further candidate needs fixed-input baseline/candidate table hashes and a
fresh full-node zero-lag confirmation.

Two obvious index-only candidates were tested and rejected on the isolated
6.8-GB Cirrus snapshot. Partial indexes containing only the active
`valid_to = 'infinity'` history rows were small (38 MB for mapping and 480 kB
for storage), but warm 2,000-update trigger medians were 389.665 ms versus
261.041 ms for mapping and 237.455 ms versus 233.077 ms for storage. Removing
the duplicate nonunique live `mapping(address,path)` index changed the median
from 261.041 to 255.415 ms, only 2.15% and within run noise. All trials ended in
rollback, both partial indexes were dropped, and the original live index was
restored. No schema candidate was retained from this probe.

### Slipstream source restoration

The measured full run used Slipstream binary SHA-256
`cf487171ce5581bdb2a48644c96e26fb325a1e086434c670ec2730c21db80502`.
Its six performance-critical source modules are byte-identical to the modules
now committed here. Commit `b718b928f18b79710181b00039ad24a65e508752`
restores the bounded batching implementation whose controlled 20,000-event
replay improved from a 267.240 to a 316.800 vmevents/s median (+18.55%), ended
at Kafka lag zero, and matched every baseline table hash. Commit
`cf461ce23889a2b63b44b8a76833f72ccb17f5f2` additionally restores the measured
dynamic-statement-cache cleanup and JSON-value escaping safeguards.

The exact committed source passes the focused suite with 8 examples and zero
failures. Its rebuilt executable is banked at
`artifacts/helium-direct-state-updates-20260902/bin-integrated-full-cf461ce/slipstream`,
SHA-256
`7aee6bcd61e0dd6ad5f6011197ed6a1ec718f101fc259f638e755e8924ba4735`.
This rebuilt binary is a post-run reproducibility artifact, not a relabeling of
the measured `cf487171...` executable.

### Reproduce the full integrated checkpoint

The wrapper now accepts explicit VM, primary-indexer, and Slipstream binaries
and stops by canonical VM height only after both Kafka consumer lags are zero.
Do not use `HELIUM_SYNC_STOP_VM_PROCESSED` for a height-qualified run.

```bash
workspace=/Users/kierenjameslubin/software/clean-clone-ii
repo="$workspace/strato-platform-vm-quality-checkpoint"
artifacts="$workspace/artifacts/helium-direct-state-updates-20260902"
node="$artifacts/node-integrated-full-cf461ce-0-491153-02"
bootstrap="$artifacts/bootstrap-integrated-full-cf461ce-0-491153-02"
vm_source_parent=$(mktemp -d /private/tmp/helium-full-source.XXXXXX)
vm_source="$vm_source_parent/strato-platform"
git -C "$repo" worktree add --detach "$vm_source" \
  cf461ce23889a2b63b44b8a76833f72ccb17f5f2

caffeinate -dimsu env \
  HELIUM_SYNC_VM_SOURCE_DIR="$vm_source" \
  HELIUM_SYNC_VM_GIT_SHA=cf461ce23889a2b63b44b8a76833f72ccb17f5f2 \
  HELIUM_SYNC_VM_BINARY="$artifacts/bin-integrated-sql-6cf91ab/vm-runner" \
  HELIUM_SYNC_INDEX_BINARY="$artifacts/bin-integrated-sql-6cf91ab/strato-indexer" \
  HELIUM_SYNC_SLIPSTREAM_BINARY="$artifacts/bin-integrated-full-cf461ce/slipstream" \
  HELIUM_SYNC_EXPECTED_VM_SHA=bf93173a2e7be92c4cfa31f47cf6af6badffa5d70bb00254f31c01112f0589b7 \
  HELIUM_SYNC_EXPECTED_INDEX_SHA=160a0141b35e23c8b214769724782d4051c6c7f9efb1b0d59668112b29e10ff2 \
  HELIUM_SYNC_EXPECTED_SLIPSTREAM_SHA=7aee6bcd61e0dd6ad5f6011197ed6a1ec718f101fc259f638e755e8924ba4735 \
  HELIUM_SYNC_NODE_DIR="$node" \
  HELIUM_SYNC_BOOTSTRAP_DIR="$bootstrap" \
  HELIUM_SYNC_STOP_VM_HEIGHT=491153 \
  HELIUM_SYNC_SQL_DIFF=true \
  HELIUM_SYNC_MIN_LOG_LEVEL=LevelError \
  HELIUM_SYNC_AB_VARIANT=integrated-full-cf461ce \
  HELIUM_SYNC_OPTIMIZED_CODE_SHA=9a951a6634eb8592f0e60681e9b03e65e20bcfb7 \
  HELIUM_SYNC_VERSION=18.4-helium-integrated-full-cf461ce \
  "$workspace/artifacts/helium-full-sync-20260902/run-helium-full-sync-optimized.sh"

"$workspace/strato-platform-helium-rerun/bin/strato-down" "$node"
git -C "$repo" worktree remove "$vm_source"
rmdir "$vm_source_parent"
```

The authoritative receipts are in
`artifacts/helium-direct-state-updates-20260902/node-integrated-sql-6cf91ab-0-250003-01/sync-timing`.
They include the continuation samples, final barometer and Kafka offsets, SQL
digests, PostgreSQL relation statistics, Slipstream phase metrics, error
summary, and the exact block-492,358 VM audit.

## Fixed-corpus SQL-on restoration

The quality-checkpoint branch was retested on 2026-09-02 against the fixed
Helium corpus after restoring SQL output. Two additional bottlenecks were
removed:

- Nonlinear best-block replacement now converts its authoritative trie diff
  to the same compact `StateUpdates` representation used by the canonical
  path. `sqlDiff=false` retains the legacy `StateDiff` output.
- Raw transactions are deduplicated and inserted in bounded SQL batches for
  the complete consumed block batch instead of one `insertBy` round trip per
  transaction.

The trustworthy VM gate starts from genesis. Partial-range replays are not
used for acceptance because their first selected block includes a synthetic
genesis-to-height diff.

| Gate | Blocks | Transactions | Elapsed | blk/s | tx/s | Result |
|---|---:|---:|---:|---:|---:|---|
| VM and Kafka, `sqlDiff=true` | 47,104 | 61,900 | 220.226 s | 213.89 | 281.0749 | exact root audit |
| PostgreSQL indexer before transaction batching | 47,104 | 61,900 | 251.557 s | 187.25 | 246.0675 | lag 0, integrity checks pass |
| PostgreSQL indexer after transaction batching | 47,104 | 61,900 | 93.229 s | 505.25 | 663.9565 | lag 0, integrity checks pass |

The indexer elapsed intervals run from process start through the timestamp of
the final consumed batch. `/usr/bin/time` is not used for this comparison
because the daemon intentionally remained alive until the external lag poll
observed zero. The optimized database contained blocks 0-47,103, 61,900
distinct raw transactions and block-transaction rows, 5,187 distinct address
states, 25,547 distinct storage keys, and no orphaned storage or block-
transaction rows.

The compact reorg representation also removed the pathological replay cost at
the first large fork. Chunk 46,080-47,103 improved from 1.02 blk/s (1,004.226
s) to 197.41 blk/s (5.187 s), while the full genesis gate remained above the
200 blk/s soft target.

The fixed-corpus VM receipt is
`artifacts/vm-target-400/results/sqldiff-quality-compact-reorg-genesis-0-47103-01.result.txt`.
The isolated indexer logs are
`/private/tmp/strato-indexer-compact-audit/indexer.stdout` and
`indexer-batched.stdout`; these are diagnostic machine-local artifacts, not
repository fixtures.

### Reproduce the fixed-corpus gate

Build both executables with the native BN254 backend, bank `vm-replay` with
the repository provenance wrapper, and run from the protected genesis
checkpoint with SQL output enabled:

```bash
workspace=/Users/kierenjameslubin/software/clean-clone-ii
repo="$workspace/strato-platform-vm-quality-checkpoint"
cd "$repo"

stack --stack-yaml strato/stack.yaml build \
  vm-runner:exe:vm-replay strato-index:exe:strato-indexer \
  --flag solid-vm:native-bn254

vm_replay="$(stack --stack-yaml strato/stack.yaml path --local-install-root)/bin/vm-replay"
"$workspace/artifacts/vm-target-400/bank-vm-replay.sh" \
  sql-on-candidate "$vm_replay"
banked_vm_replay="$workspace/artifacts/vm-target-400/binary-bank/vm-replay-sql-on-candidate-bin/vm-replay"

VM_REPLAY_BASELINE="$workspace/artifacts/vm-target-400/checkpoints/genesis-cfgfallback137-v2-helium-361199" \
VM_REPLAY_BASELINE_BLOCK=-1 \
VM_REPLAY_CORPUS="$workspace/artifacts/vm-target-400/corpus/helium-vm-tasks-0-361199.bin" \
VM_REPLAY_CORPUS_SHA256=6c3dc85770faeacc164b87843e28beaf65ad4bd46ed64e4942a53ac104a88609 \
VM_REPLAY_SQL_DIFF=true \
VM_REPLAY_RTS_CAPS=1 \
VM_REPLAY_CHUNK_SIZE=1024 \
  "$workspace/artifacts/vm-target-400/run-target.sh" \
  sql-on-genesis-0-47103 "$banked_vm_replay" plain full 0 47103
```

For the SQL consumer comparison, retain that run's `indexevents` topic, reset
only the isolated `eth` database and `strato-indexer` consumer offset, seed the
isolated Redis database from block 0, and run the corresponding
`strato-indexer` from a directory containing the benchmark `.ethereumH`.
