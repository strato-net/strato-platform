# Upquark genesis replay proof

**Fully synced at 2026-11-16 02:27:10 UTC: VM, SQL and durable Cirrus all reached block 994,340.**
The node was healthy, had 10 active peers, and was following new mainnet blocks.

[Machine-readable proof](evidence/caught-failure-upquark-20261115.json) · [Complete recorded replay progress](evidence/caught-failure-upquark-20261115-progress.jsonl)

| Check | Observed result |
| --- | --- |
| Fresh start | VM and SQL at block 0 at 2026-11-15T23:12:03.762576+00:00 |
| Replay history | 385 samples, accepted VM height never decreased |
| Original failure | Blocks 355721–355723 passed with canonical hashes and roots |
| Historical comparisons | All 108 recorded checkpoints match both reference nodes |
| Fresh independent comparison | Audit and both reference nodes agree at block 994334 |
| Durable coverage | SQL and `cirrus_progress` both cover accepted VM block 994340 |
| Validation failures / canonical mismatches | None recorded |
| Audit role | Non-validator; restricted ports and least-privilege database roles verified |

The replay used a new node directory, no snapshot and no reused chain/database state.
The prior node was stopped with `strato-down` and preserved; the fresh run used `strato-up`.
State-root validation stayed enabled throughout.

## Exact implementation and common block

- Deployed execution commit: `a559256501b1071d8a4f5eab9c5e7227c8e2c454`.
- Locally built core image: `ghcr.io/strato-net/strato-platform/strato:19.10-a559256-f90543d3575c`.
- Running image ID and VM executable SHA256 were checked against the source build; full values are in the proof JSON.
- Block `994334` hash: `803b9610d87d01a4fdfe542107133912d744ed71c9ecd0c62d48dd0ffae70e36`.
- Block `994334` state root: `31c6f3c27b906e2c137cc1513428144b0a7bd1747dc9de8a725bd7c924994559`.
- Both independent references were captured at `2026-11-16T02:25:19.079123+00:00`; the audit comparison was captured at `2026-11-16T02:27:10.769978+00:00`.

PR commits after the execution commit only update documentation, evidence and build metadata.
The API status `version` field identifies the unchanged Apex auxiliary image; use the core image and VM hash above to identify the tested execution code.

## Reproduce the read-only checks

From a machine already configured for the read-only `bridge-audit` SSH gateway (for example, the Studio):

```sh
ssh -T bridge-audit <<'JSON'
{"operation":"status"}
JSON
```

Check `metadata.isSynced`, `consensus.lastBlock.number`, `cirrusIndexedBlock` and health.
The live chain keeps advancing, so numbers will exceed the recorded sample.

```sh
ssh -T bridge-audit <<'JSON'
{"operation":"sql","database":"eth","query":"SELECT number::text,hash,state_root,parent_hash FROM block_data_ref WHERE number IN (355721,355722,355723,994334) ORDER BY block_data_ref.number"}
JSON
```

Independent node operators can run the same SELECT through their read-only connection and compare the same heights with the proof JSON. These commands do not require administrative SSH or submit transactions.

The progress log starts at block 0 and ends with VM, SQL and durable Cirrus caught up; its SHA256 is `eae80a870fe0f703f0158d4769e31114bff328fd799b29c70266de657f56c559`. A head query alone does not demonstrate genesis replay. These files are recorded operational evidence, not remote execution attestation.

This verifies Upquark. Helium genesis replay remains pending, and both public-network activation heights remain unscheduled. The PR remains a draft and must not be merged yet.
