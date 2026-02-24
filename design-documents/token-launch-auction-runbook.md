# Token Launch Auction — Operational Runbook

**Contract:** `mercata/contracts/concrete/Auction/TokenLaunchAuction.sol`
**Supporting Contracts:** `PoolLpSeeder.sol`, `LpTokenLockVault.sol`
**Last Updated:** February 2026

---

## Contract System Overview

| Contract | Purpose |
|---|---|
| `TokenLaunchAuction` | Core auction: bidding, finalization, distribution, TGE, unwind |
| `PoolLpSeeder` | Receives USDST + STRATO at TGE, adds liquidity to pool, forwards LP tokens |
| `LpTokenLockVault` | Holds LP tokens under 1-year cliff + 2-year linear vesting |

### External Dependencies

- **USDST token** — ERC20 payment token (bidders escrow USDST)
- **STRATO token** — sale token (must support `burn(address, uint256)` and transfer lock via `unpause()`)
- **AdminRegistry** — auction contract must be whitelisted for `transfer` and `burn` on STRATO
- **DEX Pool** — USDST/STRATO pool for LP seeding at TGE

---

## Phase 1: Pre-Deployment Setup

### 1.1 Deploy Contracts

Deploy in this order:

1. **LpTokenLockVault** — `constructor(ownerAddress)`
2. **PoolLpSeeder** — `constructor(ownerAddress)`
3. **TokenLaunchAuction** — `constructor(ownerAddress)`

### 1.2 AdminRegistry Whitelisting

**CRITICAL:** The auction contract address must be whitelisted in the AdminRegistry for:

- `transfer` on the STRATO token (required for distribution and LP seeding while token is paused)
- `burn` on the STRATO token (required for unsold/bonus burn and unwind)

Without whitelisting, distribution, burn, and unwind operations will revert while the token is paused (pre-TGE). The two functions use different AdminRegistry paths:
- **`transfer`**: gated by Token's `whenNotPausedOrOwner` modifier → checks `AdminRegistry.whitelist(token, msg.sig, msg.sender)` while paused.
- **`burn`**: gated by Token's `onlyOwner` modifier → falls through to `AdminRegistry.castVoteOnIssue()` for non-owners.

### 1.3 Initialize PoolLpSeeder

```
PoolLpSeeder.initialize(
    pool_,            // DEX pool address (USDST/STRATO)
    usdToken_,        // USDST address
    stratoToken_,     // STRATO address
    auction_          // TokenLaunchAuction address
)
```

### 1.4 Initialize TokenLaunchAuction

```
TokenLaunchAuction.initialize(
    usdToken_,                  // USDST contract address
    stratoToken_,               // STRATO contract address
    treasuryWallet_,            // treasury multisig
    reserveWallet_,             // reserve wallet
    lpSeeder_,                  // PoolLpSeeder address
    lpTokenLockVault_,          // LpTokenLockVault address
    transferLockController_,    // address with unpause() for STRATO transfer lock
    saleSupply_,                // total STRATO for sale (e.g. 2,000,000 * 10^18)
    claimTokenReserve_,         // STRATO reserved for participant distribution (>= saleSupply)
    lpTokenReserve_,            // STRATO reserved for LP seeding
    minRaiseUSDST_,             // minimum cleared proceeds for success
    maxRaiseUSDST_,             // max raise cap (0 = uncapped)
    priceTickUSDST_,            // price tick size (bids must be multiples)
    withdrawDelay_,             // seconds before canceled bid USDST can be withdrawn
    maxDistributionAttempts_,   // failed distribution attempts before vaulting
    bonusTokenReserve_,         // STRATO reserved for tier-1 bonus pool
    auctionDurationSeconds_,    // total auction duration (e.g. 604800 = 7 days)
    closeBufferSeconds_,        // close buffer freeze (e.g. 3600 = 1 hour)
    tier1WindowSeconds_,        // bonus tier window from start
    tier2WindowSeconds_,        // regular tier window after tier 1
    allowlistEnabled_,          // whether allowlist gating is active
    allowlistDurationSeconds_,  // how long allowlist restriction lasts
    lpBps_,                     // LP bucket % of raisedUSDST (e.g. 3000 = 30%)
    treasuryBps_,               // treasury % (e.g. 6000 = 60%)
    reserveBps_,                // reserve % (e.g. 1000 = 10%) — must sum to 10000
    preTgeWithdrawBps_,         // pre-TGE treasury withdrawal cap (0 = disabled)
    maxTgeDelay_                // seconds after finalize before resolution mode
)
```

**Validation:** `lpBps + treasuryBps + reserveBps` must equal 10000. `claimTokenReserve >= saleSupply`. `tier1WindowSeconds + tier2WindowSeconds <= auctionDurationSeconds - closeBufferSeconds`.

### 1.5 (Optional) Configure Allowlist

If `allowlistEnabled = true`:

```
TokenLaunchAuction.configureAllowlist(true, durationSeconds)
TokenLaunchAuction.updateAllowlist([addr1, addr2, ...], true)
```

Must be done before `startAuction()`.

### 1.6 (Optional) Update Config

Before the auction starts, any parameters can be changed via `updateConfig(...)` (same signature as `initialize`). Once `startAuction()` is called, parameters are immutable.

### 1.7 Escrow STRATO Tokens

Transfer STRATO to the auction contract:

```
stratoToken.transfer(auctionAddress, claimTokenReserve + lpTokenReserve + bonusTokenReserve)
```

`startAuction()` will verify:
```
stratoToken.balanceOf(this) >= claimTokenReserve + lpTokenReserve + bonusTokenReserve
```

---

## Phase 2: Auction Lifecycle

### 2.1 Start Auction

```
TokenLaunchAuction.startAuction()
```

Sets `startTime = now`, `endTime = startTime + auctionDurationSeconds`, `closeBufferStart = endTime - closeBufferSeconds`.

### 2.2 Bidding Window

**Timeline:**

```
|-- Tier 1 (bonus) --|-- Tier 2 (regular) --|-- Close Buffer (freeze) --|
0                  tier1End              tier2End                    endTime
```

- **Tier 1** (`0` → `tier1WindowSeconds`): Bonus-eligible bids. If allowlist enabled, first `allowlistDurationSeconds` are allowlist-only.
- **Tier 2** (`tier1WindowSeconds` → `tier1WindowSeconds + tier2WindowSeconds`): Regular bids, no bonus eligibility.
- **Close Buffer** (`closeBufferStart` → `endTime`): No new bids, no cancellations, no canceled-bid withdrawals.

**Bidder actions during bidding:**
- `placeBid(budgetUSDST, maxPriceUSDST)` — escrows USDST, records bid
- `cancelBid(bidId)` — cancels active bid (before close buffer only)
- `withdrawCanceled(bidId)` — withdraw canceled bid USDST (after `withdrawDelay`, not during close buffer)

**Admin actions during bidding:**
- `pauseBids()` / `unpauseBids()` — emergency pause on new bids only
- `cancelAuction()` — full cancel (before close buffer only)

### 2.3 Emergency: Cancel Auction

```
TokenLaunchAuction.cancelAuction()
```

Only callable before `closeBufferStart`. After cancel:
- Bidders call `withdrawAfterCancel(bidId)` to reclaim USDST (no delay enforced)
- Owner calls `recoverAfterFailure()` to reclaim escrowed STRATO

---

## Phase 3: Finalization

### 3.1 Finalize (Permissionless)

After `endTime`, anyone can call finalization. Two approaches:

**Simple (small auctions):**
```
TokenLaunchAuction.finalize()
```
Runs both price computation and all allocation stages in one call.

**Batched (large auctions):**
```
// Step 1: Compute clearing price
TokenLaunchAuction.finalizePrice()

// Step 2: Compute allocations in batches
TokenLaunchAuction.finalizeAllocationsBatch(500)  // repeat until done
TokenLaunchAuction.finalizeAllocationsBatch(500)
...
```

**Monitor progress:**
```
TokenLaunchAuction.finalizeProgress()
// Returns: (stage, cursor, totalBids, done)
```

### 3.2 Allocation Stages (Internal)

The batched finalization runs through 6 stages:

| Stage | Purpose |
|---|---|
| 0 | Count demand above vs at clearing price |
| 1 | Compute `tokensUncapped` per bid + `raisedUncappedUSDST` |
| 2 | Apply `maxRaiseUSDST` cap → `tokensCapped`, `spentUSDST`, `refundUSDST` |
| 3 | Transition bids to FINALIZED, handle success/failure paths |
| 4 | Accumulate bonus-eligible demand (tier-1 bids) |
| 5 | Allocate bonus tokens pro-rata, compute USDST buckets, finalize |

**Edge case:** If `clearingPrice == 0` (all budget zeroed despite active bid count), initialization skips stages 0-2 (which divide by price) and enters directly at stage 3 to finalize all ACTIVE bids with full refunds. This avoids an O(N) single-tx loop.

### 3.3 Finalization Outcomes

**Success** (`raisedUSDST >= minRaiseUSDST`):
- `success = true`, `finalized = true`
- Per-bid: `tokensCapped`, `spentUSDST`, `refundUSDST`, `bonusTokens` recorded
- USDST buckets computed: `lpUSDST`, `treasuryUSDST`, `reserveUSDST`

**Failure** (`raisedUSDST < minRaiseUSDST`):
- `success = false`, `finalized = true`
- All ACTIVE bids → FINALIZED with `refundUSDST = budgetUSDST`
- No token distribution

### 3.4 Admin Recovery: Restart Allocations

If batched finalization gets stuck (e.g., proxy upgrade mid-finalization):

```
TokenLaunchAuction.restartFinalizeAllocations()
```

Resets allocation stages and reverts any FINALIZED bids back to ACTIVE for replay. Only works when `priceFinalized = true` and `finalized = false`.

### 3.5 Admin Recovery: Rebuild Price Buckets

After proxy upgrade if bucket state is corrupted:

```
TokenLaunchAuction.rebuildActivePriceBuckets(0, 500, true)   // first batch, reset=true
TokenLaunchAuction.rebuildActivePriceBuckets(500, 500, false) // subsequent batches
```

---

## Phase 4: Distribution (Success Path)

### 4.1 Distribute Tokens

After successful finalization, distribute STRATO to winners. Tokens are non-transferable until TGE.

**By specific bid IDs:**
```
TokenLaunchAuction.distributeBatch([0, 1, 2, 3, ...])
```

**Sequential from cursor:**
```
TokenLaunchAuction.distributeNext(100)  // repeat until all distributed
```

**Retry a single skipped/failed bid:**
```
TokenLaunchAuction.retryDistributeBid(bidId)
```

Use when `distributeNext` has advanced the cursor past a failing bid, or `distributeBatch` skipped it. Same attempt-count rules apply.

**Find stranded bids (view):**
```
TokenLaunchAuction.nextUndistributedFrom(0, 1000)
// Returns: (bidId, found) — scans up to maxScan bids from start
```

**Distribution behavior:**
- Transfers `tokensCapped + bonusTokens` to each bidder
- All three functions (`distributeBatch`, `distributeNext`, `retryDistributeBid`) delegate to a single internal `_attemptDistribute()` helper — logic cannot diverge.
- Both batch functions are permissionless — anyone can call to help distribute
- On transfer failure:
  - **Bidder / owner caller:** increments attempt counter, emits `DistributionFailed`, breaks on retryable failure so next call retries the same bid. After `maxDistributionAttempts`, tokens are vaulted.
  - **Third-party caller:** does NOT increment attempts (prevents griefing), does NOT emit `DistributionFailed` (reduces noise). `distributeNext` skips the failing bid and continues to the next; `distributeBatch` continues to the next bid ID in the array.
- Vaulted tokens can be claimed later via `withdrawVaultedImmediate(bidId)`

### 4.2 Burn Unsold Tokens

After distribution (or anytime after finalization on success):

```
TokenLaunchAuction.burnUnsold()
```

Burns `unsoldTokens` from `claimReserveRemaining`.

### 4.3 Burn Remaining Bonus

After all distributions complete (`pendingDistributions == 0`):

```
TokenLaunchAuction.burnRemainingBonus()
```

Burns any remaining `bonusTokenReserveRemaining` (rounding dust or unused if no tier-1 winners).

---

## Phase 5: Refund Withdrawals

### 5.1 Finalized Refunds

Available immediately after finalization (both success and failure):

```
// Bidder calls:
TokenLaunchAuction.withdrawRefund(bidId)
```

Transfers `bid.refundUSDST` to bidder. Available regardless of TGE timing.

### 5.2 Canceled Bid Refunds

```
// Before auction cancel:
TokenLaunchAuction.withdrawCanceled(bidId)   // requires withdrawDelay elapsed

// After auction cancel:
TokenLaunchAuction.withdrawAfterCancel(bidId) // no delay
```

---

## Phase 6: TGE Execution (Success Path)

### 6.1 Schedule TGE

```
TokenLaunchAuction.setTgeTime(tgeTimestamp)
```

Can be called/updated multiple times before execution. Must be set before executing.

### 6.2 Pre-TGE Treasury Withdrawal (Optional)

If `preTgeWithdrawBps > 0`:

```
TokenLaunchAuction.withdrawTreasuryPreTge(amount)
```

Capped at `treasuryUSDST * preTgeWithdrawBps / 10000`. Deducted from treasury bucket at TGE.

### 6.3 Execute TGE

**Prerequisites checklist:**
- [ ] `finalized = true` and `success = true`
- [ ] `pendingDistributions == 0` (all bids distributed or vaulted)
- [ ] `tgeTime` is set and `block.timestamp >= tgeTime`
- [ ] `lpTokenReserve >= lpStratoRequired` (checked automatically)
- [ ] PoolLpSeeder is initialized with correct pool
- [ ] LpTokenLockVault deployed

```
TokenLaunchAuction.executeTGE()
```

**What happens:**
1. Computes `lpStratoRequired = ceil(lpUSDST * tokenUnit / clearingPrice)`
2. Transfers `lpUSDST` (USDST) + `lpStratoRequired` (STRATO) to PoolLpSeeder
3. PoolLpSeeder adds liquidity to DEX pool, mints LP tokens
4. LP tokens forwarded to LpTokenLockVault (1y cliff + 2y vest)
5. Unpauses STRATO transfer lock via `transferLockController.unpause()`
6. Transfers `treasuryUSDST - preTgeWithdrawn` to treasury wallet
7. Transfers `reserveUSDST` to reserve wallet
8. Sets `tgeExecuted = true` (**last**, after all external calls succeed — prevents partial TGE if governance execution swallows a revert)

---

## Phase 7: Post-TGE

### 7.1 LP Token Vesting

LP tokens vest in the `LpTokenLockVault`:
- **Cliff:** 1 year from TGE
- **Vesting:** Linear over 2 years from TGE (1 year locked, then 1 year linear release)

```
LpTokenLockVault.releasable()  // check available
LpTokenLockVault.release()     // release to beneficiary (treasuryWallet)
```

### 7.2 Vaulted Token Claims

Bidders whose distribution was vaulted can self-claim:

```
TokenLaunchAuction.withdrawVaultedImmediate(bidId)
```

---

## Phase 8: Resolution Mode & Unwind

### 8.1 Resolution Mode

Triggered automatically when `block.timestamp > finalizeTime + maxTgeDelay`:

```
TokenLaunchAuction.inResolutionMode()  // returns true
```

In resolution mode, owner can either:
- Execute TGE normally, or
- Initiate unwind

### 8.2 Unwind Flow

If TGE cannot proceed:

```
// Step 1: Initiate unwind
TokenLaunchAuction.unwind()

// Step 2: Batch burn distributed tokens from bidders
TokenLaunchAuction.unwindBatch(500)   // repeat until cursor >= bids.length
TokenLaunchAuction.unwindBatch(500)
...

// Step 3: Finalize unwind
TokenLaunchAuction.finalizeUnwind()
```

**What unwind does:**
- Burns distributed STRATO from bidder addresses
- Zeros vaulted balances (with guarded subtract on `totalVaultedBaseTokens` — clamps to 0 if counter drifted, so unwind is never blocked by summary-counter drift)
- Burns remaining claim + bonus reserves
- Computes pro-rata USDST pool from remaining funds (excluding refunds)

```
// Step 4: Bidders withdraw pro-rata USDST
TokenLaunchAuction.withdrawUnwound(bidId)

// Step 5: Owner reclaims LP reserve STRATO
TokenLaunchAuction.reclaimLpReserve()
```

**Notes:**
- `unwindBatch` calls `stratoToken.burn(bidder, amount)` which requires the auction contract to be whitelisted in AdminRegistry for the `burn` function.
- If a burn fails (e.g. bidder moved tokens away due to an early unpause or whitelist mistake), the batch **does not stall** — the failure is caught via try/catch, `UnwindBurnFailed(bidId, bidder, amount)` is emitted, and the cursor advances. However, `bid.tokensDistributed` is **not** zeroed, which blocks `withdrawUnwound()` for that bid (prevents double-payout of tokens + USDST). Once the issue is resolved (e.g. bidder returns tokens), call `retryUnwindBurn(bidId)` to complete the burn and unblock the USDST claim. On success, `UnwindBurnRetried(bidId, bidder, amount)` is emitted.

---

## Phase 9: Failed Auction Recovery

After finalization with `success = false`:

```
// Bidders withdraw full refunds:
TokenLaunchAuction.withdrawRefund(bidId)

// Owner recovers escrowed STRATO:
TokenLaunchAuction.recoverAfterFailure()
```

Transfers entire STRATO balance to treasury. Safe because no tokens are allocated on failure.

---

## State Machine Summary

```
                    ┌─ cancelAuction() ──► CANCELED
                    │                        │
UNINITIALIZED       │                        ▼
    │               │               withdrawAfterCancel()
    ▼               │               recoverAfterFailure()
 initialize()       │
    │               │
    ▼               │
INITIALIZED ─► startAuction() ─► BIDDING ─► CLOSE BUFFER ─► endTime
    │                                                          │
    │  updateConfig()                              finalizePrice()
    │  configureAllowlist()                                    │
    │  updateAllowlist()                                       ▼
    │                                                   PRICE FINALIZED
                                                               │
                                                 finalizeAllocations[Batch]()
                                                               │
                                                               ▼
                                                          FINALIZED
                                                         /         \
                                                   success?      !success
                                                   /                 \
                                          distributeBatch()     withdrawRefund()
                                          distributeNext()      recoverAfterFailure()
                                          retryDistributeBid()
                                          burnUnsold()
                                          burnRemainingBonus()
                                          withdrawRefund()
                                                   │
                                              setTgeTime()
                                                   │
                                              executeTGE()
                                                   │
                                                   ▼
                                              TGE COMPLETE
                                              
                      ── OR (resolution mode) ──
                      
                                          unwind()
                                          unwindBatch()
                                          finalizeUnwind()
                                          withdrawUnwound()
                                          reclaimLpReserve()
```

---

## Key Invariants

1. **No ACTIVE bids at finalization:** `_assertNoActiveBids()` (O(1) via `activeBidCount`) is called before `finalized = true` in all paths. Diagnostic tools: `verifyNoActiveBids()` (returns first ACTIVE bid) and `assertNoActiveBidsSlow()` (reverts on first ACTIVE bid, O(N) — for testing/dry-runs).
2. **Atomic execution:** STRATO's token contracts (USDST, STRATO) use plain ERC20 balance updates with no transfer hooks or callbacks. All external calls either fully commit or revert — no mid-execution re-entry is possible.
3. **Token-first accounting:** Allocations are computed in STRATO units first, then converted to USDST spend. Bidders never pay for undelivered fractional tokens.
4. **Escrow integrity:** `claimReserveRemaining` and `bonusTokenReserveRemaining` are decremented on every distribution. Burns check reserve sufficiency. `totalVaultedBaseTokens` tracks base-only vaulted obligations (excludes bonus) and is used by `_requiredClaimReserve()` to gate `burnUnsold()`.
5. **Bucket immutability:** `lpUSDST`, `treasuryUSDST`, `reserveUSDST` are computed once at finalization and never modified.
6. **Griefing protection:** Only bidder or owner can increment distribution attempt counters. `DistributionFailed` is only emitted for bidder/owner callers (not third-party helpers).

---

## Monitoring Checklist

| Metric | Where | Alert Condition |
|---|---|---|
| `activeBidCount` | Contract state | Diverges from `verifyNoActiveBids()` scan |
| `totalVaultedBaseTokens` | Contract state | Diverges from `computeTotalVaultedBaseTokensSlow()` |
| `pendingDistributions` | Contract state | Stuck > 0 after distribution attempts |
| `totalRefundsRemaining` | Contract state | Non-zero long after finalization |
| `claimReserveRemaining` | Contract state | Drops below expected |
| `escrowHealth()` | Contract view | `balance < trackedReserves` |
| `vaultedBaseObligations()` | Contract view | Non-zero when unexpected |
| `nextUndistributedFrom(0, N)` | Contract view | Returns `found = true` after distribution "complete" |
| `finalized` | Contract state | Not set within reasonable time after `endTime` |
| `inResolutionMode()` | Contract view | True without planned action |
| `finalizeProgress()` | Contract view | Stuck on same stage/cursor |

---

## Emergency Procedures

| Scenario | Action |
|---|---|
| Bug discovered during bidding | `pauseBids()` → investigate → `unpauseBids()` or `cancelAuction()` |
| Finalization stuck | `restartFinalizeAllocations()` then re-run `finalizeAllocationsBatch()` |
| Price buckets corrupted after upgrade | `rebuildActivePriceBuckets()` in batches |
| `activeBidCount` drift suspected | `verifyNoActiveBids()` to diagnose; `assertNoActiveBidsSlow()` in dry-run; `rebuildActivePriceBuckets()` to reconcile |
| `totalVaultedBaseTokens` drift suspected | `computeTotalVaultedBaseTokensSlow()` to diagnose; compare with `totalVaultedBaseTokens` state variable |
| Distribution failures | Retry via `retryDistributeBid(bidId)` or `distributeBatch([bidId])`; use `nextUndistributedFrom()` to find stranded bids; after max attempts, tokens are vaulted for bidder self-claim |
| TGE cannot proceed | Wait for resolution mode → `unwind()` → `unwindBatch()` → `finalizeUnwind()` |
| Failed auction | Bidders `withdrawRefund()`, owner `recoverAfterFailure()` |

---

## Test-Only Functions

**`resetForTesting()`** — Resets all auction state. Testnet only; will be removed for production deployment.
