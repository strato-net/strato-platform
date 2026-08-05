# YieldVault safe upgrade runbook

## Scope

Upgrade a deployed, value-holding proxy from [`YieldVaultOld.sol`](../YieldVaultOld.sol) to [`YieldVault.sol`](../../../concrete/YieldVault/YieldVault.sol).

The proxy address, share token, user balances, queue, claims, strategy debt, and underlying assets remain in proxy storage. Only the implementation address changes.

## Critical rules

- Upgrade one vault at a time; do not batch production vaults.
- Run this process on dev and testnet with production-like state first.
- The `yield-vault:*` fixture commands below are restricted to synced dev/testnet
  networks by `REQUIRE_TESTNET=true`. Do not run them in production; apply the
  same controls through production-reviewed deployment and governance
  procedures.
- Do not call `initialize()` again. Existing vaults must call `initializeAccrual()` exactly once.
- Keep the old implementation address for rollback.
- Do not unpause until every post-upgrade invariant passes.
- Fund and approve the reward distributor before enabling a rate above `1e27`.

## 1. Record a complete pre-upgrade snapshot

Record the following from the proxy and underlying token:

- Proxy address, current implementation address, and proxy owner.
- `asset()`, share name/symbol, pause state, and `vaultInitialized`.
- Underlying token balance held by the proxy (`idle`).
- `deployedAssets`, each approved strategy, and each `strategyDebt`.
- `totalSupply` and relevant user/vault share balances.
- `minIdleBps`.
- `queueHead`, `queueTail`, `nextRequestId`, and `totalQueuedShares`.
- Every active request needed to reconstruct the linked queue.
- `totalClaimableAssets` and all nonzero user `claimableAssets`.

Calculate and record:

```text
grossEconomicAssets = underlying.balanceOf(proxy) + deployedAssets
activeAssets         = max(grossEconomicAssets - totalClaimableAssets, 0)
exchangeRate         = activeAssets × 1e18 / totalSupply
```

If `totalSupply == 0`, record the expected exchange rate as `1e18`.

Reconcile strategy debt and queue/claim totals before proceeding. Do not upgrade while any discrepancy is unexplained.

## 2. Pause the vault

1. Call `pause()` through the current implementation.
2. Confirm the governance issue executes, if governance owns the proxy/vault.
3. Confirm `paused() == true`.
4. Wait for in-flight transactions to finalize.
5. Take a second snapshot and compare it with the first.

Pause blocks deposits, mints, user exits, new queue requests, queue processing, deployment, loss reporting, and explicit `accrue()`. It does not block direct token transfers, claims, cancellations, capital returns, or accrual configuration. Operationally stop those actors and monitor the proxy balance until migration finishes.

Direct donations cannot be distinguished from legitimate assets by the migration initializer. If the token balance changes unexpectedly before `initializeAccrual()`, stop and investigate; do not initialize against an unexplained balance.

## 3. Deploy the implementation and submit the upgrade

Set `EXPECTED_REVIEWED_SOURCE_HASH` to the exact SHA-256 hash of the reviewed,
in-memory combined `BaseCodeCollection.sol` source. The YieldVault-local script
checks the source, network, pointer, owner, initialized vault identity, and
paused state before deploying and submitting `Proxy.setLogicContract`.
The exact input is the normalized UTF-8 string returned by
`combineReviewedSource("concrete/BaseCodeCollection.sol")`: importer filename
prefixes, block comments, and non-SPDX line comments are removed; importer
entry order is retained and entries are joined with `\n`; SHA-256 is then
applied directly. Use the canonical hash command in
`../README.md` and independently review that
combined string.

```bash
cd mercata/contracts
npm run yield-vault:safe-upgrade -- \
  --proxy-address <VAULT_PROXY> \
  --expected-old-implementation <OLD_IMPLEMENTATION> \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-safe-upgrade-run-state.json \
  --evidence-output ./yield-vault-upgrade-evidence.json
```

`DEPLOYER` and `OWNER` are separate authenticated signers. `DEPLOYER` is used
only for `createContract`; on Helium it must be `Admin #1` so the
new implementation is indexed in Cirrus. `OWNER` alone submits
`Proxy.setLogicContract` and all vault `onlyOwner` calls.
`OWNER_ADDRESS` is always the authenticated owner-operator EOA.
`--expected-owner` (default `VAULT_OWNER_ADDRESS`) is the owner stored in
proxy/vault state. If they differ,
the expected owner must be configured `ADMIN_REGISTRY`, and preflight must
record nonzero live `adminMap` membership for both signers.

The deployment governance payload is exactly the original DEPLOYER User
contract's `createContract("YieldVault", combinedSource, deadbeef)`. After the
DEPLOYER call creates the issue, independently authenticated APPROVER calls
`createContract` on that same User target with identical nested constructor
arguments. OWNER then submits `Proxy.setLogicContract`, followed by the same
pointer call from APPROVER. Never call `AdminRegistry.castVoteOnIssue`. A
stopped or resumed operation retains primary/APPROVER identities, intent,
account sequence, hash, receipt, and raw payload and cannot duplicate either
submission.

The implementation constructor uses `{"initialOwner":"deadbeef"}`. Implementation
constructor storage is ignored during proxy delegate calls; the existing,
explicitly checked proxy owner remains authoritative.

Use only `yield-vault:safe-upgrade`; the shared upgrade command does not perform
these guards or emit the required evidence. The completed artifact must be
`schemaVersion: 1`, type `proxy-upgrade-evidence`, mode `upgrade`, and include
the source hash binding, implementation creation receipt/address, confirmed
`deploy-new-implementation` and `upgrade-pointer` operations, pointer
submission/execution evidence, pre/post snapshots, and governance evidence when
applicable. Deployment evidence must bind DEPLOYER; pointer evidence must bind
OWNER, including exact raw transaction and governance payload checks.

After submission:

- Record the new implementation address.
- Verify the deployed contract is `YieldVault`.
- Confirm its source/version corresponds to the reviewed commit.
- Confirm the underlying proxy address passed to the script is correct.

The upgrade script submits `Proxy.setLogicContract(newImplementation)`. If governance is involved, it binds `IssueExecuted` to the exact later `IssueCreated` instance by issue, target, function, arguments, block/timestamp, and event index; an older same-issue row is rejected. It prints the issue ID immediately for manual voting, records proposal and execution hashes/receipts, then requires `Proxy.logicContract == newImplementation`. If approval is not complete in 60 seconds, rerun the identical command and paths; it polls the same issue and never resubmits. Do not continue without the completed structured evidence file.

## 4. Initialize appended storage immediately

After the proxy points to the new implementation, call through the proxy:

```text
YieldVault(<VAULT_PROXY>).initializeAccrual()
```

This owner-only, one-time call sets:

```text
accountedAssets       = underlying.balanceOf(proxy) + deployedAssets
perSecondSavingsRate  = 1e27
lastAccrual            = current block timestamp
accrualInitialized     = true
rewardDistributor      = address(0)
```

The rate starts neutral, so migration itself does not create rewards.

Verify:

- `accrualInitialized == true`.
- `perSecondSavingsRate == 1e27`.
- `rewardDistributor == address(0)`.
- `accountedAssets == underlying.balanceOf(proxy) + deployedAssets`.
- A second `initializeAccrual()` call reverts.

`pause`, the successful `initializeAccrual`, its failed repeat,
`setRewardDistributor`, `setPerSecondSavingsRate`, `unpause`, and smoke
`processQueue` are all `onlyOwner`. When `VAULT_OWNER_ADDRESS` is AdminRegistry,
submit each as the authenticated OWNER admin, record the exact `IssueCreated`,
then submit the identical target/function/arguments as APPROVER. Record the
APPROVER raw call/receipt and exact newer matching `IssueExecuted` plus target
events. For the failed repeat, record the successful OWNER issue-creation
submission and the identical APPROVER call's failed receipt/state; the reverting
APPROVER execution does not leave an `IssueExecuted` row. In direct-owner mode,
retain the direct raw call and receipt.

Do not continue if `accountedAssets` differs from the pre-initialization gross economic assets.

## 5. Verify storage preservation

Compare the post-initialization state against the final pre-upgrade snapshot:

- Asset address, metadata, total supply, and all checked share balances are identical.
- `deployedAssets`, strategy approvals, and strategy debts are identical.
- Queue pointers, request contents, queued shares, and claimable assets are identical.
- `minIdleBps` and pause state are identical.
- Underlying idle balance is unchanged.
- `totalAssets`, `activeAssets`, and exchange rate are unchanged.

Initialization should only populate the five appended fields and emit `AccrualInitialized`.

## 6. Configure and fund the distributor

For the vault's underlying token:

1. Transfer the intended reward budget to the distributor. For the deterministic testnet workflow, do not transfer again; verify the actor funding manifest already left at least `30` underlying tokens available.
2. Verify the distributor is not the vault proxy and has zero `strategyDebt`.
3. Call `setRewardDistributor(<DISTRIBUTOR>)`.
4. Verify `rewardDistributor` and the `RewardDistributorUpdated` event.
5. Call `setPerSecondSavingsRate(1e27)` while the vault is still paused.
6. From the distributor, approve the vault proxy for the intended allowance.
7. Verify distributor balance and allowance on-chain.

Initial distributor setup temporarily installs the new distributor before internal accrual. This gives stray-asset cleanup a valid recipient.
The deterministic migration keeps the existing and configured rate at neutral
`1e27`, so neither setter can pull a reward before the allowance in step 6.
Never deploy vault capital to the active reward distributor; the contract rejects this role overlap.

For step 5, call:

```text
setPerSecondSavingsRate(<RATE_RAY>)
```

Verify:

- `1e27 <= RATE_RAY <= MAX_PER_SECOND_SAVINGS_RATE`.
- `perSecondSavingsRate == RATE_RAY`.
- `lastAccrual` equals the rate-change block timestamp.
- `PerSecondSavingsRateUpdated(RATE_RAY)` was emitted.

The setter settles elapsed time under the old rate before storing the new rate. Because the migration rate is `1e27`, initial configuration should not pull a reward.

Rate and distributor setters remain callable while paused and can invoke internal accrual. Keep the rate neutral until the distributor is correctly funded and approved.

## 7. Pre-unpause smoke checks

While paused:

- From `SMOKE_USER`, call `ASSET.approve(VAULT_PROXY, >= 10 * U)` and retain the
  raw transaction, receipt, and exact `Approval` event evidence. This approval
  must precede the pre-smoke snapshot and unpause.
- Confirm `accountedAssets == underlying.balanceOf(proxy) + deployedAssets`.
- Confirm `pendingAccrual()` returns sensible target/funded values.
- Confirm `projectedExchangeRate() >= exchangeRate()` when funding is available.
- Confirm no `StrayAssetsRemoved` event occurred unexpectedly.
- Confirm distributor balance and allowance remain as expected.

If a direct donation creates:

```text
underlying.balanceOf(proxy) + deployedAssets > accountedAssets
```

the next protected state-changing call removes the excess to the distributor before pricing or accrual. Raw realized views such as `totalAssets()` and `exchangeRate()` can remain temporarily inflated until removal. Pending/projected accrual, ERC-4626 conversions and previews, and max-exit views reconcile the donation out.

## 8. Unpause and controlled production smoke test

1. Confirm the paused-state `SMOKE_USER` approval and pre-smoke snapshot were
   captured, then call `unpause()` and confirm governance execution.
2. If explicit accrual is part of operations, confirm only the owner can call it and that it succeeds only after unpausing.
3. Submit one small deposit from a controlled account.
4. Verify:
   - Correct shares were minted.
   - `accountedAssets == underlying.balanceOf(proxy) + deployedAssets`.
   - Existing users were not diluted.
5. Submit one small exit:
   - Use instant redeem if idle liquidity permits.
   - Otherwise verify the queue request and process/claim flow.
6. Recheck supply, queue, claims, idle, deployed assets, strategy debt, exchange rate, and distributor funding.

Do not proceed to normal operation until the controlled flow reconciles exactly.

For the deterministic testnet workflow, first fund actors through [`TESTNET_ACTOR_FUNDING_SEQUENCE.md`](./TESTNET_ACTOR_FUNDING_SEQUENCE.md), then seed through [`TESTNET_OLD_VAULT_SEED_SEQUENCE.md`](./TESTNET_OLD_VAULT_SEED_SEQUENCE.md). Verify the prefunded distributor and smoke user still have at least `30` and `10` underlying tokens respectively, keep the configured rate at `1e27`, and execute Phase 8 with the exact `10`-token smoke profile in the starting-state section of [`TESTNET_UPGRADE_E2E_SEQUENCE.md`](./TESTNET_UPGRADE_E2E_SEQUENCE.md).

Use `yield-vault:capture-runbook` for the initial, post-initialization, and
pre-smoke snapshots. The manual input must be `schemaVersion: 1`, type
`yield-vault-manual-upgrade-evidence`. Record every manual/governed
transaction, the separate paused-state smoke-user approval, and exactly four
economic smoke transactions (deposit, redeem-or-queue, process queue, claim),
then run `yield-vault:runbook-report`. The approval is not one of the four.
The validator accepts direct evidence only when the stored owner equals the
signer. With AdminRegistry ownership, all successful owner operations require
the exact creation/execution chain described above; stale, wrong-target,
wrong-function, or wrong-argument execution rows are rejected.
The smoke `processQueue` call emits three `QueueProcessed` rows. Record and
verify all three by exact global `id`/`event_index` and attributes, in event
order, including every emitted `sharesBurned` field.

The generator verifies this exact order: initial snapshot; pause;
implementation deployment submission/execution; pointer
submission/execution; successful `initializeAccrual`; failed repeated
`initializeAccrual`; post-initialization snapshot; distributor approval;
distributor selection; neutral rate; separate smoke-user approval; pre-smoke
snapshot; unpause; the four economic smoke transactions; final snapshot.
Governed execution points are included when present. It reads the final live
snapshot, verifies seed preservation, network identity,
deployment/upgrade/governance hashes, raw signers and calls, exact global
events, ordering, manual receipts, and smoke evidence, and writes a
`schemaVersion: 1`, type `yield-vault-safe-upgrade` report consumed by E2E. The
E2E script starts only after report validation succeeds.

## 9. Guarded rollback

Keep the old implementation address and the completed forward-upgrade evidence.
While the vault is paused, the YieldVault-local rollback changes only the proxy
pointer and rechecks the same owner, identity, and storage invariants:

```bash
cd mercata/contracts
npm run yield-vault:safe-upgrade -- \
  --rollback \
  --proxy-address <VAULT_PROXY> \
  --implementation-address <OLD_IMPLEMENTATION> \
  --expected-current-implementation <NEW_IMPLEMENTATION> \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-rollback-run-state.json \
  --evidence-output ./yield-vault-rollback-evidence.json
```

The rollback artifact is `schemaVersion: 1`, type `proxy-upgrade-evidence`,
mode `rollback`. It has no new source deployment and therefore no source hash;
it must contain a confirmed `rollback-pointer` operation, previous/restored
implementation addresses, pre/post snapshots, and governance evidence when
applicable. The old ABI comparison includes every legacy field and underlying
balance but excludes only appended accrual views that the old ABI cannot expose.
The artifact records their pre-rollback values and this limitation.

For local upgrade and rollback, re-run the identical command and paths after a
stop. `ready` may submit once; `submitted` reconciles the same transaction or
governance issue. `dispatching` recovers only an exact intended raw transaction
at the recorded signer account sequence, or replays once after bounded
confirmed/queued lookups plus unchanged sequence definitively prove absence.
Unresolved or mismatched evidence stops. The terminal
line is
`UPGRADE_SAFETY_STOP checkpoint=<id> reason=<reason> txHash=<hash-or-none>`.

Run the exact offline safety/report validations from `mercata/contracts`:

```bash
npm run yield-vault:test-upgrade-safety
npm run yield-vault:test-tooling
```
