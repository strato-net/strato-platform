# Lending & Liquidation API Test Plan (API Level)

## 1. Health & Auth
- **GET /api/health**: Returns 200, correct structure.
- **GET /users/me**: Returns correct user info with valid token, 401 with invalid/expired token.

---

## 2. Assets & Tokens

- **GET /api/tokens/balance?key=eq.<address>**
  - Returns all tokens with balances for the user.
  - **Note:** Requires Authorization header (Bearer token for each user).
  - **Precondition:** User must be authenticated.

---

## 3. Lending Pool: Deposit & Withdraw

**Preconditions:**
- User must have a balance of the asset to deposit (e.g., USDST).
- User is acting as a **liquidity provider** (has a valid token).

**Balance Flow:**
- **Deposit:**
  - Unencumbered balance decreases (tokens leave wallet).
  - Collateral balance increases (tokens locked as collateral).
- **Withdraw:**
  - Collateral balance decreases (tokens unlocked).
  - Unencumbered balance increases (tokens returned to wallet).

**Steps:**
- **POST `/api/lend/deposit`**: Deposit asset, expect unencumbered balance decreases, collateral balance increases.
- **POST `/api/lend/withdraw`**: Withdraw asset, expect collateral balance decreases, unencumbered balance increases.
- **GET `/api/tokens/balance?key=eq.<address>`**: Confirm balances after deposit/withdraw.

---

## 4. Borrow, Repay, Withdraw

**Preconditions:**
- User must first **deposit collateral** (e.g., GOLDST) via `/api/lend/deposit`.
- There must be sufficient liquidity in the pool (provided by a liquidity provider).
- User is acting as a **borrower** (has a valid token).

**Steps:**
- **POST `/api/lend/borrow`**: Borrow against collateral, expect loan created.
- **POST `/api/lend/withdraw`**: Try to withdraw collateral while loan is active, expect 400 error.
- **POST `/api/lend/repay`**: Repay loan, expect loan repaid.
- **POST `/api/lend/withdraw`**: Withdraw collateral after repay, expect success.

---

## 5. Borrow More While Under LTV

**Preconditions:**
- User has already deposited collateral and borrowed a small amount.
- There is still room under the LTV/collateralization ratio.

**Steps:**
- **POST `/api/lend/borrow`**: Borrow a small amount.
- **POST `/api/lend/borrow`**: Borrow more, still under LTV, expect success.
- **POST `/api/lend/borrow`**: Try to over-borrow, expect 400 error.

---

## 6. Cross-Asset Borrow/Repay

**Preconditions:**
- User deposits asset A as collateral.
- User borrows asset B.
- There is sufficient liquidity for both assets.
- Oracle (admin) can update prices.
- **Multi-user:** Oracle/admin role required for price update.

**Steps:**
- **POST `/api/lend/deposit`**: Deposit asset A.
- **POST `/api/lend/borrow`**: Borrow asset B against asset A.
- **POST `/oracle/price`**: Appreciate asset B.
- **POST `/api/lend/borrow`**: Borrow against asset B.
- **POST `/api/lend/repay`**: Repay loan on asset A using asset B.
- **Check**: All balances and loan statuses are correct.

---

## 7. Liquidation

**Preconditions:**
- There must be sufficient liquidity and collateral in the pool.
- A user (borrower) has an undercollateralized loan.
- Oracle (admin) can update prices.
- Liquidator is a separate user (multi-user interaction).

**Steps:**
- **POST `/api/lend/borrow`**: Create risky loan.
- **POST `/oracle/price`**: Crash collateral price.
- **GET `/api/lend/liquidate`**: Returns all liquidatable loans.
- **GET `/api/lend/liquidate/{id}`**: Returns details for a specific liquidatable loan.
- **POST `/api/lend/liquidate/{id}`**: Executes liquidation, expect balances updated.

---

## 8. Error Cases

- **POST `/api/lend/deposit`**: Negative amount, expect 400 error.
- **POST `/api/lend/withdraw`**: Negative amount, expect 400 error.
- **POST `/api/lend/borrow`**: Insufficient collateral, expect 400 error.
- **POST `/api/lend/repay`**: Over-repay, expect 200 OK, loan fully repaid.
- **POST `/api/lend/liquidate/{id}`**: Liquidate healthy loan, expect 400 error.

---

## 9. Profitability Checks

- **Lending:**
  - After deposit, borrow, repay, and withdraw, check that the lender's balance (including interest) is greater than initial deposit.
- **Liquidation:**
  - After liquidation, check that the liquidator's profit (collateral received minus debt paid) is positive.

---

## Multi-User Interactions

- **Liquidity Provider:** Supplies liquidity to the pool (deposits/withdraws).
- **Borrower:** Deposits collateral, borrows, repays, and withdraws collateral.
- **Liquidator:** Executes liquidations on unhealthy loans.
- **Oracle/Admin:** Updates prices to trigger liquidations or test edge cases.

---

## Endpoints Used (Summary)

- `GET /api/health`
- `GET /users/me`
- `GET /api/tokens/balance?key=eq.<address>`
- `POST /api/lend/deposit`
- `POST /api/lend/withdraw`
- `POST /api/lend/borrow`
- `POST /api/lend/repay`
- `POST /oracle/price`
- `GET /api/lend/liquidate`
- `GET /api/lend/liquidate/{id}`
- `POST /api/lend/liquidate/{id}`

---

**This plan covers all key lending and liquidation flows, error cases, profitability checks, and multi-user interactions, with preconditions noted for each scenario.**