# StablePool.sol security audit, round 2

**Target:** `app/contracts/concrete/Pools/StablePool.sol` at commit `ee71c76e62` (branch `contract-audit`), i.e. after the first audit's F1–F9 fixes.
**Date:** 2026-09-08
**Status:** all findings fixed the same day; see the status section below.
**Method:** line-by-line comparison of every ported function against Curve StableSwap-NG (`CurveStableSwapNG.vy`), review of the StablePool-specific code (transfer accounting, wrappers, `addCoin`, migration, the AdminRegistry mint/burn path), and empirical probes of SolidVM semantics that the contract depends on. Every finding has a `solid-vm-cli` test that **passes against the current contract by asserting the defective behaviour**, so each one is a reproducible demonstration rather than a claim.

## Proof files

| File | What it holds | Result |
|---|---|---|
| `app/contracts/tests/Pool/StablePoolAudit2.test.sol` | G1–G7 and L1. Written first as proofs of concept that passed against the vulnerable contract (9 / 9 reproduced), then inverted into regressions once the fixes landed | 10 / 10 pass against the fixed contract |
| `app/contracts/tests/Pool/StablePoolAudit.test.sol` (first audit) | regression suite for F1–F9 | 12 / 12 |

Run any of them with `cd app/contracts/tests/Pool && solid-vm-cli test <file>`. The interim `StablePoolLatentRebasing.test.sol` and `StablePoolPatched.sol` fixture (a copy with only the G3 line fixed, used to prove L1 before G3 was fixed) were deleted once L1 was ported into the main suite.

## Summary

| ID | Severity | Finding | Proof |
|---|---|---|---|
| G1 | **High** | `removeliquidityOneCoin` charges its fee on the whole reserve instead of on the imbalance it creates. A 1 % withdrawal from a balanced pool loses 14.6 %; anything under 0.15 % of the pool aborts. | `it_g1_*` (2 tests) |
| G2 | **Medium** | `addCoin` mints LP by nominal value while the invariant *falls* (−6.7 % in the PoC). The new coin is then quoted at 13.9× and 1 000 of it sells for 7 829 of coin 0. | `it_g2_*` |
| G3 | **Medium** | Rebasing support (assetType 2) is dead code: SolidVM evaluates the assignment `flag = flag \|\| (...)` as `(flag = flag) \|\| (...)`. `exchangeReceived` is therefore not blocked on a "rebasing" pool and any rebase is sweepable by a third party. | `it_g3_*` (2 tests) |
| G4 | Low | Deposits never call `upkeepOracles`, so the on-chain spot/EMA/D oracles do not move on deposits (Curve updates them). | `it_g4_*` |
| G5 | Low | Pause stops swaps and deposits but not the two curve-priced withdrawals, so a paused pool can still be traded against by LPs. | `it_g5_*` |
| G6 | Low | `PoolFactory.createStablePool` hard-codes `[1e18, 1e18]` rate multipliers; a 6-decimal / 18-decimal pair is priced 2× wrong. | `it_g6_*` |
| G7 | Info | `exchangeReceived` sweeps any coins that reach the pool outside a swap; must only be used atomically. | `it_g7_*` |
| L1 | Low (latent) | Once G3 is fixed, rebasing pools are open to the first-depositor inflation attack; the default 1 % floor in `addLiquidity` rounds to 0 at tiny supply. | `it_l1_*` |

No new reentrancy, access-control or LP-token authorisation issue was found; the things checked and found sound are listed at the end.

## Status: all findings fixed (2026-09-08, same day)

Fixes are in `StablePool.sol` and `PoolFactory.sol`; the proof-of-concept suite was inverted into regressions. 134 tests across the 9 suites that touch StablePool or the factory pass.

| ID | Fix |
|---|---|
| G1 | `_calcWithdrawOneCoin`: `dxExpected = (xpJ * d1) / d0 - newY` (Curve's term). |
| G2 | `addCoin` mints `totalSupply * (d1 - d0) / d0` and requires `d1 > d0`, so the initial amount must raise the invariant (about 4 % of the per-coin balance at A = 100; a 1 000-coin seed into 100 000/100 000 now reverts). The new coin's oracle slot is seeded from `_getP` instead of a flat 1e18. |
| G3 | Both flag assignments rewritten as `if (assetType == 2) { poolContainsRebasingTokens = true; }`. `exchangeReceived` now reverts on a rebasing pool and rebases show up in D. |
| G4 | `_addLiquidityGeneral` calls `upkeepOracles(xp, amp, d1)` on every non-initial deposit. |
| G5 | `removeliquidityOneCoin` and `removeLiquidityImbalance` are `whenNotPaused` as well as `whenNotDisabled`; proportional `removeLiquidityGeneral` stays open while paused. |
| G6 | `PoolFactory.createStablePool` derives each multiplier as `10 ** (36 - decimals)`. A 6/18-decimal pair now trades at par (1 coin buys 0.997 after fee). |
| G7 | NatSpec warning on `exchangeReceived`; behaviour intentionally unchanged, the test pins it. |
| L1 | The first deposit locks `MINIMUM_LIQUIDITY = 1000` LP at `address(0xdead)` and requires `D > 1000`. The PoC now shows the attacker losing ~1e24 and the victim recovering 99.9 %+. |
| obs. | `_initialize` rejects duplicate coin addresses; `migrateAllTokens` reads `_balances()` (correct on rebasing pools); `rampA` is `external`. |

**Knock-on test changes for the liquidity lock:** `StablePool.test.sol` (supply is `liquidity + 1000` after the first deposit and `1000` after a full exit), `StablePoolAudit.test.sol` (F2 pro-rates over the real total supply; F2b/F2c expect `1000` left), `StablePoolMigration.test.sol` (F8 expects `minted + 1000`).

**A note on the VM used for this audit.** The `solid-vm-cli` installed in `~/.local/bin` at the time (built 2026-09-04, most likely from the `speed` branch) mis-dispatches typed calls made from nested call frames: `T(addr).f()` runs `T`'s own body instead of the override deployed at `addr`. That is what made `ERC20(t).decimals()` return 18 from an internal helper while fixing G6. A CLI built from this branch dispatches correctly, and every suite above was re-run against it. The factory helper calls through `IERC20Metadata` regardless, which is the right dependency. The `||`-assignment bug (G3) is real on this branch and is fixed in the VM separately, behind a fork height.

| Suite | Result |
|---|---:|
| `Pool/StablePoolAudit2.test.sol` (this audit, inverted) | 10 / 10 |
| `Pool/StablePoolAudit.test.sol` (first audit) | 12 / 12 |
| `Pool/StablePool.test.sol` | 15 / 15 |
| `Pool/StablePoolMigration.test.sol` | 1 / 1 |
| `Pool/StablePoolYieldToken.test.sol` | 5 / 5 |
| `Pool/MergeStablePools.test.sol` | 8 / 8 |
| `Pool/PoolFactory.test.sol` | 22 / 22 |
| `Pool/Pool.test.sol` | 53 / 53 |
| `Flash/Adv_Amm_LpValue.test.sol` | 8 / 8 |

The findings below are kept as written at audit time; the numbers describe the contract before the fixes.

---

## G1 · One-coin withdrawals are overcharged, small ones cannot execute (High)

**Where:** `StablePool.sol:1103`, in `_calcWithdrawOneCoin`.

```solidity
if (j == i) {
    dxExpected = (xpJ * d1) / (d0 - newY);      // shipped
```

Curve StableSwap-NG has

```python
if j == i:
    dx_expected = xp_j * D1 / D0 - new_y        # reference
```

The parenthesisation moved `new_y` into the divisor. Curve's term is the *imbalance* the withdrawal creates on coin *i* (ideal post-withdrawal balance minus the actual one, a small number). The shipped term is `xp_i · D1 / (D0 − new_y)`, which is close to the entire reserve of coin *i* for any withdrawal that is not a large share of the pool. The withdrawal fee (`baseFee` = 0.15 % at the default 0.3 % swap fee) is then applied to that whole reserve and deducted from what the LP receives.

**Proof.** Balanced pool of 100 000 / 100 000, A = 100, fee 0.3 %, LP supply 200 000 (so 1 LP = 1 coin). The table is from an integer-exact replica of the contract's math (`scratchpad/onecoin_ref.py`); the 1 % row matches the on-chain test to the wei (1 707.22).

| Burn (% of supply) | LP burned | Shipped payout | Shipped fee | Curve payout | Curve fee |
|---:|---:|---:|---:|---:|---:|
| 0.05 % | 100 | **aborts** | – | 99.85 | 0.15 % |
| 0.10 % | 200 | **aborts** | – | 199.70 | 0.15 % |
| 0.15 % | 300 | 1.12 | 99.6 % | 299.55 | 0.15 % |
| 0.5 % | 1 000 | 703.68 | 29.6 % | 998.48 | 0.15 % |
| 1 % | 2 000 | 1 707.22 | 14.6 % | 1 996.90 | 0.15 % |
| 5 % | 10 000 | 9 730.80 | 2.7 % | 9 982.40 | 0.15 % |
| 25 % | 50 000 | 49 720.52 | 0.4 % | 49 833.25 | 0.15 % |
| 50 % | 100 000 | 96 593.01 | 0.1 % | 96 599.20 | 0.11 % |

The fee is effectively a constant ≈ 300 coins (0.15 % of the pool's D) regardless of the withdrawal size. Below that size `xpReduced[i]` drops under the solved balance and the subtraction underflows, which SolidVM treats as a fatal error rather than a revert. `it_g1_tiny_one_coin_withdrawal_cannot_execute` shows a 0.1 % withdrawal failing while the same LP exits fine proportionally.

**Impact.** Direct loss of user funds on every one-coin withdrawal that is not a large fraction of the pool; a denial of service below 0.15 %. Half of the overcharge is booked to `adminBalances` (protocol), half stays with the remaining LPs. Not attacker-profitable, but the backend swapping service does route single-sided exits through `removeliquidityOneCoin` (`app/backend/src/api/services/swapping.service.ts:1129`). The first audit's F1 test withdrew 50 % of the supply, which is exactly the region where the error vanishes.

**Fix.**

```solidity
dxExpected = (xpJ * d1) / d0 - newY;
```

Then invert both G1 tests: a 1 % withdrawal must return ≥ 99.8 % of its share and a 0.1 % withdrawal must succeed.

---

## G2 · `addCoin` pays LP for a deposit that lowers the invariant (Medium)

**Where:** `StablePool.sol:1412`

```solidity
uint mintAmount = (totalSupply * newValue) / existingValue;
```

Every other deposit path mints by the change in D (`StablePool.sol:497`). `addCoin` mints by nominal value, and a new coin with a small initial balance makes the pool badly imbalanced, so D goes *down* while supply goes up.

**Proof** (`it_g2_add_coin_pays_lp_for_a_value_destroying_deposit`). 100 000 / 100 000 two-coin pool, then `addCoinToStablePool` with 1 000 of a third coin:

| | Before | After |
|---|---:|---:|
| Invariant D | 200 000 | 186 641 (−6.7 %) |
| LP supply | 200 000 | 201 000 |
| Virtual price (D / supply) | 1.0000 | 0.9286 (−7.1 %) |
| Pool's spot price of the new coin | – | 13.90 × coin 0 |

Immediately selling another 1 000 of the new coin through `exchange(2, 0, …)` returns **7 828.7** of coin 0. That value comes out of the existing LPs.

**Impact.** Requires the factory owner to call `addCoinToStablePool`, so the trigger is trusted, but the harm lands on every existing LP and the profit is available to anyone holding the new coin, not only the chosen depositor. Sizing `_initialAmount` near the existing per-coin balance avoids it in practice, but nothing enforces that.

**Fix.** Mint by invariant change like every other deposit: compute D before and after and `require(d1 > d0)`, `mintAmount = totalSupply * (d1 - d0) / d0`. That makes an under-sized initial amount revert instead of silently diluting. Also seed the new coin's oracle slot (`StablePool.sol:1403`) from `_getP` rather than `1e18`, and use `_balances()` for `existingValue` so rebasing pools are valued the same way as everywhere else.

---

## G3 · Rebasing support never switches on (Medium)

**Where:** `StablePool.sol:242` (in `_initialize`) and `:1394` (in `addCoin`)

```solidity
poolContainsRebasingTokens = poolContainsRebasingTokens || (_assetTypes[i] == 2);
```

**Root cause is in the VM.** SolidVM parses an assignment *statement* whose right-hand side is `X || Y` (or `X && Y`) as `(a = X) || Y`, so only `X` is stored. `it_g3_solidvm_or_assignment_only_stores_the_left_operand` shows `a = a || (1 == 1)` leaving `a` false, `a = (a || (1 == 1))` setting it, and `b = b && (1 == 2)` leaving `b` true. Declarations (`bool r = a || b`), `if`, `require`, ternaries and a parenthesised right-hand side all behave correctly (probe results: 20 cases in `scratchpad/probe/Probe4.test.sol`). The two lines above are the only assignment statements of that shape in `app/contracts`, so the blast radius inside the contracts is exactly this flag.

**Proof** (`it_g3_rebasing_flag_is_never_set`). A pool created with `assetTypes = [2, 2]` reports `getAssetType(i) == 2` for both coins, yet:

- a 1 000-coin "rebase" (transfer to the pool) leaves `computeInvariant()` at exactly 200 000, because `_balances()` still reads the ledger;
- `exchangeReceived`, which must revert on a rebasing pool, executes;
- a third party calls it and walks off with 990+ coins of the other side, i.e. the LPs' entire rebase.

Negative rebases would go the other way: the ledger would exceed the real balance and `_transferOut` would start failing.

**Impact.** Any pool that is ever configured with a rebasing coin behaves as a plain ledger pool with a public sweep function on top. No such pool is in the current deploy scripts (the archived multi-token deploy used `[1, 1, 3]`), so this is a loaded gun rather than a live loss.

**Fix.** In both places:

```solidity
if (_assetTypes[i] == 2) { poolContainsRebasingTokens = true; }
```

and raise the parser bug with the SolidVM team, since `&&` is affected as well and nothing warns. Then port L1 below into the main suite, because fixing this makes it live.

---

## G4 · Deposits leave the price and D oracles stale (Low)

**Where:** `_addLiquidityGeneral`, `StablePool.sol:~460–500`. Curve's `add_liquidity` ends its `total_supply > 0` branch with `self.upkeep_oracles(xp, amp, D1)`; the port does not.

**Proof** (`it_g4_deposits_leave_the_price_oracle_stale`). After a single-sided deposit of 900 000 of coin 0 into a 100 000 / 100 000 pool, `getP(0)` is 1.1436 while `lastPrice(0)`, `emaPrice(0)` and, an hour later, `priceOracle(0)` all still read 1.0000. A 1-coin swap afterwards records 1.14 at once.

**Impact.** The EMA oracle is only as fresh as the last swap. Nothing on-chain consumes `priceOracle()`/`dOracle()` today, hence Low; it becomes a manipulation surface the moment something does.

**Fix.** Call `upkeepOracles(xp, amp, d1)` in the `totalSupply > 0` branch, as Curve does.

---

## G5 · Pause does not stop curve-priced withdrawals (Low)

**Where:** `removeliquidityOneCoin` (`:630`) and `removeLiquidityImbalance` (`:660`) are `whenNotDisabled`; `exchange`/`swap`/deposits are `whenNotPaused`.

**Proof** (`it_g5_paused_pool_still_executes_price_dependent_exits`). With `isPaused == true`, `exchange` reverts but a 10 % one-coin withdrawal and an imbalanced withdrawal of 5 000 coin 0 both execute.

**Impact.** Both withdrawals are swaps in disguise. If the admin pauses because the pool is mispricing (a bad `rateMultiplier`, a glitched yield-token `exchangeRate`, an oracle outage), LPs can still convert their position into the mispriced coin at that price. Proportional `removeLiquidityGeneral` is price-independent and should stay open.

**Fix.** Add `whenNotPaused` to the two curve-priced withdrawal functions only.

---

## G6 · Factory pools assume 18 decimals (Low, lives in PoolFactory)

**Where:** `PoolFactory.sol:297` passes `[1e18, 1e18]` as rate multipliers for every `createStablePool` pair; `StablePool.initialize` accepts them without checking `decimals()`.

**Proof** (`it_g6_factory_pool_misprices_a_6_decimal_coin`). A 6-decimal / 18-decimal pair seeded with 1 000 of each: the seed mints 0.928 LP for 2 000 coins of value; selling 1 of the 18-decimal coin buys 1.99 of the 6-decimal one; selling 1 of the 6-decimal coin buys 0.499. The pool behaves like a constant-product pool that is off by a factor of 2, and is arbitrageable until the LPs have paid for it.

**Fix.** Derive the multiplier as `10 ** (36 - decimals)` per coin (the Curve convention) in the factory, or have `_initialize` reject a multiplier that disagrees with `ERC20(coin).decimals()`.

---

## G7 · `exchangeReceived` sweeps stray transfers (Informational)

`it_g7_stray_transfer_is_swept_by_the_next_caller`: a user who transfers 1 000 coins to the pool intending to call `exchangeReceived` in a following transaction loses them to whoever calls it first (the sweeper receives 990+ of the other coin). This is Curve's documented behaviour and is what makes zaps and routers work, but nothing in the UI or docs says so. Worth a NatSpec warning, and worth making sure no client ever sends the transfer and the call in separate transactions.

---

## L1 · First-depositor inflation on rebasing pools (Low, latent until G3 is fixed)

Proven at audit time against a verbatim copy of the contract with only the two G3 lines rewritten; now covered by `it_l1_first_depositor_cannot_inflate_a_rebasing_pool` in the main suite.

With `_balances()` reading `balanceOf`, a donation inflates D without minting LP. Attacker deposits 1 wei of each (2 LP), donates 1e24 of each, victim deposits 1.4e24 of each through `addLiquidity` (the wrapper that carries the default 1 % floor) and receives **2 LP** (2.8 rounded down); the attacker's 2 LP then redeem for 2.4e24, a gain of 0.4e24 taken from the victim. The floor does not help because `idealMint · 0.99` rounds to 1 at a supply of 2. Non-rebasing pools are not exposed: their ledger ignores donations and `exchangeReceived` can only move value between coins, not create it.

**Fix.** Standard mitigations: lock a minimum LP amount on the first deposit (mint the first `1e3` to a dead address), or require the first deposit to come from the factory with a sane size, and compute `_minMintFloor` with rounding that cannot reach zero for a non-zero deposit.

---

## Observations without a proof of concept

- `_dualAmounts` sizes a "balanced" deposit by the balance ratio of coins 0 and 1 only; in a pool with three or more coins the deposit is imbalanced against the others and pays a small fee.
- The pool emits its own `Transfer(address(0), receiver, mintAmount)` on LP mint, which can confuse indexers into seeing the pool as a token.
- `setDisabled(false)` on a migrated pool leaves a drained, LP-bearing pool live; the next deposit divides by zero. Migration should be irreversible or `setDisabled` should check `tokenBalances`.
- `updateRateMultipliers` / `updatePeg` / `updateRateOracles` reprice the pool instantly, with no ramp like `rampA`. Admin-trust today; a ramp would remove the timing risk.
- `migrateAllTokens` reads `tokenBalances`, which will be stale on a rebasing pool once G3 is fixed; use `_balances()` plus `adminBalances`.
- `rampA` has no explicit visibility keyword.
- `_initialize` does not reject duplicate coin addresses (the factory does); a duplicate would double-count one ledger entry in `_balances()`.

## Checked and found sound

- `getD`, `getY`, `getYD`, `_getP`, `_dynamicFee`, `__exchange`, `_exchange`, `_addLiquidityGeneral` (apart from G4), `removeLiquidityImbalance`, `_removeLiquidityGeneral`, `_A`, `rampA`, `stopRampA`, `setNewFee`, `_calcMovingAverage`, `upkeepOracles` all match StableSwap-NG term for term.
- The `wad_exp` port is numerically correct at 0, ±1, −0.5, −1/866 and the underflow floor (`scratchpad/probe/Probe2.test.sol`).
- `pack2`/`unpack2` round-trip; memory arrays copy on assignment and storage arrays alias, which is what `_calcWithdrawOneCoin` and `upkeepOracles` rely on.
- The AdminRegistry route for LP `mint`/`burn`: a non-whitelisted, non-admin caller reverts; the symmetric whitelist cannot be used by a third party to mint or burn; a user calling the pool's `onlyOwner` functions reverts.
- Oracle prices are 1e18-scaled in `LendingPool`, matching `_storedRates`; the "8-decimal" comment in `PriceOracle.sol` is stale.
- Typed external calls dispatch by target address (`scratchpad/probe/Probe5.test.sol`), so the test harnesses cannot hijack the contract's outbound calls.
- All user-facing state changes are `nonReentrant`; burns happen before payouts; withdrawals pro-rate over `_balances()`; `initialize` cannot be replayed (first-audit fixes hold, 12 / 12).
