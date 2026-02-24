# Token Launch Auction (STRATO)
## Decision Memo & Design Spec

**Status:** Implemented
**Last Updated:** February 2026
**Related:** [Operational Runbook](./token-launch-auction-runbook.md)
**Superseded:** [Early Design Exploration](./token-launch-auction-implementation.md) (historical; does not reflect the implemented contract)

---

## Quick Reference + Definitions

### Overview

- **Mechanism:** Uniform Clearing Price (P*) + Bonus Token Pool for early bidders
- **Duration:** Configurable (default 7 days, UTC)
- **Payment token:** USDST (auto-mints from bridged USDC/USDT)
- **Fairness:** All winners pay the same final price P*
- **Early advantage:** Tier-1 bidders receive pro-rata share of a bonus token reserve in addition to their base allocation
- **Close buffer:** Configurable (default last 1 hour) = bid-book freeze
- **TGE timing:** TGE occurs after finalization (typically days-weeks later; can be longer if required by launch ops)
- **Token distribution:** On success, STRATO is transferred from escrow to winners via batched push-based distribution after finalization (no user claim step). Tokens are non-transferable until TGE.
- **Transferability:** STRATO transfers are enabled at TGE via transfer lock controller

### Core Parameters (Configurable)

- **Sale supply (`saleSupply`):** Total STRATO tokens available for sale (e.g., 2,000,000 STRATO)
- **Claim token reserve (`claimTokenReserve`):** STRATO escrow for participant base allocations (must be >= `saleSupply`)
- **LP token reserve (`lpTokenReserve`):** STRATO escrow for LP seeding at TGE (token-side liquidity, denominated in STRATO, not LP receipt tokens)
- **Bonus token reserve (`bonusTokenReserve`):** STRATO escrow for tier-1 bonus pool (distributed pro-rata to tier-1 winners)
- **Min raise (`minRaiseUSDST`):** Minimum cleared proceeds required for success
- **Max raise (`maxRaiseUSDST`):** Cap on cleared proceeds (0 = uncapped). If binding, applies a uniform pro-rata haircut to all clearing bids at P* (price stays fixed)
- **Price tick size (`priceTickUSDST`):** `maxPrice` MUST be an integer multiple of `priceTickUSDST`
- **Canceled withdrawal delay (`withdrawDelay`):** Minimum delay after cancel before `withdrawCanceled()` is allowed
- **Max distribution attempts (`maxDistributionAttempts`):** Failed transfer attempts before bid tokens are vaulted for self-claim
- **Auction duration (`auctionDurationSeconds`):** Total auction length
- **Close buffer (`closeBufferSeconds`):** Freeze period at end of auction
- **Tier 1 window (`tier1WindowSeconds`):** Bonus-eligible bidding window from start
- **Tier 2 window (`tier2WindowSeconds`):** Regular bidding window after tier 1
- **LP / Treasury / Reserve BPS (`lpBps`, `treasuryBps`, `reserveBps`):** Percentage split of `raisedUSDST` (must sum to 10000)
- **Pre-TGE treasury withdrawal BPS (`preTgeWithdrawBps`):** Pre-TGE treasury withdrawal cap (0 = disabled)
- **Max TGE delay (`maxTgeDelay`):** Seconds after finalization before resolution mode triggers

### Price + Proceeds Definitions

- **Clearing price (P*):** The single uniform price computed at finalization
- **Uncapped proceeds (`raisedUncappedUSDST`):** Proceeds that would clear at P* without applying `maxRaiseUSDST`
- **Cleared proceeds (`raisedUSDST`):** Total USDST actually accepted as proceeds at P* after any max-raise haircut
- `raisedUSDST = sum(spentCapped_i)` (accumulated per-bid, not computed from aggregate formula, to avoid rounding mismatch)
- **Used for:** `minRaiseUSDST` success check + bucket sizing

### LP + Treasury/Reserve Buckets (Computed at Finalization)

- **LP USDST bucket (`lpUSDST`):** `raisedUSDST * lpBps / 10000`
- **Treasury USDST bucket (`treasuryUSDST`):** `raisedUSDST * treasuryBps / 10000`
- **Reserve USDST bucket (`reserveUSDST`):** `raisedUSDST * reserveBps / 10000`
- Rounding dust is added to the treasury bucket

### Token Escrow Definitions (Must be deposited before `startAuction()`)

- **Participant token escrow (`claimTokenReserve`):** STRATO escrow reserved for participant base allocations
- **LP token escrow (`lpTokenReserve`):** STRATO escrow reserved specifically for LP seeding at TGE
- **Bonus token escrow (`bonusTokenReserve`):** STRATO escrow reserved for tier-1 bonus pool distribution

### Total escrow check (mechanical)

`STRATO.balanceOf(auctionContract) >= claimTokenReserve + lpTokenReserve + bonusTokenReserve`

### Timepoints / Key Events

- **Auction start (`startTime`):** When bidding opens (set by `startAuction()`)
- **Auction end (`endTime`):** `startTime + auctionDurationSeconds`
- **Close buffer start (`closeBufferStart`):** `endTime - closeBufferSeconds`
- **Finalization:** Permissionless (callable by anyone) at/after `endTime`. Two-phase:
  - Phase 1 (`finalizePrice()`): Computes clearing price P*
  - Phase 2 (`finalizeAllocationsBatch(n)`): Computes allocations, refunds, and bonus tokens in batched stages
  - Or combined: `finalize()` runs both phases in one call (suitable for small auctions)
- **TGE time (`tgeTime`):** Governance-set timestamp. Can be rescheduled before `executeTGE()` without affecting finalized outcomes

### Access Control Prerequisites

**CRITICAL:** The auction contract must be whitelisted in the **AdminRegistry** for both `transfer` and `burn` functions on the STRATO token. The two functions use different AdminRegistry paths:
- **`transfer`**: gated by Token's `whenNotPausedOrOwner` modifier — while paused, non-owner callers are checked via `AdminRegistry.whitelist(token, msg.sig, msg.sender)`.
- **`burn`**: gated by Token's `onlyOwner` modifier — falls through to `AdminRegistry.castVoteOnIssue()` for non-owners.

Without whitelisting, distribution, burn, and unwind operations will revert while the token is paused (pre-TGE).

---

## 1. Decision (Implemented Approach)

### Uniform Clearing Price + Bonus Token Pool

A configurable on-chain auction on STRATO where participants submit `(budget, maxPrice)` bids in USDST. The auction finalizes to compute a single clearing price P*; all winners pay P*. Early participation is rewarded via a **bonus token pool** — tier-1 bidders receive pro-rata bonus STRATO from a separate reserve, in addition to their base allocation at P*.

### TGE

TGE (Token Generation Event) is the on-chain transition that:

- enables STRATO transfers (removes transfer lock via `unpause()`)
- seeds LP at P* using reserved USDST + STRATO
- locks LP tokens in a vesting vault (1-year cliff + 2-year total)
- routes treasury and reserve USDST to designated wallets

TGE occurs after auction finalization and distribution completion.

### Token delivery guarantee (hard requirement)

Before `startAuction()`, the launch contract MUST hold sufficient STRATO escrow for:

- participant base distribution (`claimTokenReserve`)
- LP seeding (`lpTokenReserve`)
- bonus pool distribution (`bonusTokenReserve`)

These reserves are non-overlapping and must be tracked separately.

### Preflight / escrow gates

`startAuction()` MUST revert unless all three reserves are escrowed.

Mechanical check (normative):

`STRATO.balanceOf(auctionContract) >= claimTokenReserve + lpTokenReserve + bonusTokenReserve`

### Timeline (high level)

- Hour 0: auction starts
- `startTime` to `startTime + tier1WindowSeconds`: Tier 1 (bonus-eligible) bidding
- `tier1End` to `tier1End + tier2WindowSeconds`: Tier 2 (regular) bidding
- `closeBufferStart`: bid-book freeze
- `endTime`: auction ends
- Finalization (t >= `endTime`): anyone may call `finalizePrice()` then `finalizeAllocationsBatch(n)` (permissionless). Computes P*, allocations, refunds, bonus tokens, and USDST buckets.
- Distribution: `distributeBatch()` / `distributeNext()` transfers STRATO to winners (permissionless, batched)
- Burns: `burnUnsold()` and `burnRemainingBonus()` clean up excess tokens
- TGE (later): governance executes TGE to enable transfers, seed LP, and route funds

### Refund timing (clarified)

- **Success:** only unspent USDST (`refundUSDST`) is withdrawable after finalization (losers, partial fills, and max-raise haircuts). `raisedUSDST` is bucketed at finalization and routed at TGE.
- **Failure (no graduation):** all bid USDST is withdrawable after finalization, and no participant STRATO distribution occurs. Owner calls `recoverAfterFailure()` to reclaim escrowed STRATO.

### Why this fits STRATO

- Fair price discovery with one price P*
- Early incentive via bonus token pool (not price advantage)
- Simple UX: bridge → USDST → bid
- Push-based distribution (no user claim step)
- Audit-friendly: deterministic batched finalization + pull-based refund withdrawals
- No reentrancy risk: STRATO tokens use plain ERC20 balance updates (no transfer hooks/callbacks)

---

## 2. Auction Parameters (For Approval)

### Core parameters (defaults; configurable per launch)

- **Duration:** 7 days (configurable via `auctionDurationSeconds`)
- **Payment token:** USDST only
- **Sale supply (S):** e.g., 2M STRATO tokens
- **Claim token reserve:** >= sale supply
- **LP token reserve:** separate STRATO reserve for LP
- **Bonus token reserve:** separate STRATO reserve for tier-1 bonus pool
- **`minRaiseUSDST`:** e.g., 10M USDST
- **`maxRaiseUSDST`:** e.g., 50M USDST (0 = uncapped)
- **Close buffer:** configurable (default 1 hour)
- **Price tick:** configurable (e.g., 0.01 USDST increments)
- **Unsold tokens policy:** burn via `burnUnsold()`

### Bid state definitions (normative)

- **NULL:** initial / unset
- **ACTIVE:** submitted, not canceled; counts toward demand
- **CANCELED:** canceled pre-close-buffer; principal withdrawable at `cancelTime + withdrawDelay` via `withdrawCanceled()` (not during close buffer)
- **FINALIZED:** settlement recorded at finalization; refund withdrawable, tokens distributed

### Parameter immutability

After `startAuction()`, all settlement-critical parameters are immutable. `updateConfig()` is only callable before the auction starts.

### Tiered bidding windows (early participation advantage)

- **Tier 1 (Bonus Tier):** `startTime` to `startTime + tier1WindowSeconds`
  - Bids placed in this window are eligible for pro-rata bonus tokens from `bonusTokenReserve`
  - 100% of base allocation is distributed immediately (no vesting)
  - Plus pro-rata share of bonus pool: `bonusTokens_i = bonusTokenReserve * tokensCapped_i / totalBonusDemand`
- **Tier 2 (Regular):** `tier1End` to `tier1End + tier2WindowSeconds`
  - Standard allocation at P*, no bonus eligibility
  - 100% of base allocation is distributed immediately

Both tiers pay the same clearing price P*. The bonus pool is the sole early-participation advantage.

Bidding is rejected outside tier windows (tier 0 returns from `_tierForTimestamp`).

---

## 3. Optional Early Access Controls (Do not affect P*)

- **Allowlist window:** configurable duration within tier-1 window (`allowlistDurationSeconds <= tier1WindowSeconds`). If enabled, only allowlisted addresses may bid during this period.
  - Configured via `configureAllowlist()` and `updateAllowlist()` before `startAuction()`

**Scope:** these controls only gate bidding eligibility during the window; refund withdrawals and distribution are always permissionless for eligible participants.

---

## 4. Participant Experience (User Journey)

1. Bridge USDC/USDT → USDST auto-mints
2. Submit bids: budget + max price (multiple bids allowed per address; each bid is independent)
3. Optional: view indicative price (UI estimate only)
4. Close buffer: bid-book freezes
5. After `endTime`, anyone can trigger finalization (permissionless)
6. Withdraw settlement refunds immediately after finalization (if any) via `withdrawRefund(bidId)`
7. After successful finalization: STRATO is distributed to winners via `distributeBatch()` / `distributeNext()` (permissionless, push-based, no user action required). Tokens are non-transferable until TGE.
8. If distribution fails after `maxDistributionAttempts`, tokens are vaulted and the bidder can self-claim via `withdrawVaultedImmediate(bidId)`
9. At TGE: STRATO becomes transferable; trading enabled at/shortly after

**Bid changes:** no in-place modify; must cancel + re-submit.

**Cancel rules:** cancellation allowed only before close buffer. Withdrawal of canceled bid USDST requires `withdrawDelay` to elapse.

---

## 5. Price Discovery & Allocation

### 5.1 Bid Model (per bid)

Each bid is a pair `(budgetUSDST, maxPriceUSDST)` where:

- `budgetUSDST` is the maximum USDST the bidder is willing to spend.
- `maxPriceUSDST` is the highest price per STRATO the bidder is willing to pay.

Price tick rule (normative):

`maxPriceUSDST` MUST be an integer multiple of `priceTickUSDST`.

### 5.2 Clearing Price (P*)

The auction produces a single uniform clearing price P* at finalization.

Discrete price grid (normative):

P* is chosen from the set of active price levels (all on-tick by construction).

Implementation:

1. Filter `activePriceLevels` to those with non-zero `activeBudgetByPrice` (budget remaining after cancellations).
2. Sort filtered levels in descending order.
3. Accumulate budgets top-down. P* is the **highest** price level where cumulative demand (tokens = budget / price) >= sale supply.
4. If no level clears, the auction is undersubscribed: P* = lowest active price level, and `demandClearsSupply = false`.
5. If no active price levels exist at all (all budget zeroed), returns 0 — treated as a failed auction.

Note: tick alignment is enforced in `placeBid()`, so all levels are already on-tick. The per-tick budget tracking avoids sorting individual bids.

### 5.3 Settlement Rules at P*

At finalization, each ACTIVE bid settles against P* as follows:

- **If `maxPriceUSDST < P*` (when `demandClearsSupply`):**
  - Does not clear → `tokensAllocated = 0` and `refundUSDST = budgetUSDST`.
- **If `maxPriceUSDST > P*`:**
  - Clears (non-marginal) → eligible for full fill at P*, subject to supply pro-rata if strict-above demand exceeds supply.
- **If `maxPriceUSDST == P*` (when `demandClearsSupply`):**
  - Clears at the margin → receives a pro-rata allocation from remaining supply after allocating all strict-above bids.
- **Undersubscribed (`!demandClearsSupply`):**
  - All bids at or above P* receive their full budget-derived tokens at P*.

Rounding safety (normative):

If strict-above demand alone exceeds supply due to rounding, a uniform pro-rata scale is applied to the strict-above group and the at-P* group receives zero.

### 5.4 Token-First Accounting (prevents "paid but not received")

All allocations are computed in STRATO units first, then converted to USDST spend.

For each bid `i` at price P*:

1. `tokensUncapped_i = floor(budgetUSDST_i * tokenUnit / P*)` — supply-prorated as needed.
2. `spentUncapped_i = tokensUncapped_i * P* / tokenUnit` — derived from token allocation.
3. `refundUncapped_i = budgetUSDST_i - spentUncapped_i`.

Rounding rule (normative):

- Token allocations round down to token precision.
- USDST spend is derived from delivered tokens: `spent = tokens * P* / tokenUnit`.
- Any remainder stays with the participant as `refundUSDST`.

### 5.5 Max Raise Enforcement (uniform pro-rata haircut at P*)

If `maxRaiseUSDST > 0`, the auction enforces it without changing P*.

Compute uncapped total proceeds at P*:

`raisedUncappedUSDST = sum_i spentUncapped_i`

If `raisedUncappedUSDST <= maxRaiseUSDST`:

- No haircut; proceed with `tokensCapped_i = tokensUncapped_i`.

If `raisedUncappedUSDST > maxRaiseUSDST`:

Apply a uniform scale factor to all clearing bids in token units:

`tokensCapped_i = floor(tokensUncapped_i * maxRaiseUSDST / raisedUncappedUSDST)`

Safety cap: `tokensCapped_i` is also clamped to `floor(budgetUSDST_i * tokenUnit / P*)` to ensure no bid spends more than its budget.

Then:

- `spentCapped_i = tokensCapped_i * P* / tokenUnit`
- `refundUSDST_i = budgetUSDST_i - spentCapped_i`

Define:

`raisedUSDST = sum_i spentCapped_i` (accumulated per-bid, not from aggregate formula)

This is the cleared proceeds used for `minRaiseUSDST` and bucketing.

### 5.6 Under-Subscription (Demand < Supply)

If total demand at P* is less than S, the auction sells only what demand supports:

- All eligible bids at or above P* receive their full budget-derived tokens (no pro-rata needed).
- `unsoldTokens = S - totalAllocated` follows the Unsold Tokens policy (Section 8).

### 5.7 Outputs Recorded at Finalization (immutable)

Finalization records per bid:

- `tokensCapped` (base STRATO allocation)
- `bonusTokens` (tier-1 bonus allocation, if applicable)
- `spentUSDST` (actual USDST accepted)
- `refundUSDST` (withdrawable)
- `tier` (1 or 2, determined by bid timestamp)

And globally:

- P* (`clearingPrice`)
- `raisedUSDST` (post-cap, used for `minRaiseUSDST` and bucketing)
- `unsoldTokens` (if any)
- `totalAllocated`
- `lpUSDST`, `treasuryUSDST`, `reserveUSDST` (USDST buckets)

All settlement outputs are immutable after finalization.

---

## 6. Close Buffer

Start: `closeBufferStart = endTime - closeBufferSeconds`

During the close buffer, the bid book is frozen:

- MUST NOT allow new bids
- MUST NOT allow cancellations
- MUST NOT allow `withdrawCanceled()` (even if `withdrawDelay` has elapsed)

Finalization: callable only at/after `endTime` and MUST NOT be callable during the close buffer.

Freeze applies only to bid-book mutations; read-only views are allowed.

---

## 7. Distribution, Refunds, & Bonus Tokens

### What participants receive (successful auction)

After a successful auction, each participant may have:

- `refundUSDST` — refundable USDST from losing bids, partial fills, and/or max-raise haircut (withdrawable after finalization)
- `tokensCapped` — base STRATO allocation distributed from `claimTokenReserve`
- `bonusTokens` — additional STRATO from bonus pool (tier-1 bids only) distributed from `bonusTokenReserve`

All participant allocations and refunds are determined at finalization and are immutable thereafter.

### Allocation vs distribution (normative)

**Allocation** is the immutable accounting outcome recorded at finalization: `tokensCapped`, `bonusTokens`, `spentUSDST`, `refundUSDST`.

**Distribution** is the push-based transfer of `tokensCapped + bonusTokens` STRATO to each winning bidder. Distribution is a separate step from finalization.

No user token claim step exists for successful distribution.

### Batch distribution (normative, for gas safety)

Distribution is completed using permissionless batch calls after finalization:

- `distributeBatch(uint[] bidIds)` — distribute specific bids by ID
- `distributeNext(uint maxCount)` — distribute sequentially from a cursor
- `retryDistributeBid(uint bidId)` — retry a single skipped/failed bid (for bids the cursor has passed)

All three functions delegate to a single internal `_attemptDistribute()` helper — logic cannot diverge. Each transfers `tokensCapped + bonusTokens` to the bidder.

Distribution completion gate (normative):

If distribution cannot complete for a bid after `maxDistributionAttempts` failed transfer attempts:

- The bid's tokens are **vaulted** (`distributionVaulted = true`)
- Vaulted amounts are recorded in `vaultedImmediate` and `vaultedBonusTokens`
- The bidder can self-claim later via `withdrawVaultedImmediate(bidId)`
- The bid is marked `distributed = true` for distribution-completion tracking

`executeTGE()` MUST revert unless `pendingDistributions == 0`.

**Griefing protection:** Only the bidder or contract owner can increment `distributionAttempts`. Third-party callers whose transfer fails do not advance the attempt counter, preventing forced vaulting. `DistributionFailed` is only emitted for bidder/owner callers (not third-party helpers) to reduce event noise.

**Third-party progress:** `distributeNext` allows third-party callers to skip failing bids and continue to subsequent bids (cursor advances). `distributeBatch` processes explicit bid IDs and naturally skips failures. This ensures anyone-can-help distribution doesn't stall on a single temporarily failing bid. Skipped bids can be retried via `retryDistributeBid(bidId)`. The view helper `nextUndistributedFrom(start, maxScan)` lets ops find stranded bids without off-chain scanning.

### Bonus token pool

Tier-1 bidders (bids placed during `tier1WindowSeconds`) share the `bonusTokenReserve` pro-rata based on their base allocation:

`bonusTokens_i = bonusTokenReserve * tokensCapped_i / totalBonusDemand`

Where `totalBonusDemand = sum(tokensCapped_j)` for all tier-1 FINALIZED bids with `tokensCapped > 0`.

Remaining bonus tokens (rounding dust or unused if no tier-1 winners) are burned via `burnRemainingBonus()` after all distributions complete.

### Refunds vs proceeds (pre-TGE)

- Settlement refunds (`refundUSDST`): withdrawable after finalization via `withdrawRefund(bidId)`
- Cleared proceeds (`raisedUSDST`): not refundable on success; held in immutable buckets and routed at TGE (or returned via unwind if applicable)

### Before TGE (what is available)

Before TGE:

- participants may have already received STRATO (base + bonus), but transfers are disabled (transfer-locked)
- participants may withdraw any `refundUSDST` that exists

### Optional pre-TGE treasury usage (default off)

If `preTgeWithdrawBps > 0` at initialization:

- `withdrawTreasuryPreTge(amount)` allows bounded withdrawal from treasury bucket
- Capped at `treasuryUSDST * preTgeWithdrawBps / 10000`
- Recipient fixed at deployment (`treasuryWallet`)
- MUST NOT touch LP or reserve buckets

### Withdrawals are pull-based (refunds only)

- USDST refunds: participant-initiated withdrawal after finalization
- Vaulted STRATO: participant-initiated withdrawal after vaulting

---

## 8. Graduation, Refunds, & Unsold Tokens

### 8.1 Graduation Outcomes (Success vs Failure)

Key proceeds definition (normative):

`raisedUSDST` is the accumulated per-bid spend after applying any `maxRaiseUSDST` haircut. It is the sole value used for the success check.

**Failure (No Graduation)**

The auction fails if:

`raisedUSDST < minRaiseUSDST`

On failure:

- No participant STRATO distribution occurs.
- 100% of all bid USDST becomes refundable after finalization via `withdrawRefund(bidId)`.
- No USDST proceeds are routed to LP / treasury / reserve buckets.
- Owner calls `recoverAfterFailure()` to reclaim escrowed STRATO (claim + LP + bonus reserves) to treasury.

**Success (Graduation)**

The auction succeeds if:

`raisedUSDST >= minRaiseUSDST`

On success:

- Participants receive STRATO allocations (base + bonus) via push-based distribution.
- Only `refundUSDST` is withdrawable by participants after finalization.
- Cleared proceeds (`raisedUSDST`) are reserved into immutable buckets for routing at TGE.

### 8.2 Refund Semantics (Normative)

Refunds arise from three sources:

- Non-clearing bids: `maxPriceUSDST < P*` → full refund of that bid's budget.
- Partial fills at the margin: `maxPriceUSDST == P*` → pro-rata fill, remaining budget refunded.
- Max raise haircut: when `maxRaiseUSDST` binds, each clearing bid's accepted spend is scaled down → the difference is refunded.

Refund availability:

- Refunds MUST be withdrawable after finalization (both success and failure).
- Refund withdrawal MUST be pull-based (participant-initiated), and MUST NOT require any admin action.
- Refunds MUST remain withdrawable regardless of TGE timing or unwind state.

### 8.3 Unsold Tokens (When and Why)

`unsoldTokens = saleSupply - totalAllocated`

Unsold tokens can occur if:

- Under-subscription: total demand at P* is less than S, or
- Max raise binds: haircut reduces accepted spend at fixed P*, which reduces `totalAllocated`, or
- Rounding/dust: token-first rounding down creates small residual supply.

`unsoldTokens` is computed and recorded at finalization.

### 8.4 Unsold Token Policy (Default: Burn)

On success, `burnUnsold()` burns the recorded `unsoldTokens` from `claimReserveRemaining`. This is permissionless and can be called by anyone after finalization.

Additionally, `burnRemainingBonus()` burns any remaining `bonusTokenReserveRemaining` after all distributions complete (`pendingDistributions == 0`).

### 8.5 Consistency Requirements (High Priority)

- No overselling: `totalAllocated` MUST never exceed S.
- Escrow integrity: Burns check `claimReserveRemaining` and `bonusTokenReserveRemaining` sufficiency before executing.
- Failure safety: On failure, STRATO MUST NOT be distributed to participants; only USDST refunds are enabled.
- Finalization invariant: `_assertNoActiveBids()` (O(1) via `activeBidCount`) is enforced before `finalized = true` in all finalize paths — no ACTIVE bids may exist when finalization completes. No O(N) loops remain on any critical path (finalization, distribution, TGE, burns). Diagnostic tools: `verifyNoActiveBids()`, `assertNoActiveBidsSlow()` (O(N)), and `rebuildActivePriceBuckets()` for reconciliation.
- Vaulted base tracking: `totalVaultedBaseTokens` tracks base-only vaulted obligations (excludes bonus). Used by `_requiredClaimReserve()` to gate `burnUnsold()`. Diagnostic: `computeTotalVaultedBaseTokensSlow()` (O(N)).

---

## 9. Liquidity Seeding & Proceeds Routing (At / Around TGE)

### 9.1 Default Proceeds Allocation (of `raisedUSDST`)

Percentages (`lpBps`, `treasuryBps`, `reserveBps`) apply to `raisedUSDST`, not total submitted budgets. Must sum to 10000.

- LP bucket (`lpUSDST`): `raisedUSDST * lpBps / 10000`
- Treasury bucket (`treasuryUSDST`): `raisedUSDST * treasuryBps / 10000`
- Reserve bucket (`reserveUSDST`): `raisedUSDST * reserveBps / 10000`

These bucket values are computed at finalization (end of allocation stage 5) and are immutable thereafter. Any rounding dust is added to the treasury bucket.

### 9.2 Bucketing + Custody (Finalization → TGE)

After successful finalization:

- `lpUSDST` is not withdrawable pre-TGE and is reserved strictly for LP seeding.
- `reserveUSDST` is transferred to `reserveWallet` at TGE.
- `treasuryUSDST` is transferred to `treasuryWallet` at TGE (minus any pre-TGE withdrawals).

Optional (default off): bounded pre-TGE treasury usage via `withdrawTreasuryPreTge()`.

### 9.3 LP Sizing Rule (Normative)

LP is seeded at P* using:

- `lpUSDST` (USDST-side liquidity)
- `lpSTRATORequired = ceil(lpUSDST * tokenUnit / clearingPrice)` (STRATO-side, using ceiling division)

The STRATO used for LP seeding comes only from `lpTokenReserve` (not from participant escrow). `lpTokenReserve` is decremented by `lpSTRATORequired` at TGE execution.

LP reserve sufficiency (hard gate):

At `executeTGE()`: `lpTokenReserve >= lpSTRATORequired` — reverts if not satisfied.

No partial seeding: either LP is seeded fully at P*, or TGE execution fails.

### 9.4 LP Token Lock

LP tokens are locked in `LpTokenLockVault` with:

- **1-year cliff** from TGE (31,536,000 seconds)
- **2-year total vesting** from TGE (63,072,000 seconds)
- After cliff, linear release over the remaining year
- Beneficiary: `treasuryWallet`
- No admin override after initialization

### 9.5 TGE Execution Flow

`executeTGE()` performs:

1. Verifies all distributions complete (`pendingDistributions == 0`)
2. Computes `lpSTRATORequired` and checks `lpTokenReserve` sufficiency
3. Decrements `lpTokenReserve`
4. Transfers `lpUSDST` + `lpSTRATORequired` to `PoolLpSeeder`
5. `PoolLpSeeder.seedAndLock()` adds liquidity to DEX pool, mints LP tokens, forwards to `LpTokenLockVault`
6. Initializes LP vault if needed, records lock
7. Calls `transferLockController.unpause()` to enable STRATO transfers
8. Transfers `treasuryUSDST - preTgeWithdrawn` to `treasuryWallet`
9. Transfers `reserveUSDST` to `reserveWallet`
10. Sets `tgeExecuted = true` (**last**, after all external calls — prevents partial TGE if governance execution path swallows a revert)

---

## 10. Security & Operational Controls

### 10.1 Execution Model — No Reentrancy Risk

STRATO's token contracts (USDST, STRATO) use plain ERC20 `_update` (balance decrement → balance increment → emit event). There are no ERC-777-style transfer hooks, `tokensReceived` callbacks, or fallback invocations during `transfer`/`burn`. All external calls either fully commit or revert — no mid-execution callback can re-enter the auction contract. Therefore no reentrancy guard is needed.

### 10.2 AdminRegistry Whitelisting

The auction contract must be whitelisted in the AdminRegistry for `transfer` and `burn` on the STRATO token. This is a deployment prerequisite, not a runtime check.

### 10.3 Minimal Admin Controls

**Pause bids**

- `pauseBids()` / `unpauseBids()` — may block new bids only (before close buffer)
- MUST NOT block: `finalize()`, refund withdrawals, distribution

**End time**

- Fixed at `startAuction()`; no admin extensions

**Emergency cancel**

- `cancelAuction()` — allowed only before close buffer and before finalization
- Makes all ACTIVE bid budgets refundable via `withdrawAfterCancel()`

### 10.4 Permissionless Finalization

`finalize()`, `finalizePrice()`, and `finalizeAllocationsBatch()` are all permissionless and callable by anyone at/after `endTime`.

For large auctions, batched finalization is recommended:
- `finalizePrice()` — one-time phase-1 call
- `finalizeAllocationsBatch(maxCount)` — repeated phase-2 calls until `finalized == true`
- `finalizeProgress()` — view function returning `(stage, cursor, totalBids, done)` for monitoring

### 10.5 Transfer Lock + Escrow Model (No Mint Assumption)

**Escrow-only requirement**

Before `startAuction()`, the launch contract MUST already hold:

- `claimTokenReserve` (participant distribution STRATO)
- `lpTokenReserve` (LP seeding STRATO)
- `bonusTokenReserve` (tier-1 bonus pool STRATO)

No minting is required or assumed.

**Transfer lock requirement**

STRATO must support:

- outbound transfers disabled pre-TGE (except for whitelisted contracts via AdminRegistry)
- transfer lock can be disabled at TGE by `transferLockController.unpause()`

### 10.6 TGE Execution Authority (Governance)

`executeTGE()` is restricted to `onlyOwner`.

Owner may:

- set or re-schedule `tgeTime` via `setTgeTime()` prior to execution
- execute `executeTGE()` (LP seed + LP lock + transfer unlock + bucket routing)

Owner may not:

- change P*, allocations, refunds, bucket amounts, or bonus allocations after finalization
- change bucket percentages after `startAuction()`

### 10.7 TGE Delay Policy + Resolution Mode

**TGE scheduling flexibility**

Owner MAY update `tgeTime` any time after finalization and before `executeTGE()`.

**Resolution Mode trigger**

`inResolutionMode()` returns `true` when `block.timestamp > finalizeTime + maxTgeDelay` (and `maxTgeDelay > 0`).

In resolution mode, owner may:

- execute TGE normally, or
- initiate unwind via `unwind()` → `unwindBatch()` → `finalizeUnwind()`

### 10.8 Unwind Flow (Resolution Mode)

Unwind is a three-step batched process for returning funds when TGE cannot proceed:

1. **`unwind()`** — initiates unwind (`unwindPhase = 1`)
2. **`unwindBatch(maxCount)`** — iterates over bids:
   - Burns distributed STRATO from bidder addresses via `stratoToken.burn(bidder, amount)` (wrapped in try/catch — if a burn fails, `UnwindBurnFailed` is emitted and cursor advances, but `tokensDistributed` stays non-zero, blocking `withdrawUnwound` for that bid until `retryUnwindBurn(bidId)` succeeds, which emits `UnwindBurnRetried`)
   - Zeros vaulted balances
3. **`finalizeUnwind()`** — after all bids processed:
   - Burns remaining `claimReserveRemaining` and `bonusTokenReserveRemaining`
   - Computes pro-rata USDST pool (`unwindAvailableUSDST`) excluding outstanding refunds
   - Sets `unwound = true`

Post-unwind:

- Bidders call `withdrawUnwound(bidId)` for pro-rata USDST: `claimable = spentUSDST * unwindAvailableUSDST / unwindRaisedUSDST`
- Owner calls `reclaimLpReserve()` to recover LP-reserved STRATO to treasury
- Finalized refunds remain independently withdrawable via `withdrawRefund(bidId)`

**Pre-TGE treasury usage + unwind interaction:**

If pre-TGE treasury withdrawals have occurred, `unwindAvailableUSDST` will be reduced accordingly. Those withdrawals are irreversible.

### 10.9 Admin Recovery Tools

- `restartFinalizeAllocations()` — resets allocation stages and reverts FINALIZED bids back to ACTIVE for replay. Only when `priceFinalized && !finalized`.
- `rebuildActivePriceBuckets(startId, maxCount, resetBuckets)` — reconstructs price bucket state and `activeBidCount` from bid data in batches. For use after proxy upgrades.
- `recoverAfterFailure()` — transfers entire STRATO balance to treasury after a failed auction.
- `verifyNoActiveBids()` — O(N) diagnostic returning `(clean, firstActiveBidId)`. Detects `activeBidCount` drift.
- `assertNoActiveBidsSlow()` — O(N) view that reverts on first ACTIVE bid. For testing/dry-runs.
- `computeTotalVaultedBaseTokensSlow()` — O(N) diagnostic recomputing `totalVaultedBaseTokens` from bid-level state. Detects drift.
- `vaultedBaseObligations()` — returns `totalVaultedBaseTokens` (base-only vaulted obligations).
- `escrowHealth()` — returns `(balance, trackedReserves)` for ops sanity check of STRATO escrow vs tracked reserve partitions.
- `nextUndistributedFrom(start, maxScan)` — view helper returning `(bidId, found)` to find stranded undistributed bids without off-chain scanning.

---

## 11. Other Options (for completeness)

- **A: UCP + Bonus Pool** — implemented; best fit
- **B: LBP** — rewards waiting; poor fit
- **C: Multi-round Dutch** — schedule games; moderate fit
- **D: True CCA** — higher gas/complexity; moderate fit

---

## Appendix: P* Computation

Active price levels (those with non-zero budget) are sorted descending. Budgets are accumulated from the highest price down. P* is the **highest** price level where cumulative demand (`sum(budgets) / price`) >= sale supply. If no level clears, P* = lowest active price level (undersubscribed). If no active levels exist, P* = 0 (failed auction).

The sort uses quicksort with median-of-three pivot selection and smaller-partition-first recursion to bound stack depth.

---

## Appendix: Batched Finalization Stages

Finalization runs through 6 cursor-based stages, each processing one bid per step:

| Stage | Name | Purpose |
|---|---|---|
| 0 | Initialize | Count above-P* demand and at-P* demand |
| 1 | Uncapped allocation | Compute `tokensUncapped` with supply pro-rata; accumulate `raisedUncappedUSDST` |
| 2 | Capped allocation | Apply `maxRaiseUSDST` scaling; compute `tokensCapped`, `spentUSDST`, `refundUSDST` |
| 3 | Finalize bids | Transition ACTIVE → FINALIZED; set success/failure; on failure path, set full refunds |
| 4 | Bonus demand | Accumulate total bonus-eligible demand from tier-1 finalized bids |
| 5 | Bonus allocate | Distribute bonus tokens pro-rata; compute USDST buckets; set `finalized = true` |

On failure (stage 3, `!success`): all ACTIVE bids get full refunds and `finalized = true` is set immediately.

**Edge case:** If `clearingPrice == 0` (all budget zeroed despite active bid count), `_initializeAllocationStages` skips stages 0-2 (which divide by price) and enters directly at stage 3 to finalize bids with full refunds via the normal batched cursor — no O(N) single-tx loop.

---

## Appendix: Early Adoption Incentives (Auction Winners)

Winning bidders who bid during the Tier 1 (Bonus) window receive a pro-rata share of the `bonusTokenReserve` in addition to their base allocation at P*. This rewards early conviction with additional tokens without changing the clearing price.

Secondary Incentive: Post-TGE Fee Benefits (Engagement Booster)

- All winners receive time-limited fee benefits after TGE, with stronger benefits for earlier tiers.
- Tier 1: strongest benefit window (longest duration)
- Tier 2: medium window

How it's applied (functional):

- Eligibility is determined at finalization and applied automatically during fee payment (no user setup).

---

## Appendix: Refund Retention Options (Non-Winners & Partial Fills)

Users may receive refunds due to losing bids, partial fills, or cap haircuts. At refund time, users can either withdraw or choose an on-platform option that keeps USDST productive within STRATO.

Default Option: Withdraw Refunds

**Option A (Recommended): Deposit to USDST Lending**

- Earn market-based yield from borrowing demand
- Full liquidity: can withdraw anytime (subject to pool conditions)
- No price exposure to STRATO

**Option B: Convert Refund to STRATO Fee Credits**

- Non-transferable fee credits usable across STRATO
- Best fit for high-conviction users

**Option C (Advanced / Optional): Auto-Liquidity Provision**

- Use refund to provide liquidity by pairing USDST with STRATO
- Earn swap fees and LP incentives
- Takes on price exposure and impermanent loss risk

---

## Resolved Analysis

- ✅ Scenario review — Implemented and tested: low demand, maximum raise binding, partial fills, refund-heavy outcomes, zero-price edge case.
- ✅ Unsold token policy — Burn via `burnUnsold()` after finalization.
- ✅ Early adoption incentive — Bonus token pool for tier-1 bidders.
- ✅ Smart contract created — `TokenLaunchAuction.sol` with batched finalization and recovery tools.
- ⚠️ Refund routing to platform — Appendix options documented; not yet implemented in contract.
- ⚠️ Bid data privacy — On-chain; no off-chain solution implemented.

---

## STRATO-Specific Implementation Notes

- Use `record` keyword for contract and mappings (e.g., `contract record TokenLaunchAuction`, `mapping(...) public record`)
- Cannot use `days`/`hours` keywords; use seconds directly (e.g., `604800` not `7 days`)
- No `constant` definitions; use regular state variables
- Loop variables must be declared outside the loop (e.g., `uint i; for (i = 0; ...)`)
- Explicit zero-initialization required for all `Bid` struct fields in `placeBid()` to avoid SNULL errors
