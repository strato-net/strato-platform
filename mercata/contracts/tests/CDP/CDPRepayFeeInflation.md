# CDP Repay Fee Inflation Bug

## Summary

`CDPEngine.repay`, `repayAll`, and `liquidate` compute a "fee" by subtracting the
rate-normalised `scaledDebt` from the USD-denominated `owed` amount.  Because
`scaledDebt` is in **index units** (not USD), the subtraction overstates the fee
whenever `rateAccumulator > RAY`.  The overstated amount is minted as unbacked
USDST to the FeeCollector (and/or CDPReserve when `feeToReserveBps > 0`).

The phantom grows with system age — specifically, with how far
`rateAccumulator` has drifted from its initial value of `RAY` (1e27).

## Root cause

In `repayAll` (lines 433-435 of CDPEngine.sol):

```solidity
uint baseUSD = scaledDebtToRemove;           // ← index units, NOT USD
uint feeUSD  = owed > baseUSD ? (owed - baseUSD) : 0;
_routeFees(asset, feeUSD);                   // mints feeUSD as new USDST
```

`scaledDebtToRemove` equals `userVault.scaledDebt`, which is the debt normalised
by `rateAccumulator`:

    scaledDebt = principal × RAY / rateAccumulator

When the user borrowed at `rateAccumulator = RAY`, scaledDebt happens to equal
the principal in USD, so the formula is accidentally correct.  Once the rate has
grown (i.e., any time after the very first borrow), `scaledDebt < principal`, and
the difference `owed − scaledDebt` overstates the fee by:

    phantom = principal × (rateAccumulator − RAY) / rateAccumulator

The same pattern appears in `repay` (line 395) and `liquidate` (line 512).

## Test parameters

| Parameter | Value |
|---|---|
| Stability fee | 2 % APR (continuously compounded) |
| CDP size | $100,000 USDST |
| Collateral price | $5, 18-decimal unitScale |
| `feeToReserveBps` | 0 (all fees to FeeCollector) |

## Test results

### Baseline — fresh system (rate = RAY at borrow time)

When the user borrows at the initial rate, `scaledDebt == principal` and the fee
formula is correct.  No phantom fees.

| Hold period | Burned from user | Fees minted | Real interest | Phantom |
|---|---|---|---|---|
| 1 week | $100,038 | $38 | $38 | **$0** |
| 1 year | $102,020 | $2,020 | $2,020 | **$0** |

### 3-month-old system (rate ≈ 1.005 × RAY)

| Hold period | Burned from user | Fees minted | Real interest | Phantom |
|---|---|---|---|---|
| immediate | $100,000 | $497 | $0 | **$497** |
| 1 week | $100,038 | $535 | $38 | **$497** |
| 1 year | $102,020 | $2,517 | $2,020 | **$497** |

### 6-month-old system (rate ≈ 1.010 × RAY)

| Hold period | Burned from user | Fees minted | Real interest | Phantom |
|---|---|---|---|---|
| immediate | $100,000 | $992 | $0 | **$992** |
| 1 week | $100,038 | $1,030 | $38 | **$992** |
| 1 year | $102,020 | $3,012 | $2,020 | **$992** |

### Key observations

1. **The user's burn amount is always correct.**  The user pays exactly
   `scaledDebt × rateAccumulator / RAY`, which is the mathematically correct
   debt including compound interest.  The bug does not overcharge the borrower.

2. **The phantom is constant per CDP.**  It is fixed at borrow time as
   `principal × (rate − RAY) / rate` and does not change regardless of how long
   the position is held before repay.

3. **The phantom is unbacked USDST.**  `_routeFees` mints fresh USDST to the
   FeeCollector/CDPReserve that is not backed by any user payment.  Over time
   this inflates the USDST supply.

4. **Severity scales with system age.**  On a 3-month-old system the phantom is
   ~0.5 % of principal ($497 per $100k).  On a 6-month-old system it doubles to
   ~1 %.  On a 5-year-old system it reaches ~9.5 %.

5. **Short holds amplify the ratio.**  On a 6-month-old system, a 1-week
   borrow-repay cycle shows fees of $1,030 against real interest of $38 — a
   **27× inflation** of the fee.

## Impact

- **USDST supply inflation:** every repay/repayAll/liquidate mints unbacked
  USDST, gradually degrading the peg backing.
- **Incorrect fee distribution:** the FeeCollector and CDPReserve receive far
  more than the actual stability-fee revenue, distorting the junior-note system
  and protocol economics.
- **Worsens over time:** the phantom grows monotonically with system age.  The
  longer the protocol runs, the larger the unbacked mint on every repay.

## Proposed fix (not implemented)

The root problem is that `repay`/`repayAll`/`liquidate` try to decompose the burn
amount into "principal" and "fee" at repay time, but the information needed (the
rate at which each unit of scaled debt was originally created) is not stored.

**Approach: collect fees during accrual, not during repay.**

In `_accrue`, after computing the new rate, mint the fee for the period:

```solidity
if (assetState.totalScaledDebt > 0 && newRate > oldRate) {
    uint feeUSD = (assetState.totalScaledDebt * (newRate - oldRate)) / RAY;
    _routeFees(asset, feeUSD);
}
```

Then remove all `_routeFees` calls from `repay`, `repayAll`, and `liquidate` —
those functions simply burn the owed amount and update the books.

This mirrors how MakerDAO's `drip` function works: fees are materialised
continuously as the rate grows, rather than reconstructed at repay time.  The fee
is correct by construction because it uses the exact rate delta and the actual
outstanding scaled debt.

## Running the tests

```bash
cd mercata/contracts/tests/CDP
solid-vm-cli test CDPRepayFeeInflation.test.sol
```

All 8 tests should pass (they document the current buggy behaviour, not assert
correct behaviour).

Note: `PriceOracle.sol` has a pre-existing SolidVM compilation issue with
duplicate loop-variable declarations that must be fixed first (renaming `i` to
`j`/`k` in the second and third for-loops of `_rotateToLinear` and
`_syncQueueSize`).  This fix is included in the branch.
