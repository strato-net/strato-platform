# YieldVault testnet post-upgrade E2E sequence

## Purpose

Verify a value-holding proxy after every step in [`SAFE_UPGRADE_RUNBOOK.md`](./SAFE_UPGRADE_RUNBOOK.md) has completed successfully.

The E2E script does not deploy an implementation, call `setLogicContract`, initialize accrual storage, configure the distributor, pause, or perform the runbook smoke test. Its first state-changing operation settles the claim liabilities left by the completed runbook.

This sequence consumes the manifest produced by [`TESTNET_OLD_VAULT_SEED_SEQUENCE.md`](./TESTNET_OLD_VAULT_SEED_SEQUENCE.md).
It also consumes the actor funding manifest produced by [`TESTNET_ACTOR_FUNDING_SEQUENCE.md`](./TESTNET_ACTOR_FUNDING_SEQUENCE.md).

The script must:

- Stop on the first failed transaction or assertion.
- Record every transaction hash, block timestamp, event, balance delta, and assertion.
- Use integer arithmetic only.
- Never call `initialize()`, `initializeAccrual()`, or `setLogicContract()`.
- Follow the YieldVault-local asynchronous workflow: submit with `isAsync: true`, poll `rest.getBlocResults`, and assert the final receipt status before reading post-state.

If an asynchronous receipt does not expose a Solidity return value, use the emitted event and verified pre/post-state deltas as the authoritative result.

## Recoverable execution requirements

The E2E script must be resumable. A checkpoint ID means:

```text
All operations before CHECKPOINT_ID are confirmed.
CHECKPOINT_ID is the next operation that may need execution or reconciliation.
```

Required CLI shape:

```bash
node run-yield-vault-upgrade-e2e.js \
  --seed-manifest <path> \
  --funding-manifest <path> \
  --runbook-report <path> \
  --run-state <path-to-run-state.json> \
  [--checkpoint <CHECKPOINT_ID>]
```

Checkpoint IDs must remain stable after the run begins.

### Persistent run-state journal

`OWNER_ADDRESS` is the authenticated operator; `VAULT_OWNER_ADDRESS` is the
proxy/vault storage owner. Governed Helium runs set the latter to AdminRegistry
and require nonzero live `adminMap[OWNER_ADDRESS]`. Every submitted owner
checkpoint is explicitly registry-marked `onlyOwner/governed`. Its journal
binds the submission hash to exact `IssueCreated` target/function/arguments and
accepts only the exact newer matching `IssueExecuted`; events and post-state are
verified under the successful execution hash. Direct-owner mode remains
supported.

The consumed safe-upgrade report separately binds implementation deployment to
authenticated `DEPLOYER` (`Admin #1` on Helium) and the pointer update to
authenticated OWNER. Both require current live AdminRegistry membership when
governance is used. DEPLOYER performs no E2E vault calls.

Before every state-changing transaction, atomically persist:

```text
schemaVersion
scriptVersion or source hash
network and NODE_URL identity
seed-manifest hash
actor-funding-manifest hash
safe-upgrade-runbook report hash
E2E configuration hash
checkpointId
operation name
actor address
contract address
method and arguments
expected exact pre-state snapshot
expected post-state snapshot or post-state rules
status = ready
```

Immediately after submission, atomically add:

```text
transaction hash, if returned
submitted nonce/account sequence, if available
submission timestamp
status = submitted
governance issue ID, if returned
```

After receipt and state verification, persist:

```text
receipt
confirmed block number and timestamp
observed events
confirmed post-state snapshot
ghost-ledger state
status = confirmed
nextCheckpointId
```

Then print:

```text
CHECKPOINT_CONFIRMED checkpoint=<CHECKPOINT_ID> next=<NEXT_CHECKPOINT_ID> runState=<absolute-path>
```

Do not store passwords, OAuth tokens, private keys, or other credentials.

### Sixty-second polling boundary

Poll a transaction or governance execution for at most `60` seconds per invocation.

If it remains unresolved:

1. Keep the checkpoint unconfirmed.
2. Preserve its hash, nonce, issue ID, and latest status.
3. Print exactly one machine-readable terminal line:

```text
CHECKPOINT_STOP checkpoint=<CHECKPOINT_ID> runState=<absolute-path> reason=<timeout|nonce_collision|pending_governance|unknown_status> txHash=<hash-or-none>
```

4. Exit nonzero and submit no later operation.

For each governed E2E operation, persist the primary OWNER `IssueCreated`, then
atomically journal APPROVER intent/account sequence and submit the identical
vault target/function/arguments with APPROVER. Never call
`AdminRegistry.castVoteOnIssue`. Verify the APPROVER raw payload/hash/nonce/
receipt and exact newer `IssueExecuted` before target events and state.
Resumption must not duplicate either call; recover a hashless approval only by
the saved APPROVER nonce or fail closed.

### Mandatory resume assertion

When started with `--checkpoint N`, the first executed function must be:

```text
assertCheckpointState(N, runState, fundingManifest, seedManifest, runbookReport)
```

It must verify:

- Network, addresses, asset decimals, constants, implementation, source/config hashes, actor funding manifest, seed manifest, and runbook report match the saved run.
- `Proxy.logicContract` still equals `NEW_IMPLEMENTATION`.
- Every deterministic vault field, underlying balance, share balance, allowance, strategy debt, queue link, request, claim, accrual field, distributor balance, and ghost-ledger value equals the saved checkpoint state.
- All derived accounting identities for that checkpoint hold.
- No later checkpoint is recorded as confirmed.

For time-dependent views such as `pendingAccrual`, assert the stored inputs exactly, then recompute the expected view from the current block timestamp. Do not compare a newly projected amount to a stale projection saved before the interruption.

For an ambiguous prior transaction:

1. If the exact saved pre-state remains and the transaction is definitively failed or absent, refresh the nonce/account sequence and permit one replacement submission.
2. If the exact expected post-state exists, mark the operation confirmed and advance without resubmitting.
3. If the transaction or governance issue remains pending, poll the same hash/issue ID; never submit a duplicate.
4. If neither exact pre-state nor exact post-state exists, print `CHECKPOINT_STATE_MISMATCH` with field-level differences and exit for manual investigation.

A nonce collision does not prove failure. Never retry until transaction status and contract state are reconciled.

Use a lock file tied to the run-state path to prevent concurrent execution or resume.

If the run-state file contains an unfinished run and no `--checkpoint` is supplied, refuse to restart and print the required checkpoint. If checkpoint `700` is already confirmed, reassert the final state and exit successfully without submitting transactions.

### E2E checkpoint registry

```text
000  assert completed runbook handoff state
100  ALICE claims runbook-preserved liability
101  BOB claims runbook-preserved liability
102  assert repeated ALICE claim reverts atomically
103  assert repeated BOB claim reverts atomically
200  verify STRATEGY prefunded recovery/profit budget
201  STRATEGY asset approval
202  return STRATEGY principal and profit
210  redeploy loss-test capital to STRATEGY
211  transfer STRATEGY loss to LOSS_SINK
212  report STRATEGY loss
213  return STRATEGY remaining principal
300  CAROL exact instant redemption
400  enable MAX_RATE
410  wait for accrual interval and call accrue
411  restore flat RAY rate and reconcile any final accrual
500  verify DONOR prefunded donation budget
501  verify DAVE prefunded deposit budget
502  DONOR transfers deliberate donation
503  DAVE asset approval
504  DAVE deposit and donation reconciliation
505  DAVE full redemption
600  deploy max capital to STRATEGY
601  ALICE redeem-or-queue request
602  partially process ALICE request
603  ALICE claims first processed portion
604  STRATEGY asset approval
605  return exact STRATEGY debt
606  process ALICE request remainder
607  ALICE claims final processed portion
700  final accounting reconciliation and success report
```

Checkpoint `410` may be resumed after more than the original `3600`-second wait. Recompute the target at the eventual accrual transaction timestamp and retain the actual credited amount in the ghost ledger.

## Required inputs

Read these values from the seed manifest:

- `OWNER`
- `ALICE`
- `BOB`
- `CAROL`
- `STRATEGY`
- `LOSS_SINK`
- `ASSET`
- `OLD_IMPLEMENTATION`
- `VAULT_PROXY`
- `U = 10^18`
- The complete final unpaused seed snapshot
- The completed actor funding manifest

Read these values from the separate upgrade process:

- `NEW_IMPLEMENTATION`
- Reviewed source commit/hash
- Upgrade transaction hash and governance issue ID, if applicable
- The completed safe-upgrade-runbook report and final snapshot
- `SMOKE_USER`, the controlled account used by runbook Phase 8
- The paused-state `SMOKE_USER -> ASSET.approve(VAULT_PROXY, >= 10 * U)`
  transaction evidence, ordered before the pre-smoke snapshot and unpause

Additional actors:

- `REWARD_DISTRIBUTOR`
- `DAVE`: controlled post-upgrade depositor
- `DONOR`: sends a deliberate stray donation

Additional constants:

```text
MAX_UINT256       = 2^256 - 1
RAY               = 1000000000000000000000000000
MAX_RATE          = 1000000021979553151239153027
REWARD_BUDGET     = 30 * U
ACCRUAL_WAIT      = 3600 seconds
CAROL_REDEEM      = 25 * U
DAVE_DEPOSIT      = 25 * U
DONATION          = 5 * U
NEW_QUEUE_SHARES  = 80 * U
PARTIAL_BUDGET    = 10 * U
```

All addresses must be distinct. `REWARD_DISTRIBUTOR` must not equal the proxy or an indebted strategy.

Required STRATO environment:

```text
NODE_URL
OAUTH_URL
OAUTH_CLIENT_ID
OAUTH_CLIENT_SECRET
EXPECTED_NETWORK_ID
REQUIRE_TESTNET=true
OWNER_USERNAME / OWNER_PASSWORD / OWNER_ADDRESS
DEPLOYER_USERNAME / DEPLOYER_PASSWORD / DEPLOYER_ADDRESS
ALICE_USERNAME / ALICE_PASSWORD / ALICE_ADDRESS
BOB_USERNAME / BOB_PASSWORD / BOB_ADDRESS
CAROL_USERNAME / CAROL_PASSWORD / CAROL_ADDRESS
STRATEGY_USERNAME / STRATEGY_PASSWORD / STRATEGY_ADDRESS
SMOKE_USER_USERNAME / SMOKE_USER_PASSWORD / SMOKE_USER_ADDRESS
REWARD_DISTRIBUTOR_USERNAME / REWARD_DISTRIBUTOR_PASSWORD / REWARD_DISTRIBUTOR_ADDRESS
DONOR_USERNAME / DONOR_PASSWORD / DONOR_ADDRESS
DAVE_USERNAME / DAVE_PASSWORD / DAVE_ADDRESS
LOSS_SINK_ADDRESS
```

Use lowercase 40-hex-character STRATO addresses without `0x`. Each non-owner actor must have credentials or an authenticated transaction path capable of submitting its assigned calls.

## Starting state

The seed script and every phase of the safe upgrade runbook must already be complete. For a deterministic handoff, runbook Phase 6 must verify the prefunded distributor has at least `30 * U` available and keep the rate at `RAY`. Runbook Phase 8 must use this controlled smoke profile:

```text
SMOKE_USER -> deposit(10 * U, SMOKE_USER)
SMOKE_USER -> redeemOrQueue(10 * U, SMOKE_USER, SMOKE_USER)
OWNER      -> processQueue(3, 160 * U)
SMOKE_USER -> claim(SMOKE_USER)
```

These are exactly four economic smoke transactions. Before them, while paused,
`SMOKE_USER` must separately submit
`ASSET.approve(VAULT_PROXY, >= 10 * U)`. That approval is a fifth prerequisite
transaction, not part of the four-operation smoke profile. It must precede the
pre-smoke snapshot and unpause. The four operations process the two seeded
legacy requests before the smoke request, leave the original users' claims
reserved, and make the smoke round trip economically neutral.

Before the E2E script submits any transaction:

1. Read the proxy `logicContract` state field with `rest.getState`.
2. Require it equals `NEW_IMPLEMENTATION` and differs from `OLD_IMPLEMENTATION`.
3. Require the live state exactly matches the final safe-upgrade-runbook snapshot.
4. Require the runbook report proves seed-state preservation, the paused-state
   smoke-user approval, pre-unpause safety, and strict transaction/event order
   before its four-operation economic smoke test.
5. Require the implementation source commit/hash matches the reviewed input.

```text
paused()                       == false
vaultInitialized()             == true
accrualInitialized()           == true
perSecondSavingsRate()         == RAY
rewardDistributor()            == REWARD_DISTRIBUTOR
accountedAssets()              == 450 * U

idle                           == 250 * U
deployedAssets()               == 200 * U
strategyDebt(STRATEGY)         == 200 * U
totalAssets()                  == 450 * U

totalSupply()                  == 250 * U
balanceOf(ALICE)               == 80 * U
balanceOf(BOB)                 == 70 * U
balanceOf(CAROL)               == 100 * U
balanceOf(SMOKE_USER)          == 0
balanceOf(VAULT_PROXY)         == 0

queueHead()                    == 0
queueTail()                    == 0
nextRequestId()                == 4
totalQueuedShares()            == 0
activeRequestId(ALICE)         == 0
activeRequestId(BOB)           == 0
activeRequestId(SMOKE_USER)    == 0

claimableAssets(ALICE)         == 120 * U
claimableAssets(BOB)           == 80 * U
claimableAssets(SMOKE_USER)    == 0
totalClaimableAssets()         == 200 * U

activeAssets()                 == 250 * U
exchangeRate()                 == 1 * U
minIdleBps()                   == 1000
distributor balance            >= 30 * U
```

Record the exact distributor balance as `DISTRIBUTOR_START_BALANCE`. Require `accountedAssets == idle + deployedAssets`. Abort on any mismatch.

## Phase 1: settle the claims preserved by the runbook

Record `ALICE`, `BOB`, and proxy underlying balances.

Execute:

```text
ALICE -> claim(ALICE)
BOB   -> claim(BOB)
```

Require:

```text
ALICE underlying increase == 120 * U
BOB underlying increase   == 80 * U
proxy underlying decrease == 200 * U

claimableAssets(ALICE)     == 0
claimableAssets(BOB)       == 0
totalClaimableAssets()     == 0

idle                       == 50 * U
deployedAssets()           == 200 * U
totalAssets()              == 250 * U
accountedAssets()          == 250 * U
totalSupply()              == 250 * U
exchangeRate()             == 1 * U
```

Attempt another claim from both users and require each call reverts without changing balances or accounting.

## Phase 2: verify post-upgrade strategy profit and loss

### 2.1 Strategy profit

Do not mint during the E2E run. The funding manifest includes the recovery/profit budget. Require `STRATEGY` has at least `210 * U` available before returning `200 * U` of debt plus `10 * U` of profit.

From `STRATEGY`, call:

```text
ASSET.approve(VAULT_PROXY, MAX_UINT256)
```

As `OWNER`, call:

```text
returnCapital(STRATEGY, 210 * U)
```

Verify the strategy token balance decreases by exactly `210 * U`.

Require:

```text
principalRepaid                 == 200 * U
realizedProfit                  == 10 * U
strategyDebt(STRATEGY)          == 0
deployedAssets()                == 0
idle                            == 260 * U
totalAssets()                   == 260 * U
accountedAssets()               == 260 * U
totalSupply()                   == 250 * U
exchangeRate()                  == 1040000000000000000
```

### 2.2 Strategy loss and principal return

As `OWNER`, call:

```text
deployCapital(STRATEGY, 80 * U)
```

Require:

```text
strategyDebt(STRATEGY) == 80 * U
deployedAssets()       == 80 * U
idle                   == 180 * U
totalAssets()          == 260 * U
accountedAssets()      == 260 * U
```

Verify the strategy token-balance increases by exactly `80 * U`.

From `STRATEGY`, call:

```text
ASSET.transfer(LOSS_SINK, 20 * U)
```

Verify the strategy token balance decreases by exactly `20 * U`.

As `OWNER`, call:

```text
reportStrategyLoss(STRATEGY, 20 * U)
```

Require:

```text
strategyDebt(STRATEGY) == 60 * U
deployedAssets()       == 60 * U
idle                   == 180 * U
totalAssets()          == 240 * U
accountedAssets()      == 240 * U
totalSupply()          == 250 * U
exchangeRate()         == 960000000000000000
```

As `OWNER`, call:

```text
returnCapital(STRATEGY, 60 * U)
```

Verify the strategy token balance decreases by exactly `60 * U`.

Require:

```text
strategyDebt(STRATEGY) == 0
deployedAssets()       == 0
idle                   == 240 * U
totalAssets()          == 240 * U
accountedAssets()      == 240 * U
```

At every step require:

```text
deployedAssets == strategyDebt(STRATEGY)
accountedAssets == idle + deployedAssets
```

## Phase 3: verify an exact instant exit

Before the call require:

```text
previewRedeem(25 * U) == 24 * U
maxRedeem(CAROL)      == 100 * U
```

From `CAROL`, call:

```text
redeem(25 * U, CAROL, CAROL)
```

Require:

```text
CAROL underlying increase == 24 * U
CAROL share decrease      == 25 * U
balanceOf(CAROL)          == 75 * U
totalSupply()             == 225 * U
idle                      == 216 * U
totalAssets()             == 216 * U
accountedAssets()         == 216 * U
exchangeRate()            == 960000000000000000
```

## Phase 4: verify funded accrual

As `OWNER`, call:

```text
setPerSecondSavingsRate(MAX_RATE)
```

Require this call credits zero under the previous flat rate and sets:

```text
perSecondSavingsRate() == MAX_RATE
lastAccrual()           == rate transaction block timestamp
```

Wait until the latest testnet block timestamp is at least:

```text
lastAccrual + 3600
```

Read:

```text
(targetAmount, fundedAmount) = pendingAccrual()
```

Require:

```text
targetAmount > 0
fundedAmount == targetAmount
fundedAmount <= distributor balance
fundedAmount <= distributor allowance
```

Record:

```text
idleBefore
accountedBefore
supplyBefore
deployedBefore
distributorBalanceBefore
```

As `OWNER`, call:

```text
accrue()
```

Read the transaction block timestamp and `Accrued` event. Let:

```text
Y1 = creditedAmount from Accrued
```

Require:

```text
Y1 > 0
idle increase                    == Y1
accountedAssets increase         == Y1
distributor balance decrease     == Y1
totalSupply                      == supplyBefore
deployedAssets                   == deployedBefore
creditedAmount <= targetAmount in the transaction event
```

Immediately stabilize future arithmetic by calling as `OWNER`:

```text
setPerSecondSavingsRate(RAY)
```

This setter accrues any time elapsed since the previous transaction. Let `Y2` be the distributor/proxy balance delta, confirmed by its return value or `Accrued` event when exposed. `Y2` may be zero or positive.

Define:

```text
TOTAL_CREDITED = Y1 + Y2
```

Require:

```text
perSecondSavingsRate() == RAY
idle                    == (216 * U) + TOTAL_CREDITED
accountedAssets()       == (216 * U) + TOTAL_CREDITED
totalSupply()           == 225 * U
deployedAssets()        == 0
```

Do not hardcode `TOTAL_CREDITED`; derive it from transaction receipts and balance deltas.

## Phase 5: verify donation reconciliation and post-upgrade entry/exit

Do not mint during the E2E run. Require the funding manifest and current balances show `DONOR` has at least `5 * U` and `DAVE` has at least `25 * U`.

From `DONOR`, call:

```text
ASSET.transfer(VAULT_PROXY, 5 * U)
```

Require:

```text
totalAssets - accountedAssets == 5 * U
```

From `DAVE`, call:

```text
ASSET.approve(VAULT_PROXY, MAX_UINT256)
```

Read:

```text
DAVE_SHARES = previewDeposit(25 * U)
```

Require `DAVE_SHARES > 0`.

Record the distributor balance, then call from `DAVE`:

```text
deposit(25 * U, DAVE)
```

Require:

```text
balanceOf(DAVE)                  == DAVE_SHARES
DAVE underlying decrease        == 25 * U
distributor balance increase    == 5 * U
totalAssets                     == accountedAssets
accountedAssets increase,
  relative to the pre-donation
  accounted value               == 25 * U
```

The donation must not change `DAVE_SHARES`.

Read:

```text
DAVE_ASSETS = previewRedeem(DAVE_SHARES)
```

Then call from `DAVE`:

```text
redeem(DAVE_SHARES, DAVE, DAVE)
```

Require:

```text
DAVE underlying increase == DAVE_ASSETS
balanceOf(DAVE)           == 0
totalSupply()             == 225 * U
totalAssets()             == accountedAssets()
```

Any rounding remainder must stay in the vault and benefit remaining shareholders.

## Phase 6: verify a new partial queued exit

Record:

```text
QUEUE_ASSETS_BEFORE = accountedAssets()
QUEUE_SUPPLY_BEFORE = totalSupply()
ALICE_QUEUE_VALUE   = previewRedeem(80 * U)
```

Require:

```text
QUEUE_SUPPLY_BEFORE == 225 * U
balanceOf(ALICE)    == 80 * U
queueHead()         == 0
```

Read:

```text
DEPLOY_AMOUNT = maxDeploy()
```

Require:

```text
DEPLOY_AMOUNT > 0
DEPLOY_AMOUNT < idle
```

As `OWNER`, call:

```text
deployCapital(STRATEGY, DEPLOY_AMOUNT)
```

Require deployment leaves the configured 10% minimum idle reserve and does not change `accountedAssets` or share value.

From `ALICE`, call:

```text
redeemOrQueue(80 * U, ALICE, ALICE)
```

Require:

```text
paidNow                  == 0
requestId                == 4
queueHead()              == 4
queueTail()              == 4
totalQueuedShares()      == 80 * U
balanceOf(ALICE)         == 0
maxRedeem(BOB)           == 0
maxDeploy()              == 0
```

Record the proxy underlying balance. As `OWNER`, call:

```text
processQueue(
  maxRequests = 1,
  maxAssets   = 10 * U
)
```

Read the `QueueProcessed` event and define:

```text
FIRST_BURNED   = sharesBurned
FIRST_RESERVED = assetsReserved
```

Require:

```text
FIRST_BURNED > 0
FIRST_BURNED < 80 * U
FIRST_RESERVED > 0
FIRST_RESERVED <= 10 * U
proxy underlying balance unchanged
claimableAssets(ALICE) == FIRST_RESERVED
requests(4).shares == (80 * U) - FIRST_BURNED
```

From `ALICE`, call:

```text
claim(ALICE)
```

Require the exact `FIRST_RESERVED` amount is paid and the queued remainder is unchanged.

From `STRATEGY`, call:

```text
ASSET.approve(VAULT_PROXY, MAX_UINT256)
```

As `OWNER`, return the exact live debt:

```text
returnCapital(STRATEGY, strategyDebt(STRATEGY))
```

Require principal return does not change active share value.

As `OWNER`, call:

```text
processQueue(
  maxRequests = 1,
  maxAssets   = MAX_UINT256
)
```

Read the event and define:

```text
SECOND_BURNED   = sharesBurned
SECOND_RESERVED = assetsReserved
```

Require:

```text
FIRST_BURNED + SECOND_BURNED == 80 * U
totalQueuedShares()          == 0
queueHead()                  == 0
queueTail()                  == 0
activeRequestId(ALICE)       == 0
claimableAssets(ALICE)       == SECOND_RESERVED
```

From `ALICE`, call:

```text
claim(ALICE)
```

Require:

```text
ALICE aggregate queue receipts
  == FIRST_RESERVED + SECOND_RESERVED

FIRST_RESERVED + SECOND_RESERVED + 1
  >= ALICE_QUEUE_VALUE

totalSupply()                == 145 * U
balanceOf(BOB)               == 70 * U
balanceOf(CAROL)             == 75 * U
balanceOf(VAULT_PROXY)       == 0
totalClaimableAssets()       == 0
deployedAssets()             == 0
strategyDebt(STRATEGY)       == 0
accountedAssets()            == underlying.balanceOf(VAULT_PROXY)
totalAssets()                == accountedAssets()
```

The aggregate split claim may be at most one underlying wei below the single-shot preview because each processed portion rounds down independently.

## Phase 7: final accounting reconciliation

The script must maintain a ghost accounting ledger from the final safe-upgrade-runbook snapshot onward:

```text
expectedAccounted =
    runbookFinalAccounted
    + actual deposits received
    + funded accrual credited
    + realized strategy profit
    - instant withdrawal/redeem payouts
    - queue claim payouts
    - reported strategy losses
```

The deliberate `5 * U` donation and its removal do not change `expectedAccounted`.

At the end require:

```text
accountedAssets == expectedAccounted
totalAssets == idle + deployedAssets
deployedAssets == sum of checked strategy debts
totalClaimableAssets == sum of checked user claims
totalQueuedShares == sum of live request shares
idle >= totalClaimableAssets
```

Also require:

- Every underlying outflow from the proxy was classified as an instant exit, claim, deployment, or stray removal.
- Queue request and processing transactions transferred no underlying.
- Failed/reverted calls changed no balances or storage.
- The final implementation address remains `NEW_IMPLEMENTATION`.

## Success artifact

Write a JSON report with `schemaVersion: 1`, type
`yield-vault-upgrade-e2e`, containing:

- Seed-manifest hash.
- Actor-funding-manifest hash.
- Safe-upgrade-runbook report hash, smoke-user approval ID, and the four
  economic smoke transaction IDs.
- Old and new implementation addresses.
- Source commit/hash.
- Referenced external upgrade/governance transaction IDs.
- Seed, final safe-upgrade-runbook, E2E starting, and E2E final snapshots.
- All transaction hashes, block timestamps, return values, and events.
- `Y1`, `Y2`, and `TOTAL_CREDITED`.
- `DAVE_SHARES` and `DAVE_ASSETS`.
- `DEPLOY_AMOUNT`, queue processing amounts, and aggregate queue receipts.
- Ghost-ledger entries and final reconciliation.
- Run-state schema/script hashes and complete checkpoint, interruption, transaction, and resume history.
- Confirmation that checkpoint `700` completed.
- A boolean result for every assertion in this document.

The already-upgraded proxy is considered safe for the tested flows only if every assertion passes. Any unexplained mismatch invalidates the run.

Run the exact offline E2E/recovery validation from `mercata/contracts`:

```bash
npm run yield-vault:test-faults
npm run yield-vault:test-tooling
```
