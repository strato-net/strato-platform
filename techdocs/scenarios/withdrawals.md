# Withdrawals: Bridge Assets Out

Move tokens from STRATO to an external EVM network with the **Bridge Out** page.

!!! warning "Bridge-outs are reviewed, not instant"
    Every request is escrowed on STRATO and processed by bridge operators. The app states that bridge outs are **processed within 1-3 business days**. Once submitted, a request can't be edited, so double-check the destination address.

---

## What You Can Bridge Out

Only tokens **in your STRATO wallet** that have a bridge route to the destination network. Positions must be closed first:

| Position | How to free the tokens |
|----------|------------------------|
| CDP collateral | **Borrow → Your Vaults**: **Repay USDST** / **Repay All USDST**, then **Withdraw** / **Withdraw Max** |
| Swap pool liquidity | **Advanced → Swap Pools**: **Withdraw Liquidity** |
| V3 liquidity | **V3 Liquidity** page: withdraw the position |
| USDST Savings Vault | **Earn → USDST Savings Vault**: **Withdraw** |
| Unclaimed rewards | **Rewards**: claim |

You can bridge out free tokens and leave other positions open. If a vault still has debt, collateral withdrawals must keep it above its minimum collateralization ratio.

---

## How Bridge-Out Works

STRATO has two bridge routes. The app picks the right one for the token.

**Standard route** (assets that came from external chains, such as ETH, WBTC, USDC and USDT):

1. Your tokens are escrowed in the STRATO bridge contract.
2. The bridge relayer prepares the payout as a **Safe multisig transaction** from bridge custody on the destination network.
3. Once the multisig approves and executes it, the tokens are sent to your address and the escrow on STRATO is burned.

**Native route** (STRATO-native tokens such as USDST, GOLDST, SILVST, STRATO and saveUSDST, bridged to Ethereum):

1. Your tokens are locked in STRATO's custody vault.
2. A representation token is minted to your address on the destination network. Assets can have an instant lane for amounts under a per-asset threshold, which executes after a review delay. Anything else waits for manual Safe approval.

Either way, there is **no claim step** for you on the destination network: the tokens arrive at the address you bridged to.

---

## Step-by-Step

1. In the sidebar, open **Bridge Out**.
2. Click **Connect External Wallet**. Tokens go to **this wallet's address**.
3. Select the token.
4. To change the destination network, open the advanced options below the button.
5. Enter the amount. **Max** already allows for the transaction fee and any per-withdrawal limit. If the page shows "bridge capacity reached", withdrawals for that token are temporarily full.
6. Click **Bridge Out**, review the confirmation, then click **Yes, Bridge Assets**.

**Fees:** The request costs STRATO transaction fees (0.01 USDST or one voucher per call; the app budgets 0.02 USDST for approve + request). See [Transactions and Fees](../platform/transactions-and-fees.md).

### Tracking

- **Bridge Out Summary** shows your pending bridge-outs and total bridged out over 30 days.
- **Bridge Out History** lists each request and its status.
- **View Transactions** opens the full bridge transaction history.

!!! note "Stuck requests"
    On the standard route, if a request is still unprocessed 48 hours after you submitted it, the bridge contract lets the sender abort and get the escrowed tokens back. The app has no button for this, so contact support.

---

## Exiting to Stablecoins

On the native route, USDST bridges out as USDST. To receive USDC or USDT instead:

1. Convert first: redeem USDST on **Advanced → PSM** (subject to available redemption liquidity and the fee shown), or swap on **Trade**.
2. Bridge out the USDC or USDT, choosing a network where that token has a route.

---

## Example: Partial Exit

You have an ETH vault with USDST debt, plus free ETH and USDST in your wallet.

- **Keep the vault open:** Bridge out only the free ETH (standard route) and convert the free USDST to USDC before bridging it out.
- **Full exit:** Repay all USDST, withdraw the ETH collateral, then bridge everything out.

---

## Troubleshooting

**Bridge Out button is disabled**

- No external wallet connected, no token or network selected, the amount is invalid, or bridge capacity is reached.
- Not enough USDST or vouchers for the fee.

**Can't withdraw vault collateral**

- Repay debt first, or withdraw less so the vault stays above its minimum collateralization ratio.

**Request is taking a long time**

- Requests stay pending until reviewed and executed. Check **Bridge Out History**. If it is past the stated processing window, contact support with the request details.

---

## Related

- [Bridge Guide](../guides/bridge.md)
- [Mint USDST (CDP) Guide](../guides/mint-cdp.md)
- [Liquidity Guide](../guides/liquidity.md)
- [Safety Guide](../safety.md)

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
