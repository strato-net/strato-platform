# Reconciling a YieldVault Rewards Activity (carryETH)

## Background

The "ETH Carry Vault" rewards activity (testnet activity **22**, mainnet activity **27**)
tracks positions from the vault's `Deposit` and `Withdraw` events only. Two bugs made
the event-derived positions drift from real share ownership:

1. **`QueueProcessed` was never counted.** Queued redemptions burn the owner's shares in
   `processQueue()` and emit `QueueProcessed(requestId, owner, sharesBurned, ...)` — no
   `Withdraw` event. Users whose withdrawal went through the queue kept their full stake
   and kept accruing rewards after exiting.
2. **`Withdraw` was attributed to `receiver`, not `owner`.** The ERC-4626 `Withdraw`
   event burns `owner`'s shares; the poller mapping used `receiver`, so third-party
   withdrawals decremented the wrong user.

Observed drift at the time of writing:

| network | activity | tracked totalStake | vault totalSupply | drift |
|---------|----------|-------------------:|------------------:|------:|
| mainnet | 27       | 55.3247            | 45.6074           | 9.7172 |
| testnet | 22       | 18.2431            | 8.4404            | 9.8028 |

The reconciliation is **per user**, not aggregate: stale holders must stop earning and
current holders must get exactly `balance + unprocessed queued shares`. Synthetic
Withdraw actions settle (not delete) all previously earned rewards.

## Addresses

| network | NODE_URL | REWARDS_ADDRESS | VAULT_ADDRESS | ACTIVITY_ID |
|---------|----------|-----------------|---------------|-------------|
| testnet | https://node1.testnet.strato.nexus | `170147f58738c9f46112a874030420b823901f3b` | `ac8ce8b3d4aa4b9a359dad3bb792a563f7f2e2f5` | 22 |
| mainnet | (production node) | `4a116cf8cb056036632aef08f7c0df27c720f1c0` | `a94905d8bd117e9bfbe57aadffd7abbea760e028` | 27 |

`ADMIN_TOKEN` must be an OAuth bearer token for an identity registered as an admin in
the AdminRegistry that owns both contracts (the `onlyOwner` modifier routes non-owner
callers through `AdminRegistry.castVoteOnIssue`; with a single-admin threshold the call
executes immediately — the same path the rewards-poller uses).

## Tooling

Everything on-chain is done by `app/scripts/reconcileVaultRewardsActivity.js`
(Node ≥ 18, no dependencies). Every mutating phase is a **dry run unless `--execute`**
is passed, and every phase verifies its own post-state against Cirrus before returning.

```bash
export NODE_URL=...
export ADMIN_TOKEN=...
export REWARDS_ADDRESS=...
export VAULT_ADDRESS=...
export ACTIVITY_ID=...
cd app/scripts
node reconcileVaultRewardsActivity.js status     # inspect drift any time, read-only
```

## Procedure

Run the phases in this order. Keep the same `SNAPSHOT_FILE` (default
`./reconcile-activity-<id>.snapshot.json`) for the whole run; it is the immutable input
for the `withdraw` and `seed` phases.

### 1. Freeze the system

```bash
node reconcileVaultRewardsActivity.js pause --execute      # pause the YieldVault
# stop the rewards-poller service (docker/k8s — outside this script)
```

Emission must stay zero during the reconciliation (mainnet activity 27 already is).
On testnet, zero it first and note the old value so you can restore it:

```bash
node reconcileVaultRewardsActivity.js set-emission 0 --execute
```

Note: pausing blocks deposit/withdraw/queue operations, but **carryETH ERC-20 transfers
are not pausable**. The `seed` phase re-checks balances and aborts if anything moved
since the snapshot.

### 2. Snapshot

```bash
node reconcileVaultRewardsActivity.js snapshot
```

Read-only. This:
- snapshots every activity stake, every carryETH balance, and live queued shares per
  request owner (`requests` joined with `requestOwner`; stale Cirrus rows for deleted
  requests are excluded and cross-checked against `totalQueuedShares`);
- verifies `sum(stakes) == totalStake` and `sum(balances) == totalSupply` (aborts if
  Cirrus is lagging);
- reserves synthetic `(blockNumber, eventIndex)` pairs — a finalized snapshot block with
  event indexes starting at 1,000,000 — and **verifies each pair is absent from
  `processedEvents`** by recomputing SolidVM's `keccak256(blockNumber, eventIndex)`
  (hex of keccak256 over the RLP of the two ints; replication validated against live
  rows);
- lists every real vault event not yet in `processedEvents` (drain check), and prints
  the per-user drift table and the plan.

If the withdraw phase later finds any stake changed since the snapshot it aborts —
that's the signal the poller is still running.

### 3. Zero out all tracked positions

```bash
node reconcileVaultRewardsActivity.js withdraw            # review the dry run
node reconcileVaultRewardsActivity.js withdraw --execute
```

One synthetic `Withdraw` per staked user, `amount = exact tracked stake`, sent through
`batchHandleAction` in chunks (≤ the contract's `maxBatchSize`). This settles each
user's accrued rewards into `unclaimedRewards` before zeroing the stake. The phase
verifies `activityStates[id].totalStake == 0` and every `userInfo.stake == 0`, and
fails on any `ActionFailed` event.

### 4. Register QueueProcessed as a withdrawal trigger

```bash
node reconcileVaultRewardsActivity.js set-events --execute
```

Calls `setPositionActivityEvents(id, [Deposit→Deposit, Withdraw→Withdraw,
QueueProcessed→Withdraw])`. The contract requires `totalStake == 0`, which is why this
sits between withdraw and seed.

### 5. Immunize historical events against replay

```bash
node reconcileVaultRewardsActivity.js mark-historical --execute
```

Every real vault `Deposit`/`Withdraw`/`QueueProcessed` event not yet in
`processedEvents` (all historical `QueueProcessed` events, plus any events from
poller-skipped batches) is marked processed via a **zero-amount** synthetic action using
the event's real `(blockNumber, eventIndex)`. Zero-amount actions record the
idempotency hash and return before touching stake, so this cannot change positions —
but it guarantees that no poller restart, cursor rewind, or replay can ever apply those
events on top of the seeded positions.

### 6. Seed correct positions

```bash
node reconcileVaultRewardsActivity.js seed                # review the dry run
node reconcileVaultRewardsActivity.js seed --execute
```

One synthetic `Deposit` per current holder, `amount = carryETH balance + unprocessed
queued shares`. Aborts if balances moved since the snapshot (re-snapshot, or
`--refresh-targets` to seed live values), if the seed total ≠ live `totalSupply`, or if
`totalStake ≠ 0`. Verifies afterwards that every stake equals its target and
`totalStake == totalSupply` (mainnet expectation: **45.607444358938680537**).

### 7. Final verification

```bash
node reconcileVaultRewardsActivity.js verify
```

Checks: actionable events are the new triple; `sum(stakes) == totalStake ==
vault totalSupply`; per-user `stake == balance + queued`. Prints the drift table (all
zeros on success).

### 8. Unfreeze

1. Deploy the rewards-poller with the updated
   `services/rewards-poller/src/infra/config/attributeMapping.json` (this repo change):
   `Withdraw.user` corrected `receiver → owner`, and `QueueProcessed
   {amount: sharesBurned, user: owner}` added for both carryETH vault addresses.
   **Do not reset the poller's cursor file** (`lastProcessedBlock.json`) — and even if
   someone does, step 5 has made historical events replay-proof.
2. Start the poller.
3. `node reconcileVaultRewardsActivity.js unpause --execute`
4. Only then enable emissions:
   `node reconcileVaultRewardsActivity.js set-emission <rate> --execute`
   (testnet activity 22's previous rate was `38580246913580250`).

## Safety properties

- **Idempotent re-runs.** Re-running `withdraw`/`seed` with the same snapshot file is
  safe: already-applied synthetic actions are skipped by the contract's idempotency
  check, and the remaining ones apply. `mark-historical` re-probes live state each run.
- **No reward loss.** Synthetic withdrawals settle pending rewards into
  `unclaimedRewards`; nothing is deleted. With emission at zero, no rewards accrue to
  anyone between phases.
- **Unique event identities.** Synthetic pairs live at `eventIndex ≥ 1,000,000` in a
  finalized block (real indexes are < 1,000) and are individually verified against
  `processedEvents` before use. Blocks are immutable, so the pairs can never collide
  with a future real event.
- **Abort-on-drift.** Each phase re-reads chain state and refuses to proceed on any
  mismatch (running poller, moved balances, lagging Cirrus, failed actions).

## Known limitations / follow-ups

- **carryETH transfers still aren't tracked.** ERC-20 `Transfer` between users changes
  ownership without any actionable event, so positions will drift again if holders
  transfer shares. Fixing that needs a Transfer-based activity design (or vault
  transfer restrictions) — out of scope here.
- **Other YieldVaults have the same bugs.** Several other vault addresses in
  `attributeMapping.json` still map `Withdraw.user = receiver` and lack
  `QueueProcessed` (e.g. `22550671...`, `ceeb982f...`, `97d3b5da...`, `0b5831ed...`,
  `9c9bcc6e...`, `afcfc4d8...`). Their activities need this same reconciliation before
  their mappings are corrected (the on-chain `setPositionActivityEvents` requires
  totalStake = 0). This script is parameterized to be reused for them.
- **Old testnet stragglers.** The testnet drain check found ~22 April-era
  Deposit/Withdraw events that the poller never processed (skipped batches).
  `mark-historical` neutralizes them; their effects are already inside the balance
  targets.
