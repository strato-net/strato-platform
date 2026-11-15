# vm-runner speedup investigation — 2026-10-02 afternoon

Goal given: 2x sync speed, real speedups only (no caches/snapshots/parallelism tricks). Nothing committed.
Harness: `/tmp/vmqa/run300_m.sh <label>` — full node on helium in ~/vmqa-node, result = `vm_blocks_processed`
(vm-runner Prometheus metric on :8009) 300 s after the first block. Same method for every row below.
Repo: ~/strato-speedup-develop at HEAD c29e0130c2 (+ uncommitted VM1+VM2 in the tree, see bottom).

## Results (blocks processed @300 s, helium from genesis)

| run | what | blocks@300s | vs base |
|---|---|---|---|
| P1_BASE_M | HEAD, unmodified | 104,294 | — |
| P2_NOLOG | HEAD + `--minLogLevel=LevelWarn` (flag only) | 111,924 | +7.3% |
| P3_TIMERS | HEAD + phase timers (science build) | 101,638 | −2.5% (timer overhead) |
| P4_TXTIMERS | P3 + per-tx timers | 99,401 | |
| P5_FIX_LOG_REDIS | P4 + VM1 + VM2 (fixes, timers still in) | 119,168 | +14.3% (+17% vs P3) |
| P6_READTIMERS | P5 + node/addr/storage read timers (20M timeit calls) | 109,351 | timers cost 9% |
| P7_NO_OUTPUT | P6 + emitOut = no-op (ablation) | 101,152 | see below |
| P8_FIXES_CLEAN | HEAD + VM1 + VM2 only, no timers | 123,780 | +18.7% |

Baseline log-based harness (run300_b1.sh) gave 103,597 for the same binary, so the two methods agree.

## Where vm-runner's time goes (P6 dump at block 105,000, wall 291.5 s; per-phase wall time)

```
batch:total (inside runConsume callback)   283.9 s   -> idle waiting for input: 7.6 s (2.6%)
  Block # (addBlock+bookkeeping)           269.5 s
    runTxs                                 115.3 s  40%   = SolidVM
      tx:runCode (the user tx)              90.0 s  31%   0.538 ms/tx, 167k txs
      tx:payFees (decide() call per tx)     17.1 s   6%   0.102 ms/tx
      tx:printMsg (log box per tx)          28.7 s  10%   [P4 number; removed by VM1]
    flushMemStorageDB (storage tries)       77.5 s  27%   0.738 ms/block, grows with chain
    flushMemAddressStateDB (account trie)   18.0 s   6%
      nodeInsert (inside the flushes)       25.2 s        9.2M inserts = 88 nodes/block
      nodeLookup                            11.2 s        11.5M lookups = 110/block, ~1 us each (cache hits)
    emitNewAction + emitRanBlock + outputTransactionResult + stateDiffs  ~29 s  10%  (output to indexer/cirrus)
    redisUpdateVmBest                       16.8 s   6%   [P3 number; 0.168 ms round trip per block; removed by VM2]
    payBlockRewards (2 VM calls per block)   7.8 s   3%   (hypothesis "this is big" rejected)
    recoverProposer (ecrecover per block)    4.1 s   1.4%
    replaceBestIfBetter 3.8, tickNodeDB 2.8, flushNodeDB 2.3, verifyBlock 0.2, setParentStateRoot 0.8
GC: 17-19 s cpu of ~335 s cpu (5%); vm-runner uses ~1.1 cores — serial mutator, CPU bound.
```

perf (flat, 60 s, HEAD): no hot symbol >4%. By package: RTS eval/apply 14%, GC 11%, solid-vm 10.5%, base 10%,
kernel 8.5%, libc 6%, bytestring/rlp/bignum/unordered-containers/keccak/merkle-patricia 2-3% each.
I.e. death by a thousand cuts: laziness/thunks, allocation, String ops. Per-tx cost is uniform (mean 0.68 ms,
only 32 of 182k txs > 50 ms) — no heavy-tail transaction type to target.

Logging volume at HEAD: 413 MB / 2.04M lines per 300 s; 1.27M lines are the per-tx `printTx/ok` box.
`multilineLog` calls `lines` on the formatted box, so the formatting cost is paid even when INFO is filtered
(that is why P2's flag-only test gained less than the printMsg timer shows).

## Fixes (uncommitted, applied in the tree now; patches in /tmp/vmqa/series/)

- VM1_tx_log_debug.patch — `printTransactionMessage`: the per-tx box becomes one `$logDebugS` (lazy Text, nothing
  formatted at INFO). ~10% of vm-runner wall time. Loses the per-tx INFO lines in logs/vm-runner.
- VM2_redis_vmbest_per_batch.patch — `updateVmBestBlockNumber` (Redis `<vm_best>`, read only by strato-ps) once per
  input batch (~400 blocks) instead of once per block. ~6%.
- Together, clean build (P8): 123,780 vs 104,294 = +18.7%, stateRootMismatch=0.

Also known but not a patch: `--sqlDiff=false` ≈ +4% (stateDiffs 4% of wall).

## Ablation P7 (no output to indexer/slipstream at all) — science only

In-batch block time fell from 2.566 ms (P6) to 2.114 ms: the whole output channel (store-encode of
Action/tx results/RanBlock + jlog writes + their GC) is worth ≤18% of vm-runner time; the emit timers alone
show 10%. But: vm-runner then sat IDLE 26% of the wall time (302 s wall vs 223.7 s in batches), even though the
sequencer was 400k blocks ahead in vm_tasks. Idle is 2.6% in every other run. Not explained; the only
difference is that vmevents/indexevents are not written. Candidate: jlog reader behaviour on vm_tasks when the
other topics are quiet, or indexer/slipstream idling changing something. Worth understanding before trusting
any "vm-runner alone" speedup: at ~1.7 ms/block the input side starts to matter.

## Honest assessment vs the 2x goal

Cheap, real, measured: ~20% (VM1 + VM2 + sqlDiff=false). The remaining 80% is split roughly 40% SolidVM
interpreter, 33% Merkle-Patricia trie writes, 10% output serialization, 5% GC, rest small. No single fix gets
2x; the trie and interpreter each need engineering work:
- Trie: 88 node inserts + 110 lookups per block for ~1.6 txs; keys are `[Nibble]` lists, `splitKeysByPrefix` /
  `elem` on lists, keccak per key (keyToSafeKey) and per node, RLP encode per node, hashDBPut per new key.
  Hash+RLP work alone is ~0.15 ms/block; measured 0.9 ms/block => most of it is Haskell overhead. Plausible 2x
  on this layer with ByteString-backed nibbles and strictness => ~15% of total.
- SolidVM: AST walker; `expToVar'` has 72 clauses pattern-matching operator *Strings*; variable resolution
  checks local map, storage map, then `elem` over ~80 builtin names; args parsed from Text per call
  (`Fast.parseArg`); one extra full VM call per tx for fees (decide(), 0.1 ms) and two per block for rewards.
  The 0.1 ms fee call is the floor for "a VM call"; a user tx is 0.54 ms. Compiling the AST to closures /
  pre-resolving names would be the real win; multi-week.

## Deep partition P9–P12 (phase timers inside SolidVM and the trie write path; science only)

Tool: `Blockchain.DB.PhaseTimer` (new, in merkle-patricia-db): `phase key act` accumulates wall time + count per
key in a global IORef, dumped with the TIMINGS line every 5000 blocks. Two variants: `phase` (pure monad, uses
unsafePerformIO timestamps — fine for leaf phases, but GHC floats it to a CAF when the action is constant, so
`svm:decrementGas`/`svm:stmt` in P11 were garbage) and `phaseIO` (MonadIO, reliable). Overhead of the probes
themselves is large at high counts (P11 ran at 57k blocks instead of 108k), so compare fractions, not wall.

P10 (block 105,000, wall 296 s, 107,876 @300 s):
- svm:call:total 112.5 s (n=541k) = runCode 93.3 + payFees 20.3 → consistent.
- insideRunSM 99.9 s; difference 12.6 s = calls that threw (payBlockRewards fails every block, 8.7 s, plus ~5k
  failed user txs). Per-call setup outside runSM (env, gas, parseArgs 0.6 s, getCodeAndCollection 7.2 s for
  2.29M nested lookups, initializeAction 1.3 s) is ~3% → **"per-call overhead" hypothesis rejected; the time
  is in interpreting the function bodies.** 2.06M nested `call'` bodies for 430k top-level calls (4.8 per tx).
- Trie (per address flush, n=305k ≈ 2.9 addresses/block): putMany 54.9 s, deletes 10.1 s, hashDBPut 9.1 s,
  addr lookup/insert 0.8 s, encode 0.3 s; sum 75 s ≈ flushMemStorageDB 77.2 s.
  nodeInsert 24.9 s (9.2M) + nodeLookup 11.1 s (11.5M) are inside putMany/deletes.

P11 (block 45,000, probe-inflated):
- Counts: 9.47M statements / 45k blocks = 210 statements per block, ~158 per top-level call;
  30.1M getVariableOfName = 3.2 name resolutions per statement; 3.05M storage reads (9.0 s → 3 µs each, ≈7% of
  wall at normal speed) vs 0.99M storage writes (0.8 s).
P12 (block 65,000, phaseIO probes, 67,937 @300 s): leaf costs inside the interpreter per 65k blocks:
  storage reads 16.6 s (6.1M, 2.7 µs each — per-block mem map miss falls through to an MP trie read:
  unparsePath + keccak + node walk; ≈10% of block time at P8 speed), getVariableOfName 12.1 s (48.8M, mostly
  probe overhead — it is already cheap Map lookups), decrementGas 2.3 s (15.2M), storage writes 0.2 s (1.9M).
  So the interpreter's identified leaves (storage reads ~10%, name resolution ~3%) explain only a third of its
  ~40%; the rest is spread through expression/statement evaluation itself (perf also saw it as flat).
- Trie deletes are common: 110k `MP.deleteKey` for 125k flushes (zeroed slots), 32 µs each, ≈3% of wall; each
  delete is a one-key path walk + rebuild, done after the batch insert.
- `nodeData2NodeRef` RLP-encodes every node twice (once to test <32 bytes, again in putNodeData to hash);
  2.29M nodes/45k blocks; second encode 3.1 s, hash 2.5 s. Double encode ≈ 2–3% of wall; trivial real fix
  (encode once, hash the bytes, pass bytes to the cache which currently encodes a 3rd time at flush).

## MP (trie) experiment series — replay harness, nothing committed (patches in /tmp/vmqa/series/MP_*.patch)

Harness: `mp_driver.sh LABEL:patch[:ENV=val]` builds each patch from a clean tree with `make`, copies
`vm-replay` to `bin_<label>/`, reverts, then `mp_run.sh` (wait pkg ≤ 50 °C, `replay_run.sh` 300 s, cores 0-15).
Metric: **time to reach a fixed block** from the replay log (`ttb.sh`), because blocks ≥120k are ~2.3× heavier
than earlier ones, so "blocks in 300 s" compresses any speedup. mismatch=0 means every verified header root matched.

| run | what | to 60k | to 120k | to 127k | vs base (127k) |
|---|---|---|---|---|---|
| MP0_BASE | HEAD 66cc8f0a8a | 98.8 s | 246.8 s | 288.7 s | — |
| MP1_E1 | encode each node once (`putNodeDataBytes`) | 96.7 | 241.7 | 282.6 | −2.1 % |
| MP4_E4 | E1 + node cache takes the bytes (no 3rd encode) | 94.3 | 235.4 | 275.4 | −4.6 % |
| MP2_E2a | *ceiling*: skip hashDBPut entirely | 95.7 | 237.9 | 278.9 | −3.4 % |
| MP7_E7 | hashDB puts as one LevelDB batch per 512 | 98.0 | 247.1 | 287.8 | 0 |
| MP5_E5 | node cache 20k → 200k entries | 97.8 | 246.9 | 287.4 | 0 |
| MP3_E3 | deletes folded into the batch insert (v1) | — | — | — | **root mismatch @23,558** (fixed, see below) |
| MP6_E6_16 | commit tries every 16 blocks | 70.5 | 172.5 | 208.8 | **−27.7 %** (1.38×) |
| MP6_E6_1024 | commit tries once per 1024-block input batch | 64.7 | 153.0 | 188.9 | **−34.6 %** (1.53×) |
| MP6_E6_64 | commit every 64 blocks | 66.7 | 160.4 | 197.3 | −31.7 % |
| MP6_E6_1024b | E6_1024 with list-of-sets parking (no per-block union) | 64.3 | 154.1 | 190.2 | −34.1 % (union was not a cost) |
| MP3_E3b | deletes folded into the batch insert (fixed) | 97.3 | 243.4 | 283.5 | −1.8 % |
| MP8_E8 | keep flushed block-map entries across input batches | 97.5 | 248.0 | 289.3 | 0 |
| MP9_ALL_1024 | E6_1024 + E4 + E3 | 63.4 | 150.9 | 186.9 | **−35.3 %** (1.54×) |
| MP9_ALL_16 | E6_16 + E4 + E3 | 69.5 | 169.7 | 207.0 | −28.3 % |
| MP9_ALL8_1024 | ALL_1024 + E8 | 64.2 | 153.4 | 189.8 | −34.3 % |
| MP9_E9_NEVER | *true ceiling*: never commit tries at all (state-root checks off, RSS 16 GB) | — | 143 | — | 300 s metric: 141,447 (+10.7 %) |

Reading:
- Micro-optimisations of the per-node write path (E1/E4/E7/E5) are worth ≤5 % together; the hashDB reverse index
  costs ≤3.4 % even if removed outright, so batching it (E7) buys nothing — the cost is the keccak/nibble work, not LevelDB.
- "Lower the commit rate" (E6) is the big lever: it removes the per-block path rebuild for every touched contract
  (≈2.9 addresses/block, ~30 node inserts each). 16 blocks already gets most of it; 1024 adds another 7 points.
  Light blocks gain more (−29 % to 60k) than heavy ones (−13 % in 120k→127k) because trie commit is a fixed cost per block.
- E6 is a *ceiling measurement*: intermediate header roots are never materialised, so (a) jsonrpc historical state
  for non-commit blocks would need to come from elsewhere (cirrus), (b) the Bagger's `withBagger` was gated off
  (it starts from the best header root), (c) srCheck is only real on commit blocks (all passed, mismatch=0).
  State diffs are unaffected (computed between the batch's first/last roots, both committed).
- Heavy region (blocks ≥127k, ~12 s per 1k blocks): E6 variants gain only ~13–15 % there; the rest is SolidVM.
- Once commits are rare, the per-node micro-optimisations stop mattering (ALL_1024 vs E6_1024: −1.5 pts).
- Machine state after the series: tree clean at 66cc8f0a8a, `~/.local/bin` rebuilt from clean HEAD,
  authoring worktree `/tmp/vmqa/wt_author` (detached at HEAD) used for writing patches without touching the build tree.
- E3 v1 produced a non-canonical empty FullNodeData when a sub-trie lost all its keys in one batch; fixed
  (`EmptyNodeData` when all children empty and no value) and verified with a differential test against the
  one-by-one path (`/tmp/vmqa/DiffTest.hs`: 1500 random scenarios × 60 rounds, 0 mismatches).

## SolidVM interpreter investigation — 2026-10-03 night (replay harness, nothing committed)

Metric (the only one used for the headline numbers): highest block inserted 300 s after block #1, by log timestamps.
Time-to-block numbers below are *derived* from the same logs and labelled as such.

### Where SolidVM time goes (probes SVM_P1 fn-level, SVM_P2 statement/builtin-level; probes inflate wall ~40 %)
- Light region (blocks 100k–110k, 39 s wall with probes): SVM calls 13.4 s (34 %), trie flush 15.1 s (38 %).
  SVM time is almost entirely two functions: `PriceOracle.setAssetPrices` (0.9 ms/call unprobed, ~0.87 calls/block)
  and `AdminRegistry.castVoteOnIssue` (0.5 ms/call). 1.6 M storage reads at 1.8 µs each = 2.8 s.
- Heavy region (120k–125k, 35.4 s wall with probes): `PlonkVerifier.verify` 201 calls × 77 ms = 15.6 s, of which
  **`builtin:ecPairing` 12.2 s (61 ms/call)** and `builtin:ecMul` 2.4 s (3960 × 0.6 ms). So the heavy tail is not the
  interpreter — it is pure-Haskell BN254 pairing (`pairing`/`galois-field` libraries, Integer arithmetic).
- Micro-benchmark (`solid-vm-cli test`, /tmp/vmqa/svmbench/Micro.test.sol, per 10k iterations): empty loop 1.1 µs,
  local add 1.5 µs, internal call 2.4 µs, flat storage read 2.5 µs, depth-2 read 3 µs, depth-4 read 4.6 µs,
  storage write 2 µs, depth-4 write 5.3 µs. Pure-Haskell crypto (/tmp/vmqa/PairBench.hs): Miller loop 16 ms/pair,
  G2 subgroup check 4.5 ms (affine double-and-add with inversions), ecMul 0.59 ms, ecPairing(4 pairs) 83 ms.

### Experiments
| run | what | blocks @300 s | mismatch | derived: 120k→127k |
|---|---|---|---|---|
| SVM_BASE | HEAD 66cc8f0a8a (re-run tonight) | 127,842 | 0 | 41.5 s |
| SVM_X1 | H-B: stop re-evaluating the parent expression of `a[i]` / `a[i] = v` (`expToPath` removed) | 127,589 | 0 | — |
| SVM_X2 | ecPairing / ecMul via mcl (C) through FFI, identical validation order & messages | **142,335 (+11.3 %)** | 0 | **17.2 s (2.4×)** |
| SVM_X2_MPALL | X2 + MP_ALL (E6 commit every 1024 + E4 + E3) | **204,813 (1.60×)** | 0 | 12.5 s |
| SVM_X2_P2 | X2 + statement/builtin probes (420 s) | 131,020 (probed) | 0 | PlonkVerifier.verify 77 → 6.5 ms/call |

- X1 (patch `SVM_X1_no_reeval.patch`): the interpreter evaluated the parent of every index access twice
  (`expToVar parent` then `expToPath x`, which evaluates the parent again), i.e. 2^depth work for nested
  `m[a].arr[i].f`. Micro-bench confirms: depth-4 read 4.6 → 3.0 µs, depth-4 write 5.3 → 2.9 µs; depth ≤2 unchanged.
  Helium's hot contracts use storage pointers (`OracleState storage s = ...`) so depth is ≤2 and the replay shows
  no change. Also fixes a latent double-side-effect bug (`a[f()]` ran `f` twice) and changes gas (one fewer
  `expToVar` per nested access) — gas is in the receipts root after the helium fork at block 250,000, so this
  would need a fork gate; not a speedup lever for this chain.
- X2 (patch `SVM_X2_mcl_pairing.patch`, cbits/bn254_mcl.c + Blockchain/SolidVM/BN254.hs): C numbers on this
  box — mcl ecPairing(4 pairs) 0.97 ms (vs 83 ms Haskell), G1 mul 0.055 ms (vs 0.59), G2 subgroup check 0.18 ms.
  Differential test `/tmp/vmqa/PairDiff.hs` (old pure-Haskell code copied from HEAD vs new): 304 ecMul cases
  (scalars 0, r, r−1, r+5, >r, negative; invalid points) and 171 ecPairing cases (identity / non-identity products,
  infinity pairs, off-curve, out-of-range, off-twist, non-subgroup, odd lengths, incl. the "infinity G1 skips G2
  validation" quirk): 0 mismatches, exception messages identical. Replay: 0 root mismatches, light region
  unchanged (to 120k: 245.5 s vs 246.7 s), heavy region 2.4× faster. Derived per-5k-block segment times:
  BASE 115–120k 11.2 s, 120–125k 27.6 s; X2 115–120k 11.5 s, 120–125k 12.7 s, 125–130k 13.3 s, 130–135k 13.1 s,
  135–140k 10.0 s — the "cliff" at 120k was the pairing cost; with it gone, heavy blocks cost the same as light ones.
  Repo-native alternative: `strato/libs/groth16-rapidsnark` already vendors ffiasm/rapidsnark with a BN254
  pairing (generic C++, no asm): pairingCheck(4 pairs) 7.1 ms, G1 mul 0.26 ms (/tmp/vmqa/ffbench.cpp) — 12× on
  pairing, not 80×, but no new dependency and no LGPL question beyond what is already vendored.
  mcl prototype links a library built under /tmp/vmqa/mcl (absolute paths in package.yaml) — build integration
  (vendor mcl or use the ffiasm code, docker images) is the remaining work, plus the consensus review of the
  validation mirror above.

- X2 + MP_ALL stack multiplicatively (one removes per-block trie commits in light blocks, the other the pairing
  cost in heavy blocks): derived to-60k 64 s, to-120k 152 s, to-135k 183 s; 10k-block segments after 120k cost
  12–20 s instead of 68–77 s. RSS is ~15.5–16 GB for every replay run including BASE (not an MP_ALL effect).
- After X2 the heavy window (120k–125k, probed) is 19.7 s instead of 35.4 s; the largest remaining function is
  `RollupCore.commitBatch` at 17 ms/call (interpretive while-loops + 22k `poseidon2Compress` at 22 µs), i.e. the
  interpreter proper is now what is left in heavy blocks too.

### Why the interpreter itself is slow (not fixed; levers for later)
- Per statement ≈1 µs of fixed overhead (gas decrement per statement *and* per expression node through the SM
  state, `solidVMBreakpoint`, trace guards), ~1.5–2.5 µs per storage access (per-call-frame `Map` lookups keyed by
  `(Address, StoragePath)` with list/ByteString `Ord`, then the block-map `HashMap`, path pieces rebuilt via
  `show`/`BC.pack` on every access). perf self-time: GC ~12 %, list/ByteString compares ~15 %, thunk/apply ~12 %.
- Member access on a storage path does a storage read for every intermediate path (`s.observations[i].price`
  reads `s`, `s.observations`, `s.observations[i]` to discover they are "not basic values") — 1.8 µs each.
- A real interpreter speedup (pre-resolved variable slots, operator dispatch without `String` matching,
  cheaper storage keys) is a structural change; the interpretive share of light blocks is ~34 %, so even 2× there
  is ≈17 % on light blocks.

## State of the machine (2026-10-03 ~05:00)
- Tree clean at 66cc8f0a8a; `~/.local/bin` rebuilt from clean HEAD (`make`, log /tmp/vmqa/build_FINAL_clean.log);
  BUILD_METADATA reverted. Nothing committed. Authoring worktree /tmp/vmqa/wt_author (detached at HEAD, clean).
- Prototype artefacts: /tmp/vmqa/mcl (herumi/mcl built with MCL_USE_GMP=0, lib/libmcl.a), patches
  /tmp/vmqa/series/SVM_X1_no_reeval.patch, SVM_X2_mcl_pairing.patch (package.yaml points at /tmp/vmqa/mcl),
  SVM_P1_fnprofile.patch, SVM_P2_stmtprofile.patch; benches /tmp/vmqa/PairBench.hs, PairDiff.hs, mclbench.c,
  ffbench.cpp, svmbench/Micro.test.sol + runmicro.sh; per-run binaries bin_SVM_*/; logs replay_SVM_*.log*.
- mp_driver.sh now also waits for a running `make`/`stack` before touching the build tree (two drivers overlapped
  once tonight and corrupted both builds; both were rerun).

## State of the machine (earlier)
- User's upquark node: stopped and mynode removed (as instructed).
- ~/.local/bin binaries: rebuilt from HEAD + VM1 + VM2 (P8 build) after P12. Tree: HEAD + VM1 + VM2 uncommitted
  (plus BUILD_METADATA from make). All probes saved as /tmp/vmqa/series/VM_PROBES_P12_full.patch (12 files,
  includes VM1+VM2; `git apply` on HEAD to reproduce P12).
- Science patches: /tmp/vmqa/series/VM_ALL_experiments_P7.patch (timers + fixes + no-output ablation),
  SD1_statediff_batch.patch, CIR*/DB* from earlier.
- Logs: /tmp/vmqa/run300_P*.log, nodelogs_P*/ (TIMINGS lines every 5000 blocks), prof_P0_BASE/ (perf data),
  run300_m.csv.

## Native fee path experiment — 2026-10-03 afternoon (FEE_native_decide.patch)
- decide() chain on helium ≤250k: Decider(0xDEC1DE) → DeciderState(0xDEC1DE02, impl = itself until block 254,967)
  → payFees: try Voucher proxy 0x100e burn 1e18 (Proxy → logic 0x110e "Voucher") catch USDST proxy 0x937e… transfer
  1e16 to 0x100d (Proxy → logic 0x110f "Token"). All genesis code (collection 21137d33…). Cirrus ≤250k: 154,199 voucher
  burns, 27,295 USDST fee transfers. Fee-contract changes: blocks 254,967 / 260,715 / 567,102 (outside corpus).
- Blockchain.FeeFastPath.nativePayFees: code-hash-gated native storage writes + Transfer event; Nothing → interpreter.
  erAction (Cirrus action data) not reproduced. Env SVM_NATIVE_FEES=1.
- Same binary A/B, 300 s: FEE_OFF 127,626; FEE_ON 129,401 (+1.4 %), mismatch 0 (a mismatch halts vm-replay), hit=200,000 miss=0.
  Derived to 125k: 275.1 → 261.6 s (−4.9 %); light segments −4…−8.5 %, heavy ZK window 120–125k −0.9 %.
- Reading: the interpreter's cost for this 5-call chain (0.1 ms/tx, 6 % of P4 wall) is almost entirely overhead; native ≈ 0.
- Full upquark live sync (fullsync.sh, strato-up --network=upquark, same binary, log timestamps block #1 → #519,931):
  UQ_FEE_OFF 1360.6 s; UQ_FEE_ON 1150.7 s (−15.4 %), both stateRootMismatch=0, ON hit=700,000 miss=0.
  Upquark fee chain identical to helium's (DeciderState still points at itself; same genesis proxies/logic).
  Per 50k segment: 0–250k −2…−11 %, 250k–500k −18…−32 % (tx-heavy range), 500k–519k +25 % (near tip; p2p delivery, not VM).
  vm-runner log is rotated by strato-logrotate → stitch rotated/*.gz + live before parsing.
