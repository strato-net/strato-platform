# YieldVault testnet upgrade scripts

These scripts execute the deterministic seed and post-upgrade E2E sequences:

- `scripts/fund-yield-vault-test-actors.js`
- `scripts/seed-yield-vault-old.js`
- `scripts/run-yield-vault-upgrade-e2e.js`

## Layout

- `plans/`: the authoritative sequence specifications these scripts implement.
- `scripts/`: every executable phase plus the shared runtime, evidence, and
  governance modules they import.
- `tests/`: the offline suites and the disposable-environment live test.
- `fixtures/`: the `*.example.json` templates.

Run every phase through the `yield-vault:*` npm commands rather than invoking a
path directly, so `DEPLOY_ENV_FILE` and the working directory stay correct.

Funding, seed, and E2E journal before submission. All scripts poll asynchronous
STRATO receipts or the exact matching governance execution for at most 60 seconds
and stop on the first failed receipt or state assertion. Passwords and OAuth
tokens are never written to run-state or result artifacts.

## Configuration

Copy `.env.example` to `.env`, fill the testnet credentials and addresses, and
keep the populated file untracked.

The YieldVault npm commands set
`DEPLOY_ENV_FILE=deploy/yield-vault-testing/.env`, so every phase uses the same
OAuth, node, expected network, actor, and artifact configuration.

Use only the `yield-vault:*` commands documented here for fixture deployment,
upgrade, and rollback. The shared `deployProxy` and `upgrade` commands are not
part of this workflow and do not produce the required guarded evidence.

The deployer, owner, and every actor that submits a seed, upgrade, or E2E transaction has
independent `<ACTOR>_USERNAME`, `<ACTOR>_PASSWORD`, and `<ACTOR>_ADDRESS`
variables.
Addresses are cross-checked against the funding/seed manifests and each
transaction's state effects.

Actor funding authenticates `MINTER` and `APPROVER` independently. Each token
may be directly owned by `MINTER`, or owned by `ADMIN_REGISTRY` with nonzero
live membership for both governed signers. There is no transfer fallback.

`OWNER_ADDRESS` is always the authenticated operator EOA.
`DEPLOYER_ADDRESS` is a distinct authenticated EOA used only for
`createContract`; on Helium it must resolve to the Cirrus-indexed deployment
authority (`Admin #1`) so the created contracts are indexed in Cirrus. `OWNER`
remains the signer for `Proxy.setLogicContract` and every YieldVault
`onlyOwner` call.
`VAULT_OWNER_ADDRESS` is the owner stored in both Proxy and YieldVault. Governed
Helium runs set it to `ADMIN_REGISTRY`; direct-owner disposable runs may set it
to `OWNER_ADDRESS`. The exhaustive transaction registry is
`plans/ONLY_OWNER_GOVERNANCE_REGISTRY.md`.

On Helium the live admins are exactly three accounts; two votes satisfy the
effective 2-of-3 threshold. These docs refer to them by role rather than by
account name: `Admin #1` is the Cirrus-indexed deployment authority used for
`DEPLOYER` and `MINTER`, `Admin #2` is `OWNER`, and `Admin #3` is `APPROVER`.
Supply the real usernames only in the untracked `.env`. DEPLOYER/OWNER/MINTER
and APPROVER credentials must resolve to their configured addresses, live
membership is checked, and APPROVER must differ from each operation's primary
signer.

`YIELD_VAULT_FUNDING_MANIFEST` must point to the completed artifact produced by
the separate actor-funding script. It records the network, asset, actor
addresses, run count, full aggregated mint plan, exact balance and supply
deltas, receipts, events, and per-submission fee-policy evidence.

Artifact schemas are fixed by the current consumers:

- actors file: `schemaVersion: 2`, with an `expectedNetworkID` and `actors` map;
- funding manifest: `schemaVersion: 2`;
- old-proxy evidence: `schemaVersion: 2`, type
  `yield-vault-old-proxy-deployment`;
- seed manifest: `schemaVersion: 1`, type `yield-vault-old-seed`;
- guarded upgrade/rollback evidence: `schemaVersion: 1`, type
  `proxy-upgrade-evidence`;
- manual runbook input: `schemaVersion: 1`, type
  `yield-vault-manual-upgrade-evidence`;
- generated runbook report: `schemaVersion: 1`, type
  `yield-vault-safe-upgrade`;
- E2E success report: `schemaVersion: 1`, type `yield-vault-upgrade-e2e`.

## Fund test actors

Run funding before any seed, runbook, or E2E sequence:

```bash
npm run yield-vault:actors -- \
  --output ./yield-vault-actors.json

npm run yield-vault:fund-actors -- \
  --asset <ASSET_ADDRESS> \
  --fee-token <FEE_TOKEN_ADDRESS> \
  --runs 10 \
  --actors ./yield-vault-actors.json \
  --output ./yield-vault-funding-manifest.json
```

The generator writes address-only data from `.env`; `actors.example.json`
documents the accepted schema for manual preparation. Funding remains a
sequential full allocation with no deficit calculation or transfer mode. It
derives a locked run-state at `<output>.run-state.json`; each mint is journaled
before submission and resumes the same hash/governance issue. A fresh output
path starts another full allocation. Re-running a completed output only
reasserts its exact final deltas and submits nothing. Gross minting is proven by the
exact `Transfer` event and total-supply delta. Non-minter recipient deltas are
exact; the MINTER fee-token delta subtracts the recorded per-call fee-token
debits, each of which must be either zero (voucher payment) or the reviewed fee.
After the primary submission persists exact `IssueCreated`, the script
atomically journals an APPROVER intent/account sequence and submits the same
`Token.mint(to, amount)` with independently authenticated `APPROVER`. It never
calls `AdminRegistry.castVoteOnIssue`. The APPROVER raw payload, receipt, exact
newer matching `IssueExecuted`, Cirrus recipient balance, token supply, and mint
event are verified under one 60-second deadline. A restart resumes either saved
hash or APPROVER-nonce recovery without duplicating the primary or approval.

Before validation and again immediately before each mint submission, funding
reads `DeciderState.currentFeeContract` from the STRATO storage endpoint and
the active account's `codeHash` from the account endpoint. The network ID,
pointer, code hash, fee token, and fee amount must exactly match a reviewed
entry in `fee-policy.js`; unknown or changed fee policy fails closed. The
reviewed policy is authoritative for the fee-token address and fee amount;
generic network metadata is not. Each mint then proves the actual MINTER debit
is either zero for voucher payment or exactly that reviewed fee.

Run the focused funding tests without live network calls:

```bash
npm run yield-vault:test-funding
```

## Seed the old implementation

Phase 0 is an explicit operator-reviewed YieldVault-local deployment. Proxy
`917e95e65bf009dd17610d3b68052c05d91ffb7b` and implementation
`f4c539b8f15fa2ea059ad8457b8d882e5bf3ee35` were created by
`Admin #2`, are not Cirrus-indexed for this workflow, and are abandoned.
Never approve issue
`cfb8808c4c13a7dea92b41fe673b7763db45a9c96dc10bdfd6a2883291c460d9`.
After runtime artifact cleanup, use fresh `*-cirrus.json` paths below. The exact
hash inputs are the UTF-8 strings returned by `combineReviewedSource`: the
`blockapps-rest` importer combines the requested Solidity file, importer
filename prefixes are removed, block comments and non-SPDX line comments are
removed, entries retain importer order and are joined with `\n`, and SHA-256 is
applied without another serialization step. Compute all three canonical inputs
from `mercata/contracts`:

```bash
node - <<'NODE'
const { combineReviewedSource } = require("./deploy/yield-vault-testing/scripts/upgrade-safety");

(async () => {
  for (const [name, file] of Object.entries({
    EXPECTED_PROXY_SOURCE_HASH: "./concrete/Proxy/Proxy.sol",
    EXPECTED_OLD_REVIEWED_SOURCE_HASH: "./deploy/yield-vault-testing/YieldVaultOld.sol",
    EXPECTED_REVIEWED_SOURCE_HASH: "./concrete/BaseCodeCollection.sol",
  })) {
    const evidence = await combineReviewedSource(file);
    console.log(`${name}=${evidence.combinedSourceHash}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
```

Independently review those exact combined strings, set the three values in
`.env`, then run:

```bash
cd mercata/contracts
npm run yield-vault:deploy-old-proxy -- \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-old-proxy-run-state-cirrus.json \
  --evidence-output ./yield-vault-old-proxy-evidence-cirrus.json
```

The script validates all authenticated signers and the exact synced testnet.
`DEPLOYER` submits the exact
original DEPLOYER `User.createContract(name, combinedSource, constructorArgs)`
payload for the empty Proxy and reviewed YieldVaultOld implementation. After
each `IssueCreated`, APPROVER calls `createContract` on that same DEPLOYER User
contract with identical nested arguments. `OWNER` submits
`Proxy.setLogicContract`, and APPROVER repeats the exact pointer call. The
workflow writes
one locked, atomic schema-v2 evidence artifact. Put its proxy and implementation
addresses in `.env`, set `OLD_PROXY_EVIDENCE_PATH` to that artifact, then run:

`DEPLOYER_USERNAME`/`DEPLOYER_PASSWORD` authenticate only contract creation.
`OWNER_USERNAME`/`OWNER_PASSWORD` authenticate pointer and vault-owner calls.
`--expected-owner` (default `VAULT_OWNER_ADDRESS`) is the owner stored by the proxy/vault. If those addresses
differ, the stored owner must equal configured `ADMIN_REGISTRY`; preflight reads
its live `adminMap` and requires nonzero membership for the signer. Both
identities and the membership proof are recorded.

```bash
npm run yield-vault:seed-old -- \
  --run-state ./yield-vault-seed-run-state.json
```

After an interruption, use the exact checkpoint printed by the script:

```bash
npm run yield-vault:seed-old -- \
  --run-state ./yield-vault-seed-run-state.json \
  --checkpoint 150
```

The standard `yield-vault-seed-run-state.json` path produces
`yield-vault-seed-manifest.json`; `SEED_MANIFEST_PATH` can override it.

## Safe-upgrade handoff

Execute `SAFE_UPGRADE_RUNBOOK.md` after the seed manifest is complete. The
operator-owned runbook report consumed by E2E must follow
`runbook-report.example.json`. Replace every placeholder and include the
complete runbook snapshot plus exactly four ordered economic smoke transaction
records: deposit, redeem-or-queue, process queue, and claim. The paused-state
`SMOKE_USER` token approval is a fifth, separate prerequisite transaction; it
is not one of the four economic smoke transactions. Include actor, contract
name/address, method, positional arguments, transaction hash, receipt, and
observed global events. The final snapshot must retain the exact `lastAccrual`,
reward distributor balance, and reward distributor allowance.

Set `EXPECTED_REVIEWED_SOURCE_HASH` independently in `.env` to the reviewed
combined-source SHA-256 hash. E2E refuses a runbook report whose
`reviewedSourceHash` does not match it.

Capture the initial snapshot before pausing:

```bash
npm run yield-vault:capture-runbook -- \
  --phase initial \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --output ./yield-vault-runbook-initial-snapshot.json
```

Set `EXPECTED_REVIEWED_SOURCE_HASH` to the exact hash computed above for
`BaseCodeCollection.sol`. Pause the vault, then run the YieldVault-local guarded
upgrade:

```bash
npm run yield-vault:safe-upgrade -- \
  --proxy-address <VAULT_PROXY> \
  --expected-old-implementation <OLD_IMPLEMENTATION> \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-safe-upgrade-run-state.json \
  --evidence-output ./yield-vault-upgrade-evidence.json
```

The workflow refuses deployment unless both signer identities, reviewed source
hash, proxy pointer, owner, initialized YieldVault identity, and paused state
all match. `DEPLOYER` submits the new implementation creation and `OWNER`
submits the pointer change. To roll back
without deploying, use the same YieldVault-local workflow:

```bash
npm run yield-vault:safe-upgrade -- \
  --rollback \
  --proxy-address <VAULT_PROXY> \
  --implementation-address <OLD_IMPLEMENTATION> \
  --expected-current-implementation <NEW_IMPLEMENTATION> \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-rollback-run-state.json \
  --evidence-output ./yield-vault-rollback-evidence.json
```

These local workflows lock both artifact paths and atomically maintain a
schema-v1 run-state plus their evidence schema. Re-run the identical command
with the same paths to reconcile a stopped `submitted` operation or continue
past a confirmed operation. Confirmed deployments and pointers are revalidated
against live receipts/state before return. A `ready` operation may submit once.
A `dispatching` operation searches bounded confirmed and queued raw transactions
by its pre-recorded operation signer account sequence and accepts only the exact intended
source/name/constructor or call. It replays once only when unchanged sequence
and completed empty lookups definitively prove absence; unresolved or
mismatched lookups stop. A
`submitted` operation polls the same transaction/governance issue and verifies
the expected effect with that same signer token. Deployment checkpoints record
DEPLOYER role/address/username identity; pointer checkpoints record OWNER.
Stops print
`UPGRADE_SAFETY_STOP checkpoint=<id> reason=<reason> txHash=<hash-or-none>`;
do not use new arguments or paths to bypass a stop.

After successful `initializeAccrual` and its required failed repeat, capture
`post-initialization`. Manually complete the OWNER/APPROVER
`setRewardDistributor` pair followed by the OWNER/APPROVER
`setPerSecondSavingsRate(1e27)` pair. Then run
`npm run yield-vault:prepare-smoke` to submit only the reward-distributor and
smoke-user allowances. Capture `pre-smoke`, complete the OWNER/APPROVER
`unpause` pair, then run `npm run yield-vault:run-smoke` for the ordered deposit,
queue request, governed queue processing, and claim. Both scripts use resumable
run-state files and write sanitized transaction-evidence files.
On this SolidVM testnet, cleared request structs retain their non-first BLOC
fields; verification therefore requires zero shares, zero `requestOwner`,
cleared active IDs, and empty queue pointers rather than assuming every stale
struct field is zeroed.
For each governed manual step, submit the exact OWNER target call and then the
same target/function/arguments using APPROVER. Copy
`manual-upgrade-evidence.example.json`, enter both receipts plus smoke evidence,
then generate and validate the report. The repeated `initializeAccrual`
APPROVER call is expected to fail and must retain its exact failed receipt.
Every receipt/event hash must match its transaction. BLOC receipts retain their
`hash`, `status`, and matching `txResult.transactionHash`; block/timestamp
evidence comes from raw transactions and global events. Every recorded event
must retain exact global `id` and/or `event_index`, emitting address, attributes,
positive block number, and block timestamp:

```bash
npm run yield-vault:runbook-report -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --upgrade-evidence ./yield-vault-upgrade-evidence.json \
  --manual-evidence ./yield-vault-manual-upgrade-evidence.json \
  --output ./yield-vault-safe-upgrade-report.json
```

Add `--rollback-drill ./yield-vault-rollback-evidence.json` only when attaching
an independently validated historical rollback drill. Without it, the report
records `rollbackPlanAvailable` and does not claim rollback execution evidence.

The report enforces this order: initial snapshot; pause; implementation
deployment submission/execution; pointer submission/execution;
`initializeAccrual`; failed repeated `initializeAccrual`; post-initialization
snapshot; distributor approval; distributor selection; neutral rate; separate
smoke-user approval; pre-smoke snapshot; unpause; the four economic smoke
transactions; final snapshot. Governed execution points are included when
present. The smoke `processQueue` transaction must record all three
`QueueProcessed` rows in exact `event_index` order, including each emitted
`sharesBurned` field.

The `finalSnapshot` is retained in the E2E success artifact. Before any E2E
transaction, checkpoint `000` independently reads and asserts the complete
deterministic handoff state specified by
`TESTNET_UPGRADE_E2E_SEQUENCE.md`, including the new implementation,
preserved claims, distributor funding, queue state, and accounting.

## Run post-upgrade E2E

```bash
npm run yield-vault:upgrade-e2e -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --runbook-report ./yield-vault-safe-upgrade-report.json \
  --run-state ./yield-vault-e2e-run-state.json
```

Resume using the printed checkpoint:

```bash
npm run yield-vault:upgrade-e2e -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --runbook-report ./yield-vault-safe-upgrade-report.json \
  --run-state ./yield-vault-e2e-run-state.json \
  --checkpoint 410
```

Checkpoint `410` intentionally stops until the latest testnet block timestamp
is at least `lastAccrual + 60`. Resume the same checkpoint later; it
recomputes funded accrual from current on-chain inputs.

## Recovery and tests

`ready` checkpoints are known not to have dispatched and may submit once.
`dispatching` checkpoints have no durable hash and never replay automatically.
`submitted` checkpoints reconcile the same hash, governance issue/execution,
events, and exact post-state. Dynamic E2E checkpoints derive their exact state
from transaction-time events. Raw hash recovery queries confirmed transactions
by plain sender with bounded pagination and filters nonce/account sequence
client-side; queued transactions are checked separately, and replacement fails
closed unless both lookups prove absence.

Seed and E2E re-read the reviewed live fee contract before running. When the
underlying is also the fee token, each checkpoint precommits an allowed debit
of either zero (voucher) or exactly one reviewed fee, derives the exact full
post-state from the actor balance after receipt, and persists that state and fee
evidence before confirmation. Economic transfers, share supply, vault supply,
and events remain exact. Fresh runs check full funding budgets; resumes first
validate the journal and then check only unsubmitted remaining checkpoints.
Completed runs reassert final state without requiring already-consumed budgets.

```bash
npm test
```

This runs offline crash/fault injection and tooling tests. Real disposable
testnet execution is explicitly gated:

```bash
YIELD_VAULT_DISPOSABLE_TEST=true npm run yield-vault:test-disposable -- seed \
  --actors ./yield-vault-actors.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --seed-state ./yield-vault-seed-run-state.json \
  --seed-manifest ./yield-vault-seed-manifest.json

YIELD_VAULT_DISPOSABLE_TEST=true npm run yield-vault:test-disposable -- e2e \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --runbook-report ./yield-vault-safe-upgrade-report.json \
  --e2e-state ./yield-vault-e2e-run-state.json \
  --e2e-report ./yield-vault-upgrade-e2e-report.json
```

The staged disposable runner requires fresh funding-manifest (and its derived
`.run-state.json`), seed run-state, seed-manifest, E2E run-state, and E2E report
paths and refuses non-testnet network metadata. Run the manual upgrade/runbook
between its seed and E2E phases.

Exact offline test commands, run from `mercata/contracts`, are:

```bash
npm run yield-vault:test-faults
npm run yield-vault:test-funding
npm run yield-vault:test-upgrade-safety
npm run yield-vault:test-tooling
npm run yield-vault:test-governance
npm test
node -e 'for (const f of require("fs").readdirSync("deploy/yield-vault-testing/fixtures").filter((f) => f.endsWith(".example.json"))) JSON.parse(require("fs").readFileSync(`deploy/yield-vault-testing/fixtures/${f}`, "utf8"))'
node --check deploy/yield-vault-testing/tests/disposable-environment.test.js
node --check deploy/yield-vault-testing/tests/tooling.test.js
```

## Environment progression

Use new run-state and output paths for each non-production environment:

1. Dev: validate authentication, state decoding, failure handling, and resume
   using disposable contracts. Use only dev assets and actors.
2. Testnet: run the full seed, reviewed safe upgrade, and E2E flow with the
   production-like values in the sequence documents.
3. Production: do not run these testnet scripts. Apply the one-vault-at-a-time
   controls and two-admin exact-call approvals in `SAFE_UPGRADE_RUNBOOK.md`; use
   production-reviewed deployment/governance procedures, not the disposable
   runner or testnet fixture commands.

Every checkpoint logs entry and exit traces containing idle assets, deployed
assets, debts, supply, queue/claim totals, and exchange rate. The JSON artifacts
contain the full snapshots, receipts, observed events, interruptions, derived
accrual/queue values, and ghost-ledger reconciliation.
