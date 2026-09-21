# Maximize Yield

Put USDST and other assets to work across STRATO's earning products.

!!! warning "Rates are variable"
    STRATO does not promise fixed returns. APYs, stability fees, swap volume and reward emissions all change. The app shows current figures on each page. Any numbers below are illustrative.

---

## Where Yield Comes From

| Source | Where in the app | What you earn |
|--------|------------------|---------------|
| USDST Savings Vault | **Earn → USDST Savings Vault** | Deposit USDST and receive saveUSDST shares, which grow as the protocol adds savings yield |
| Swap pool liquidity | **Advanced → Swap Pools**, **V3 Liquidity** | A share of swap fees (standard pools default to a 0.3% fee, 70% of it to LPs) |
| Yield vaults | **Earn** (listed under All Opportunities) | Vault-specific yield. Vaults not yet live show "Coming Soon". |
| Staking | **Stake** | Rewards for staking STRATO with validators |
| Reward Points | **Rewards** | Emissions to eligible positions (LP, savings, vaults and others) |

Which positions currently earn Reward Points, and at what rate, is listed under **Rewards → Activities**. Some activities have emissions switched off.

---

## Strategy: Mint USDST, Then Earn on It

If you hold assets you want to keep, you can mint USDST against them and deposit the USDST into an earning product. This is only profitable while **earn yield + reward value > stability fee + fees**.

### Step 1: Mint USDST

1. Open **Borrow**, enter a **Mint Amount**, and keep the risk slider toward **Safer**.
2. Note the vault's **Stability Fee**. That is your cost of capital.
3. Click **Mint**.

See the [Mint USDST (CDP) Guide](../guides/mint-cdp.md).

### Step 2a: Deposit in the Savings Vault (simplest)

1. Open **Earn** and select **USDST Savings Vault**.
2. Click **Deposit**, enter an amount, and confirm.
3. Withdraw at any time from the same page (unless the vault is paused).

### Step 2b: Or Provide Liquidity

1. Open **Advanced → Swap Pools** and pick a pool. Stablecoin pools (for example USDT-USDC-USDST or sUSDS-USDST) carry less impermanent-loss risk than volatile pairs.
2. Get the pool's tokens with **Trade**, or use **Advanced → PSM** to mint USDST from USDC/USDT or redeem USDST back to them.
3. Click **Deposit Liquidity**, enter amounts, and confirm. You receive LP tokens.

For concentrated liquidity, use **V3 Liquidity**. See the [Liquidity Guide](../guides/liquidity.md).

### Step 3: Claim Rewards

Open **Rewards**. Click **Claim All** at the top of the page, or claim per activity on the **My Active Positions** tab. See the [Rewards Guide](../guides/rewards.md).

!!! example "How to estimate net yield (illustrative)"
    Mint 10,000 USDST from a vault with stability fee *f*, and deposit it where it earns APY *a* plus reward value *r*:

    Net annual yield ≈ 10,000 × (*a* + *r* − *f*) − transaction fees − swap costs

    If *a* + *r* is below *f*, the strategy loses money even though your collateral is untouched.

---

## Skip the Minting Step

If you already hold stablecoins on another network, you can bridge them straight into the Savings Vault. On **Fund → Bridge In**, choose **saveUSDST** under **You Receive On STRATO**. This avoids CDP debt and liquidation risk entirely.

---

## Risks

- **Liquidation:** Your CDP vault can be liquidated if its collateral price falls, regardless of how the USDST is earning. Watch the health factor on **Borrow → Your Vaults**.
- **Impermanent loss:** LP positions in volatile pairs can underperform simply holding the tokens.
- **Variable rates:** Savings yield, swap volume and reward emissions can fall below your stability fee.
- **Pauses and limits:** Vaults, pools and the PSM can be paused, and PSM redemptions depend on available liquidity.
- **Smart contract risk.**

See the [Safety Guide](../safety.md).

---

## Exit

1. Withdraw from the Savings Vault, or click **Withdraw Liquidity** on your pool.
2. Claim any remaining rewards.
3. On **Borrow → Your Vaults**, click **Repay All USDST**, then **Withdraw Max** on your collateral.
4. Optionally bridge assets out. See [Withdrawals](withdrawals.md).

---

## Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
