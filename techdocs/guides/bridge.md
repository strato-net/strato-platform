# Bridge Assets

Move tokens between external EVM chains and STRATO.

In the app, bridging in lives on **Fund** and bridging out lives on **Bridge Out**. Both are in the sidebar under **TRADE**.

!!! info "Networks and assets change"
    The Fund and Bridge Out pages list the networks and tokens currently enabled on-chain. Use those lists as the source of truth.

---

## Supported Networks

When this page was written (September 2026), the bridge contract had these external chains enabled:

| STRATO network | External chains |
|---|---|
| **Mainnet** ([app.strato.nexus](https://app.strato.nexus)) | Ethereum, Base, Linea, Robinhood Chain, HyperEVM |
| **Testnet** ([app.testnet.strato.nexus](https://app.testnet.strato.nexus)) | Ethereum Sepolia, Base Sepolia, Robinhood Chain Testnet, HyperEVM |

Each asset is enabled per chain. A token may be bridgeable from one chain and not another.

---

## Fees

- **On the external chain** you pay that chain's gas from your external wallet (approval plus deposit).
- **On STRATO** every transaction costs **0.01 USDST, or one voucher if you hold one**. Bridging out takes STRATO transactions (approval plus request), and the Transaction Summary shows the fee.
- **Deposit actions** (auto-save, auto-forge) and **Buy Metals** show any conversion fee on their cards before you confirm.
- **Vouchers:** when a bridge-in deposit is confirmed, the bridge service mints transaction vouchers to the recipient (currently 25 per confirmed deposit). Vouchers can't be transferred. See [Transaction Vouchers](../concepts.md#transaction-vouchers).
- A STRATO transaction pays its fee **even if it reverts**.

---

## Bridge In (Fund)

1. Open **Fund**. Under **How Are You Funding?**, choose **Bridge In** (the card lists the enabled networks). **Buy Metals** is covered at the end of this section.
2. Click **Connect External** and connect the wallet that holds the tokens, for example MetaMask.
3. Pick the source network and the token you're sending, and enter the amount in **You Send**.
4. Choose what you receive. Each card shows the estimated amount:
    - **The bridged token** itself. On mainnet, bridged tokens keep their usual symbols (for example ETH, WBTC, sUSDS). Stablecoin routes can deliver USDST.
    - **Auto-save:** the deposit is converted to USDST and put in the USDST Savings Vault, and you receive **saveUSDST**
    - **Auto-forge:** the deposit is converted into a metal token such as GOLDST or SILVST through MetalForge

    Auto-save and auto-forge appear only for routes and chains that support them.

5. Click **Deposit**, or **Redeem to STRATO** for a native-token route (see [Native STRATO Tokens](#native-strato-tokens)). Approve the token if prompted, then confirm the deposit in your external wallet.
6. Follow progress in **Recent Transactions** next to the form.

!!! warning "Rebasing tokens"
    For rebasing tokens the app shows a notice. The amount you receive on STRATO reflects your underlying share at the current rebase multiplier, so it can differ from the token quantity you sent.

### What Happens Behind the Scenes

1. Your deposit goes to the bridge's deposit contract on the external chain.
2. The bridge relayer sees it and records it on STRATO's `MercataBridge` contract (**Initiated**). Each external transaction can be recorded only once.
3. The relayer verifies the deposit:
    - **If it checks out:** the deposit is confirmed and the tokens (or USDST) are minted to your STRATO address (**Completed**).
    - **If it doesn't:** the deposit is held for manual review (**Pending Review**) and later confirmed or aborted.

### Buy Metals

**Buy Metals** ("Gold, Silver & more") uses tokens you already hold on STRATO to mint a metal token through MetalForge. It does not bridge. The card shows the spot price and fee.

---

## Bridge Out

1. Open **Bridge Out**.
2. Click **Connect External Wallet**. That wallet's address is where the tokens will be sent.
3. Choose the destination network and token, and enter the **Amount**.
4. Check the summary:
    - **Transaction Fee**
    - **Max Per Withdrawal**: a per-transaction cap set for the route
    - **Outcome**
5. Click **Bridge Out** and confirm in **Confirm Bridge Transaction**.

The app confirms the request is **pending approval**. The **Bridge Out Summary** shows **Total Bridged Out (30d)** and **Pending Bridge Outs**, and **Bridge Out History** lists your requests.

!!! note "Bridge outs are not instant"
    The app states that bridge outs are processed within 1-3 business days and depend on available liquidity. Double-check the destination address: transfers on the external chain can't be reversed.

### What Happens Behind the Scenes

1. Your tokens move into escrow in `MercataBridge` (**Initiated**).
2. The relayer builds the payout transaction on the external chain (**Pending Review**):
    - **Small withdrawals:** at or under a per-token threshold, and only on chains with a hot wallet configured, the payout can come from that operational hot wallet.
    - **All other withdrawals:** proposed to the bridge's **Safe multisig custody wallet** and executed only after the Safe's signers approve.
3. Once the payout executes, the withdrawal is finalized and the escrowed tokens are burned (**Completed**).
4. A withdrawal that isn't processed can be **Aborted**, which refunds the escrowed tokens to you. The contract lets you abort your own request only if it is still **Initiated** 48 hours after you made it. The app has no button for this, so contact support.

---

## Native STRATO Tokens

Tokens that originate on STRATO use a separate native bridge (`StratoNativeBridge`). When this page was written, the native route to Ethereum covered USDST, GOLDST, SILVST, STRATO and saveUSDST.

- **Bridging out** locks the token in a STRATO custody vault. A representation token is then minted on the external chain after an attestation. Amounts under the route's instant threshold go through after a fixed delay; larger ones need approval through the external chain's admin Safe.
- **Bridging in** ("Redeem to STRATO") burns the representation token on the external chain and unlocks the original on STRATO.

---

## Tracking and Statuses

Open **View Transactions** (on Bridge Out) or the transaction links on Fund to see all bridge activity.

| Status | Meaning |
|---|---|
| **Initiated** | Recorded on STRATO, waiting for the relayer |
| **Pending Review** | Deposit: held for manual verification. Withdrawal: payout proposed or in progress on the external chain. |
| **Completed** | Finished |
| **Aborted** | Cancelled. Escrowed withdrawal tokens are refunded. |

---

## Trust Model

- The bridge depends on an **off-chain relayer** to observe deposits and execute payouts. STRATO does not run a light client of the external chains.
- **External-chain funds** are held in a Safe multisig custody wallet, plus an optional hot wallet for small payouts on some chains.
- **Admins** (STRATO governance through `AdminRegistry`) can pause deposits and withdrawals separately, set per-route limits and the relayer, and in an incident move in-flight withdrawal escrow to a triage wallet.

See [Safety](../safety.md#bridge-risk).

---

## Common Issues

| Problem | What to do |
|---|---|
| Deposit shows **Pending Review** | It's held for manual verification. Contact support with your external transaction hash if it stays there. |
| Bridge out still pending | Bridge outs can take up to the processing window shown in the app. Check **Bridge Out History**, then contact support with the request details. |
| "Bridge capacity reached" | The route's limit is currently reached. Try a smaller amount or later. |
| Token or network missing | That route isn't enabled. Check again later or use another chain. |

---

## Next Steps

- **[Borrow USDST](borrow.md):** use bridged assets as collateral
- **[Swap Tokens](swap.md):** trade bridged assets
- **[Manage Rewards](rewards.md):** USDST Savings Vault and reward activities

**Support:** [support.blockapps.net](https://support.blockapps.net)
