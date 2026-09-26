# Dollar-Cost Averaging (DCA)

Build a position gradually by buying a fixed dollar amount on a regular schedule, whatever the price.

!!! note "DCA on STRATO is manual"
    The STRATO app has no recurring buys, scheduled orders or limit orders. You repeat the steps below yourself at whatever interval you choose.

---

## Why DCA

- You don't need to time the market.
- You buy more units when prices are low and fewer when they are high.
- Your average cost per unit ends up below the simple average of the prices you paid.

!!! example "Illustrative example (hypothetical prices)"
    | Purchase | Price | Amount | Units bought |
    |----------|-------|--------|--------------|
    | 1 | $3,000 | $500 | 0.1667 |
    | 2 | $2,500 | $500 | 0.2000 |
    | 3 | $2,000 | $500 | 0.2500 |
    | **Total** | | **$1,500** | **0.6167** |

    Average cost = $1,500 / 0.6167 ≈ **$2,432**, below the $2,500 average price.

DCA does not prevent losses: if the price keeps falling, the position is still worth less than you paid.

---

## Each Cycle

### 1. Fund Your Account

- **Bridge in:** Open **Fund → Bridge In**, choose your network and a stablecoin, and under **You Receive On STRATO** choose **USDST**. Each confirmed deposit also mints vouchers to your account for transaction fees. See the [Bridge Guide](../guides/bridge.md).
- **Or buy with a card or bank:** Use the Buy Crypto page (`/dashboard/onramp` on app.strato.nexus).

Every bridge deposit pays gas on the source network, so fewer, larger deposits cost less in gas than many small ones.

### 2. Buy the Asset

- **Tokens:** Open **Trade** and swap a fixed amount of USDST for your target asset (for example ETH or WBTC). Check **Price Impact** and **Minimum received**. See the [Swap Guide](../guides/swap.md).
- **Gold or silver:** Open **Fund → Buy Metals** to buy GOLDST or SILVST directly. The fee is shown before you confirm.

### 3. Put Holdings to Work (Optional)

- Deposit spare USDST in **Earn → USDST Savings Vault**.
- Or use accumulated assets as collateral on **Borrow**. Depositing collateral without minting carries no liquidation risk.

### 4. Record It

Note the date, amount and price. The **Activity Feed** page lists your past transactions.

---

## Cost per Cycle

| Cost | Paid in |
|------|---------|
| Bridge deposit gas | Source network's gas token; varies with congestion |
| STRATO transaction fees | 0.01 USDST or one voucher per call |
| Swap fee | Deducted from the trade (0.3% default on standard pools; varies by pool) |
| Price impact | Larger trades in thinner pools get worse prices |

Fixed per-deposit costs matter more for small amounts. Size your cycles so fees stay a small fraction of each purchase.

---

## Variations

- **Yield-focused:** Put part of each cycle into the USDST Savings Vault or a stablecoin pool. See [Maximize Yield](maximize-yield.md).
- **Leveraged:** Mint USDST against accumulated collateral to buy more. This adds liquidation risk. See [Grow Your Position](grow-position.md).
- **Gradual exit:** Reverse the process. Periodically trade a fixed amount back to USDST and bridge out. See [Withdrawals](withdrawals.md).

---

## Related

- [Portfolio Rebalancing](portfolio-rebalancing.md)
- [Risk Hedging](risk-hedging.md)
- [Safety Guide](../safety.md)

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
