# First-Time User Journey

Get assets onto STRATO, cover your transaction fees, and mint your first USDST.

---

## What You Need

- An EVM wallet (for example MetaMask) holding assets on a supported network
- A browser at [app.strato.nexus](https://app.strato.nexus)

## How Fees Work on STRATO

Every STRATO transaction pays a flat fee: **one voucher** if you hold one, otherwise **0.01 USDST**. Many app actions send two calls (approve + action), so a confirmation can show 0.02 USDST. Your USDST and voucher balances are shown in the **USDST Balance** box in the corner of the app. See [Transactions and Fees](../platform/transactions-and-fees.md).

!!! tip "You don't need USDST before your first deposit"
    The bridge relayer submits the STRATO side of a bridge-in deposit for you. When your deposit is confirmed, it also mints vouchers to your STRATO account (25 per deposit in the current relayer), which is enough to pay for your first transactions.

---

## Step 1: Sign In

1. Open [app.strato.nexus](https://app.strato.nexus) and click **Connect Wallet**.
2. Sign in with a STRATO account or connect an EVM wallet.

Bridging in also needs your **external wallet** (the one holding funds on the source network) connected. The Fund page prompts you for it.

---

## Step 2: Bridge Assets In

1. In the sidebar, open **Fund** and select **Bridge In**.
2. Under **Choose Network**, pick the network your funds are on. On mainnet the bridge is enabled for Ethereum, Base, Linea, HyperEVM and Robinhood Chain; the selector always shows the current list.
3. Under **You Send**, pick the asset and amount. The app asks your wallet to switch networks if needed.
4. Under **You Receive On STRATO**, pick what arrives. Depending on the asset and network, the options can include:
    - The bridged token itself (for example ETH or WBTC)
    - **USDST**, for supported stablecoins
    - **saveUSDST**, which deposits straight into the USDST Savings Vault
    - **GOLDST** or **SILVST**, bought on arrival (the fee is shown on the card)
5. Click **Deposit** and confirm in your wallet. You pay the source network's gas.
6. Track progress in the **Recent Transactions** panel. Tokens (and vouchers) arrive after the relayer confirms the deposit.

For supported assets and mechanics, see the [Bridge Guide](../guides/bridge.md).

**Other ways to get funds:**

- **Buy Crypto** (`/dashboard/onramp` on app.strato.nexus): pay by card, bank transfer or Apple Pay through Stripe; the purchased crypto is credited to your STRATO account.
- **Send**: another STRATO user can send tokens to your STRATO address.

---

## Step 3: Mint USDST Against Collateral (Optional)

The **Borrow** page mints USDST from collateralized debt positions (CDP vaults).

1. Open **Borrow**. The **Mint against collateral (CDP)** panel appears.
2. Enter a **Mint Amount**. By default the app allocates the required collateral from your eligible wallet balances; you can switch this off and set deposit and mint amounts per vault.
3. Use the risk slider (**Riskier** / **Safer**) to set your safety buffer. Check **Projected Vault Health** and the **Stability Fee**.
4. Click **Mint**. The app sends the collateral deposit transaction(s) first, then the mint transaction(s).

Your position appears under **Your Vaults** with its collateral, debt and **Health Factor**.

!!! example "Illustrative example (hypothetical prices and parameters)"
    You deposit 1 ETH worth $3,000 into a vault with a 150% liquidation ratio and mint 1,000 USDST.

    - Collateralization ratio (CR) = $3,000 / $1,000 = 300%
    - Health factor = CR / liquidation ratio = 300% / 150% = **2.0**
    - The vault becomes liquidatable if ETH falls below $1,500 (health factor 1.0)

**Keep in mind:**

- Health factor below 1.0 means the vault can be liquidated, and a liquidation penalty is taken from your collateral.
- The stability fee accrues continuously, so your debt grows over time.
- Each collateral asset has its own vault and its own parameters, shown in the app.

See the [Mint USDST (CDP) Guide](../guides/mint-cdp.md).

---

## What Next

- **Trade**: swap USDST for other tokens on the **Trade** page. See the [Swap Guide](../guides/swap.md).
- **Earn**: deposit USDST in the **USDST Savings Vault** (Earn page) or add liquidity under **Advanced → Swap Pools**. See [Maximize Yield](maximize-yield.md) and the [Liquidity Guide](../guides/liquidity.md).
- **Rewards**: eligible positions accrue Reward Points. See the [Rewards Guide](../guides/rewards.md).
- **Exit**: see [Withdrawals](withdrawals.md).

---

## Troubleshooting

**Deposit hasn't arrived**

- Confirm the source-network transaction succeeded in that network's block explorer.
- Check **Recent Transactions** on the Fund page.
- If it's still missing, contact support with the transaction hash.

**Not enough balance for the transaction fee**

- You need one voucher or 0.01 USDST per call. Bridge in a supported stablecoin and receive USDST, swap for USDST, or mint USDST on the Borrow page.

**Health factor is dropping**

- In **Borrow → Your Vaults**, deposit more collateral or repay USDST.

---

## Get Help

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- [Core Concepts](../concepts.md) · [Safety Guide](../safety.md) · [FAQ](../faq.md)
