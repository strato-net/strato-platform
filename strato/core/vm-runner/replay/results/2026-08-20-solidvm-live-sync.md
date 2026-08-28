# SolidVM replay and live-sync evidence — 2026-08-20

This document records the evidence used to prepare this branch. The
production-derived datasets, snapshots, binaries, and raw logs remain in the
restricted run directories; they are not committed to Git.

## Fixed Helium replay window

The immutable window is blocks 30,000 through 49,999: 20,000 blocks and 34,638
transactions. The historical uncontended baseline was 1,148.214504 seconds,
or 17.4183 blocks/s.

The frozen Linux candidate executable had SHA256
`447417483c78226d743c0e555e76971941cea5cc0a1cc01b807653978f680a36`.
Two consecutive isolated runs produced:

| Label | Seconds | Blocks/s | State root | Reopen audit |
| --- | ---: | ---: | --- | --- |
| `mid-scopesafe1` | 223.259521 | 89.5818 | exact baseline match | `AUDIT ok` |
| `mid-scopesafe2` | 222.829576 | 89.7547 | exact baseline match | `AUDIT ok` |

Both clear the 5x floor of 87.0915 blocks/s. A macOS rebuild independently
reproduced the same final root at 64.2095 and 64.2895 blocks/s. Its deeper
fresh-process audit walked 6,023 accounts and 48,866 contract-storage entries.

These rows prove the fixed-window performance and final-state durability of
the frozen artifact. They do not by themselves prove parity of non-state VM or
index events.

## Upquark live ingestion comparison

On the same M4 Max laptop and the same blocks 30,000 through 49,999:

| Build | Source | Seconds | Blocks/s |
| --- | --- | ---: | ---: |
| Stock | `272b6...` | 696.838213 | 28.701067 |
| Optimized | `d2b982c...` | 236.561338 | 84.544669 |

The observed ratio was 2.945698x. Both runs saw the same boundary block hashes:
block 29,999 `ca0ff...` and block 49,999 `221c...`. Neither log contained a
state-root mismatch, verification failure, fatal error, or OOM.

The optimized VM used materially more memory: roughly 2.25–2.57 GiB RSS versus
about 0.45 GiB for stock on this sample. This is a real integration tradeoff,
not benchmark noise.

## Backup-node canary

The optimized source synced the personal 8 GiB backup instance from genesis to
the then-current Upquark head, block 145,451, without a state-root mismatch,
verification failure, fatal error, or OOM. The VM was observed around 3.2 GiB
RSS with swap in use. This is useful canary evidence, but it is not a substitute
for bounded-cache work or a controlled full benchmark.

## Full-run status

There is **no completed qualifying streamed result for all 213,493 Helium
blocks yet**. The historical full harness decoded and retained the entire
557 MiB block file as a large Haskell object graph, growing live memory to
about 14 GiB; that run was terminated. `vm-replay apply` and `apply-stream`
now process bounded chunks, while `apply-preloaded` is retained only as a
diagnostic comparison. The new exact executable must be requalified twice on
20,000 blocks before its streamed full result can be treated as final evidence.

## Restricted input identifiers

- `blocks-all.bin` SHA256:
  `42df7fd06267d9453914775dd45999d9e8fa8a1c10f8d1fa70d2b2c6cafdf11c`
- `genesis.json` SHA256:
  `81c9859bd1a31c64ef529564d0ed5234d4d309002a5195715c3993f6e84f51fa`

Use `run-benchmark.sh` and a completed external manifest to generate the next
immutable, label-specific evidence set.

## Package validation

- `stack build vm-runner:exe:vm-replay`: passed on macOS/aarch64 with GHC 9.8.4.
- Built executable SHA256:
  `c86ea535b2e43c2dd8be860fe44b25a35601ad1b025c0adb890e6d53633c7dfd`.
- Every runtime/configuration file transplanted from the canary commit is
  blob-identical to `d2b982c`; the rebase changed only current build metadata
  and added the packaging material in this directory.
- `bash -n replay/run-benchmark.sh`: passed.
- `stack test solid-vm:solid-vm-spec --no-run-tests`: blocked by existing test
  target errors outside this patch: two `-Wname-shadowing` failures and missing
  `BlockApps.X509.Certificate`, `BlockApps.X509.Keys`, and
  `Blockchain.Strato.Model.Account` test dependencies.
