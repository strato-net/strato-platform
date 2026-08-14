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

## Network profiles

| profile | NODE_URL | REWARDS_ADDRESS | VAULT_ADDRESS | ACTIVITY_ID |
|---------|----------|-----------------|---------------|-------------|
| testnet | https://node1.testnet.strato.nexus | `170147f58738c9f46112a874030420b823901f3b` | `ac8ce8b3d4aa4b9a359dad3bb792a563f7f2e2f5` | 22 |
| prod | https://app.strato.nexus | `4a116cf8cb056036632aef08f7c0df27c720f1c0` | `a94905d8bd117e9bfbe57aadffd7abbea760e028` | 27 |

Select the profile with `--network testnet` or `--network prod`. Individual values can
still be overridden with `NODE_URL`, `REWARDS_ADDRESS`, `VAULT_ADDRESS`, or
`ACTIVITY_ID`; the script verifies that the activity source is the selected vault.

For a mutating command, authenticate either with `ADMIN_TOKEN` or with:

```bash
export STRATO_USERNAME=...
export STRATO_PASSWORD=...
export OAUTH_CLIENT_ID=...
export OAUTH_CLIENT_SECRET=...
export OPENID_DISCOVERY_URL=...
```

The script obtains a short-lived bearer token, prints the authenticated address, and
verifies that address is an AdminRegistry admin. It never writes credentials or tokens
to the snapshot.

## Tooling

Everything on-chain is done by `app/scripts/reconcileVaultRewardsActivity.js`
(Node ≥ 18, no dependencies). Every mutating phase is a **dry run unless `--execute`**
is passed, and every phase verifies its own post-state against Cirrus before returning.

```bash
cd app/scripts
node reconcileVaultRewardsActivity.js preflight --network testnet
node reconcileVaultRewardsActivity.js status --network testnet
```

Production mutations additionally require `--confirm-prod`.

### Governance voting

Every mutating invocation submits exactly one AdminRegistry vote and exits. If the
threshold is not met, it prints `PENDING_VOTES`, the issue ID, and the transaction hash.
Other admins vote on that issue in the Admin UI. After the issue executes, rerun the same
command: its pre-state check reports that the step is complete without creating another
issue.

`withdraw`, `mark-historical`, and `seed` are split into immutable batches. Use
`--batch 1`, then `--batch 2`, and so on. The snapshot fixes the batch size and payloads
so every admin votes on identical arguments.

## Simple execution guide

Run from `app/scripts`. Use `testnet` first. For production, replace `testnet` with
`prod` and add `--confirm-prod` to every command containing `--execute`.

These steps assume the activity emission rate is already `0`.

For every command containing `--execute`:
1. One admin runs the command once.
2. If it prints `PENDING_VOTES`, another admin opens the issue in the Admin UI and votes.
3. Wait for the issue to execute.
4. Run the same command again. It must report that the step is already complete before
   continuing.

### 1. Check configuration

```bash
node reconcileVaultRewardsActivity.js preflight --network testnet
node reconcileVaultRewardsActivity.js status --network testnet
```

Confirm the displayed emission rate is `0`.

### 2. Freeze activity

```bash
node reconcileVaultRewardsActivity.js pause --network testnet --execute
```

After the pause issue executes:
- stop the rewards poller;
- confirm it is stopped.

Do not continue until the vault is paused, the poller is stopped, and the emission rate
is zero.

### 3. Create the immutable snapshot

```bash
node reconcileVaultRewardsActivity.js snapshot --network testnet
```

Keep the generated snapshot unchanged for the remainder of the run.

### 4. Zero existing reward stakes

Preview and execute each batch in order:

```bash
node reconcileVaultRewardsActivity.js withdraw --network testnet --batch 1
node reconcileVaultRewardsActivity.js withdraw --network testnet --batch 1 --execute
```

Repeat with `--batch 2`, `--batch 3`, and so on. The script prints the total batch count.

### 5. Configure the corrected events

```bash
node reconcileVaultRewardsActivity.js set-events --network testnet --execute
```

This configures:
- `Deposit` as a deposit;
- `Withdraw` as a withdrawal;
- `QueueProcessed` as a withdrawal.

### 6. Mark historical vault events as processed

```bash
node reconcileVaultRewardsActivity.js mark-historical --network testnet --batch 1
node reconcileVaultRewardsActivity.js mark-historical --network testnet --batch 1 --execute
```

Repeat for every reported batch.

### 7. Seed corrected reward stakes

```bash
node reconcileVaultRewardsActivity.js seed --network testnet --batch 1
node reconcileVaultRewardsActivity.js seed --network testnet --batch 1 --execute
```

Repeat for every reported batch.

### 8. Verify before restoring service

```bash
node reconcileVaultRewardsActivity.js verify --network testnet
```

Do not proceed unless every check reports `PASS`.

### 9. Restore service

1. Deploy the corrected rewards-poller mapping.
2. Start the rewards poller.
3. Unpause the vault:

```bash
node reconcileVaultRewardsActivity.js unpause --network testnet --execute
```

4. When ready to begin rewards, set the approved emission rate:

```bash
node reconcileVaultRewardsActivity.js set-emission <APPROVED_RATE> --network testnet --execute
```

5. Run final checks:

```bash
node reconcileVaultRewardsActivity.js verify --network testnet
node reconcileVaultRewardsActivity.js status --network testnet
```

## Detailed reference

Run the phases in this order. Keep and share the same `SNAPSHOT_FILE` (default
`./reconcile-<network>-activity-<id>.snapshot.json`) for the whole run; it is the
immutable input for all batched phases.

### 1. Freeze the system

```bash
node reconcileVaultRewardsActivity.js pause --network testnet --execute
# stop the rewards-poller service (docker/k8s — outside this script)
```

The emission rate must already be zero and must stay zero during reconciliation.

Note: pausing blocks deposit/withdraw/queue operations, but **carryETH ERC-20 transfers
are not pausable**. The `seed` phase re-checks balances and aborts if anything moved
since the snapshot.

### 2. Snapshot

```bash
node reconcileVaultRewardsActivity.js snapshot --network testnet
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
node reconcileVaultRewardsActivity.js withdraw --network testnet --batch 1
node reconcileVaultRewardsActivity.js withdraw --network testnet --batch 1 --execute
# repeat for each reported batch
```

One synthetic `Withdraw` per staked user, `amount = exact tracked stake`, sent through
`batchHandleAction` in chunks (≤ the contract's `maxBatchSize`). This settles each
user's accrued rewards into `unclaimedRewards` before zeroing the stake. The phase
verifies `activityStates[id].totalStake == 0` and every `userInfo.stake == 0`, and
fails on any `ActionFailed` event.

### 4. Register QueueProcessed as a withdrawal trigger

```bash
node reconcileVaultRewardsActivity.js set-events --network testnet --execute
```

Calls `setPositionActivityEvents(id, [Deposit→Deposit, Withdraw→Withdraw,
QueueProcessed→Withdraw])`. The contract requires `totalStake == 0`, which is why this
sits between withdraw and seed.

### 5. Immunize historical events against replay

```bash
node reconcileVaultRewardsActivity.js mark-historical --network testnet --batch 1 --execute
# repeat for each reported batch
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
node reconcileVaultRewardsActivity.js seed --network testnet --batch 1
node reconcileVaultRewardsActivity.js seed --network testnet --batch 1 --execute
# repeat for each reported batch
```

One synthetic `Deposit` per current holder, `amount = carryETH balance + unprocessed
queued shares`. Aborts if balances moved since the snapshot; take a new snapshot rather
than changing a payload after voting begins. Each batch verifies its users, and final
verification requires `totalStake == totalSupply` (mainnet expectation:
**45.607444358938680537**).

### 7. Final verification

```bash
node reconcileVaultRewardsActivity.js verify --network testnet
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
3. `node reconcileVaultRewardsActivity.js unpause --network testnet --execute`
4. Only then enable emissions:
   `node reconcileVaultRewardsActivity.js set-emission <rate> --network testnet --execute`
   (testnet activity 22's previous rate was `38580246913580250`).

## Safety properties

- **Idempotent re-runs.** Re-running a completed batch with the same snapshot is
  read-only: the script detects its expected post-state and does not create another
  governance issue.
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
