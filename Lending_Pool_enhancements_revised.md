# Lending Pool Enhancements (Markdown Spec)

A concise spec for four functional upgrades to your `LendingPool`:

1. **Global borrow index** (RAY)
2. **System-wide debt ceilings** (asset + USD)
3. **Protocol reserves accrued continuously + sweeping**

---

## 0) Overview

* Replace per-loan `principal/interestOwed` with a **single global borrow index** and **per-user scaled debt**.
* APR is dynamic via a **kinked utilization curve**.
* Enforce **hard caps** on total system debt in both asset units and USD.
* **Reserve factor** is applied at accrual time; suppliers don’t count protocol reserves in their share.

---

## 1) Global Borrow Index (RAY, 1e27)

### Purpose

Uniform, O(1) interest accrual without iterating over users. Each account stores scaled debt; real debt is derived from the global index.

### Data Model

* `borrowIndex` (RAY): starts at `1e27`, monotonically increases.
* `totalScaledDebt`: sum of all users’ `scaledDebt`.
* Per-user `LoanInfo`:

  * `scaledDebt`
  * `lastUpdated` (optional metadata)

**Real user debt:**
`debt = scaledDebt * borrowIndex / RAY`

**Total system debt:**
`totalDebt = totalScaledDebt * borrowIndex / RAY`

### Accrual Math (`_accrue()`)

* `dt = now - lastAccrual` (skip if 0)
* `rateBps = currentBorrowRateBps()` (see §2)
* `factorRAY = (rateBps / 10000) * (dt / SECONDS_PER_YEAR) * RAY`
* `borrowIndex = borrowIndex * (RAY + factorRAY) / RAY`
* `interestDelta = totalScaledDebt * (borrowIndex - oldIndex) / RAY`
* `reservesAccrued += interestDelta * reserveFactorBps / 10000`

### Operations

* **Borrow:**
  `scaledAdd = amount * RAY / borrowIndex`
  `user.scaledDebt += scaledAdd; totalScaledDebt += scaledAdd`
* **Repay (or liquidate):**
  `owed = user.scaledDebt * borrowIndex / RAY`
  `repay = min(amount, owed)`
  `scaledDelta = repay * RAY / borrowIndex` (clamp to `<= user.scaledDebt`)
  Subtract from user and total.

### Edge Cases

* Rounding dust on final repay ⇒ clamp `scaledDelta`.
* Index must be strictly non-decreasing (fuzz invariant).
* `totalBorrowPrincipal` is removed; use `totalScaledDebt` + `borrowIndex`.

---

## 2) System-Wide Debt Ceilings (Asset + USD)

### Purpose

Governance control and blast-radius limits under stress (price/oracle/liquidity events).

### State

* `debtCeilingAsset` (in borrowable asset units, 18d)
* `debtCeilingUSD` (in 1e18 USD)

### Enforcement (on each `borrow`)

```
_totalDebt() + amount <= debtCeilingAsset   (if set)
((_totalDebt() + amount) * priceUSD) / 1e18 <= debtCeilingUSD   (if set)
```

* Require valid oracle price (`> 0`), fail closed if not.

### Notes

* Keep both ceilings: asset cap constrains absolute units; USD cap constrains notional risk.
* Consider small governance headroom to avoid race-to-ceiling UX issues.

---

## 3) Protocol Reserves on Accrual + Sweeping

### Purpose

Take the protocol’s share at **accrual time** to keep supplier accounting clean and predictable.

### Accounting

* During `_accrue()`:
  `reservesAccrued += interestDelta * reserveFactorBps / 10000`
* **Suppliers’ underlying:**
  `underlying = cash + totalDebt - reservesAccrued`

### Exchange Rate

```
if mTokenSupply == 0 => 1e18
exchangeRate = (cash + totalDebt - reservesAccrued) * 1e18 / mTokenSupply
```

* If extreme edge where `reservesAccrued > cash + totalDebt`, floor at `cash` to avoid negative supplier value.

### Sweeping

* `sweepReserves(amount)` transfers from pool to `FeeCollector`
* Limited by both `reservesAccrued` and actual `cash` on hand
* Reduces `reservesAccrued` by the sent amount

---

## Integration Points (Code Touch List)

* **New state:**
  `borrowIndex (RAY)`, `lastAccrual`, `totalScaledDebt`, `reservesAccrued`, `rateParams`, `debtCeilingAsset`, `debtCeilingUSD`.

* **Remove/replace:**
  Remove per-loan `principalBalance`, `interestOwed`, `lastRateBps`, and `totalBorrowPrincipal`.
  Keep `LoanInfo` but with `scaledDebt` (+ optional `lastUpdated`).

* **Functions to modify:**

  * `borrow`: `_accrue()`, debt ceiling checks, update `scaledDebt`.
  * `repay`: `_accrue()`, reduce `scaledDebt`.
  * `liquidationCall`: `_accrue()`, reduce borrower `scaledDebt`, unchanged collateral math.
  * `getExchangeRate`: use `cash + totalDebt - reservesAccrued`.

* **Keep using:**
  Existing `reserveFactor` in `AssetConfig`.

---

## Governance / Param Table (Suggested Ranges)

| Parameter               | Units | Typical       | Notes             |
| ----------------------- | ----- | ------------- | ----------------- |
| `reserveFactor`         | bps   | 500–2000      | 5–20%             |
| `debtCeilingAsset`      | asset | pool-specific | Hard cap in units |
| `debtCeilingUSD`        | 1e18  | pool-specific | Notional cap      |

---
