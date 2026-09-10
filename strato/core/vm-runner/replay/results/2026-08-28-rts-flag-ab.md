# vm-runner RTS flag A/B: -N4 vs -N2 — overnight benchmark report (2026-08-27/28)

**Node restart note (top-line per ground rules):** the STRATO node that previously ran on this
machine had already been stopped and its `mynode/` removed by the operator before this benchmark.
After the matrix completed, a fresh upquark node was started with the stock computed flags; it is
syncing/synced as of report time.

## Methodology adaptation (deviation from the original task spec)

The original spec called for the offline replay harness (`run-benchmark.sh` + `vm-replay`).
**The restricted replay dataset does not exist on this machine** — no staged block file, snapshot,
expected-root file, or marked RUN_DIR anywhere on disk (the 2026-08-20 evidence in this directory
was produced on an M4 Max laptop). The harness hash-pins those artifacts and its checks may not be
worked around, so the matrix was executed as **full from-genesis node syncs of the upquark network**
instead, one sync per run:

- Per run: `strato-setup` → rewrite ONLY the `vm-runner` line of `mynode/commands.txt` to the
  variant flags → `./run.sh` (setup is skipped for an existing node dir, so the edit survives) →
  sync to head with watchers + 30s memory/progress sampling → archive logs → `strato-down`
  → `rm -rf mynode`. No Haskell source or harness files were modified; nothing was committed.
- All other processes (sequencer, p2p, slipstream, indexer, API) kept their stock computed flags —
  constant across runs.
- `+RTS -s` summaries are unavailable in this vehicle (convoke stops children with SIGTERM, which
  skips the RTS exit summary), so GC evidence is limited to the Prometheus RTS gauges
  (`strato_rts_live_bytes`, `heap_size`, `gcdetails_*`) captured by the sampler. Productivity and
  Gen0/Gen1 pause tables from the spec are therefore NOT included; the primary metric is
  end-to-end vm-runner sync wall time over an essentially identical chain.
- `MIN_BLK_S` does not apply (no harness); no run was discarded for being slow.

## Machine and build facts

| fact | value |
|---|---|
| host | 4 vCPU AMD EPYC 9R45, 32,230,512 kB MemTotal (EC2 workspace) |
| load before start | idle (load 0.01), no other workloads all night |
| SOURCE_COMMIT | `c6c5f45e613cf4c6b4eed508aa4df5e2354d6507` (branch `rts-optimization-more`, contains required `5ba5983815`) |
| vm-runner binary | built 2026-08-27 15:44 by operator `make`; sha256 `9ed5b2b64019e03b15f7…` (`~/.local/bin/vm-runner`) |
| network | upquark, from genesis each run; head ≈ 168.8K–169.8K blocks (grew ~1K over the night) |
| dates | runs 2026-08-27 20:03 UTC → 2026-08-28 06:00 UTC (cutoff) |

## Results — primary metric: vm-runner full-sync wall time

Sync time = node start → vm-runner reaches then-current head (~169K blocks). blk/s = head/t.

| variant | vm-runner flags | runs (s) | mean (s) | blk/s per run | spread |
|---|---|---|---|---|---|
| **n4-baseline** | `-T -N4 -A128m -n4m -qg1 -qn2 -I2` | 2,972 / 3,110 | **3,041** | 56.8 / 54.5 | 138s (4.5%) |
| **n4-plain** | `-T -N4 -A128m -I2` | 2,976 | 2,976 | 57.0 | n=1 |
| **n2-simplified** | `-T -N2 -A256m -n4m -qg1 -I2` | 3,201 / 3,114 | **3,158** | 52.8 / 54.5 | 87s (2.8%) |
| **n1-biga** | `-T -N1 -A256m -I2` | 3,243 | 3,243 | 52.2 | n=1 |
| **n2-halfpool** | `-T -N2 -A128m -n2m -qg1 -I2` | 4,326 / 3,377 | 3,852 | 39.1 / 50.3 | 949s (24.6%) |

Memory (sampler, 30s interval): peak vm-runner RSS was 4.30–4.83GB and peak live 2.66–3.22GB —
**no meaningful memory separation between variants** on this chain.

Correctness gate: block #150,000 hash `5b65abab…` identical in 7/8 runs (verified from archived
sequencer logs); `n1-biga-r1`'s log had rotated past that height so its gate is unverifiable from
archives, though it synced to the same heads. No run produced a divergent chain.

## Answers to the spec's questions

1. **Is `n2-simplified` within noise of `n4-baseline`?** Formally yes, but flagged. Mean delta
   +117s (+3.8%) is smaller than baseline's own max run-to-run spread (138s) → "within noise" by
   the spec's criterion — while also exceeding the 2% flag line. Direction was consistent
   (n2 slower in both rounds: +7.7% in r1, +0.1% in r2) but the magnitude is unstable at n=2.
2. **How much does pool size matter (`n2-simplified` 512MB vs `n2-halfpool` 256MB)?** The halved
   pool was slower in both rounds: +35% (r1) and +8% (r2) vs the simplified mean. Real cost,
   noisy magnitude — `n2-halfpool` also produced the night's only wild outlier (4,326s) and the
   widest same-variant spread (24.6%).
3. **How much does 2-thread major GC matter (`n2-*` vs `n1-biga`)?** No measurable benefit. At the
   same 256MB pool, single-capability `n1-biga` (3,243s) beat `n2-halfpool` (mean 3,852s), and it
   sat within ~3% of the 512MB `n2-simplified`. Nothing here justifies a second capability for GC
   alone.
4. **What do `-n4m -qg1 -qn2` buy over plain (`n4-baseline` vs `n4-plain`)?** Nothing measurable:
   2,976s (plain, n=1) vs 2,972/3,110 (baseline) — inside the baseline spread. They also cost
   nothing.

## Recommendation

**Keep `-N4 -A128m` on 4-core machines; do not adopt `-N2 -A256m` for speed reasons — and if the
sizing formula must be simplified, drop `-n4m -qg1 -qn2` rather than `-N4`.** The two `-N4`
variants were the fastest runs of the night and the tuning trimmings showed no measurable effect
in either direction, which inverts the original hypothesis: the capability count is the part that
matters (~4% mean cost going to `-N2`, consistently in one direction), the GC trimmings are the
part that doesn't. The `-N2 -A256m` simplification is *survivable* (≤4% mean, formally within a
4.5% noise floor) where capability pressure matters — e.g. small machines where the vm-runner
shares 2 cores — but it is not free, and halving the total pool (`-A128m` at `-N2`) is the one
configuration to clearly avoid. Caveats: n=2 (n=1 for two variants) with a ~4.5% same-variant
noise floor on a live network; the replay harness on a machine that has the restricted dataset
remains the right instrument for a tighter verdict.

## Stage sync times per run (operator-requested; upquark from genesis)

p2p times are a noisy proxy (task-table completion; a single straggler chiliad delays the flag —
the 2,796s value is the proxy misfiring, not download speed). slip `timeout` = slipstream still
>200 blocks behind 30 min after the VM finished; its own throughput varied run-to-run with
identical flags and lagged in 5/8 runs — worth a separate look.

| run | p2p (s) | sequencer (s) | vm-runner (s) | slipstream (s) |
|---|---|---|---|---|
| n4-baseline-r1 | 91 | 496 | 2,972 | 3,017 |
| n2-simplified-r1 | – | 317 | 3,201 | timeout |
| n2-halfpool-r1 | – | 722 | 4,326 | 5,768 |
| n1-biga-r1 | 317 | 362 | 3,243 | timeout |
| n4-plain-r1 | 2,796* | 587 | 2,976 | 3,021 |
| n4-baseline-r2 | – | 407 | 3,110 | timeout |
| n2-simplified-r2 | – | 678 | 3,114 | timeout |
| n2-halfpool-r2 | 180 | 541 | 3,377 | timeout |

Sequencer times (identical flags all runs) spread 317–722s — treat as system/network variance, not
signal. Two runs aborted the original driver's failure counter via slip-timeouts (a driver policy
bug, corrected mid-night with a continuation driver); `n1-biga-r2` and `n4-plain-r2`+r3 were not
run (06:00/06:30 cutoff). Round-robin ordering was preserved otherwise.

## Artifacts (auditable)

`rts-ab-artifacts-20260828/` (home directory of the benchmark host) — per run: `times.txt`,
`mem.csv` (30s RSS/live/progress for p2p/sequencer/vm/slipstream), `vm-runner.log.gz` +
`sequencer.log.gz` (post-rotation tail; early portions rotated before archiving — a known gap,
fix is archiving `logs/rotated/` too), `slipstream.tail`, `worldbest.txt`, `vmflags.txt`,
`convoke.log`, `setup.log`, plus `driver.log` (event timeline) and the driver scripts.
