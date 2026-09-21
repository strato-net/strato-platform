# Risk Management & Hedging

Keep USDST vaults and liquidity positions safe through price swings, using the tools the app actually has.

!!! warning "What STRATO does not offer"
    The STRATO app has **no** short positions, perpetual futures, options, stop-loss or limit orders, conditional or automated orders, and no built-in price or liquidation alerts. Hedging on STRATO means managing debt, collateral and asset mix yourself, and monitoring your positions.

---

## Know Your Liquidation Point

Liquidation on the **Borrow** page (USDST vaults, CDP) works per vault:

- **CR** = collateral value at the oracle price ÷ debt (debt grows with the per-asset stability fee).
- **Health Factor** (shown in the app) = CR ÷ the asset's liquidation ratio.
- When Health Factor falls **below 1.0**, any other user can liquidate the vault. They repay part of the debt (capped by the asset's close factor and by the collateral left) and receive collateral worth that repayment **plus a liquidation penalty**, valued at the oracle price. There is no grace period or auction.

For a vault whose debt stays constant:

```
Price drop that triggers liquidation = 1 − 1 / Health Factor
Liquidation price                    = current oracle price / Health Factor
```

Because the stability fee keeps adding to debt, Health Factor drifts down slowly even when prices don't move.

Mechanics and screenshots: [Mint USDST via CDP](../guides/mint-cdp.md). General safety: [Safety Guide](../safety.md).

---

## Tool 1: Reduce Debt

The simplest and most reliable hedge.

1. **Borrow** → your vault → **Repay USDST** (or **Repay All USDST**).
2. Partial repays can't leave debt below the asset's debt floor. If they would, repay all.

To restore a target Health Factor `h` after a price drop `d` (as a fraction), with pre-drop collateral value `C`, debt `D` and liquidation ratio `L`:

```
Repay needed R = D − C × (1 − d) / (h × L)      (none needed if R ≤ 0)
```

---

## Tool 2: Add Collateral

1. **Borrow** → your vault → **Deposit** more of the same asset.
2. Collateral only protects the vault for its own asset. Depositing ETH doesn't help a GOLDST vault.

Collateral value needed to reach target Health Factor `h` after the same drop:

```
Additional collateral value A = h × L × D − C × (1 − d)
```

---

## Tool 3: Hold a Buffer Outside the Vault

Keep USDST (or the vault's collateral asset) in your wallet so you can run Tool 1 or Tool 2 quickly. Size it with the formulas above for the drop you want to survive.

!!! note
    Minting extra USDST from a vault just to hold it as a buffer doesn't protect that vault. It raises the vault's debt by the same amount and lowers its Health Factor. A buffer works best when it comes from funds that aren't already borrowed.

---

## Tool 4: Spread Collateral Across Vaults

Because each asset has its own vault, a sharp drop in one asset only puts that asset's vault at risk.

- The **Mint** planner on **Borrow** can split a mint across several vaults at a target Health Factor.
- The planner's aggregate Health Factor can hide one weak vault. Always check each vault in the vault list.
- Each vault needs to meet its own debt floor and pays its own stability fee.
- Diversification doesn't help when the assets fall together.

To move existing collateral between vaults, see [Portfolio Rebalancing](portfolio-rebalancing.md).

---

## Tool 5: Reduce Volatile Exposure

- **Swap** part of a volatile holding into USDST on **Trade**.
- **Metals:** **Fund** → **Buy Metals** mints GOLDST or SILVST at the oracle price, less a mint fee. Metal tokens have their own price risk; they aren't stablecoins.
- **Liquidity positions:** withdraw from volatile pools if you don't want impermanent loss. A V3 position that goes out of range ends up holding just one of the two tokens. See [Provide Liquidity](../guides/liquidity.md).

---

## Monitoring Checklist

With no in-app alerts, set your own routine:

- [ ] Each vault's Health Factor on **Borrow** (the app highlights values below 1.5)
- [ ] Oracle prices of your collateral assets
- [ ] Stability fee per vault (it compounds into your debt)
- [ ] USDST and voucher balance for transaction fees (0.01 USDST or one voucher per transaction, charged even if it reverts). Running out blocks you from repaying or depositing.
- [ ] V3 positions: in range or out of range (**V3 Liquidity** → **My Positions**)

---

## Other Risks You Can't Hedge in the App

- **Oracle risk:** vault health and liquidations use oracle prices, which can differ from pool prices on **Trade**.
- **Smart contract risk:** contracts can have bugs; parameters and pause switches are controlled by the protocol's admins.
- **Bridge risk:** assets bridged from other chains depend on the bridge. See [Bridge Guide](../guides/bridge.md).
- **Liquidity risk:** thin pools mean high price impact when you need to exit.

---

## Next Steps

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Move collateral between vaults
- **[Leverage Long](leverage-long.md)** - Understand how leverage shortens your liquidation distance
- **[Exit Strategy](withdrawals.md)** - Close positions and withdraw
- **[Safety Guide](../safety.md)** - Security and risk overview

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
