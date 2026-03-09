# Crypto Credit Card – Design

## Overview

Allow users to link a **card wallet** (e.g. a single-admin SAFE or EOA on an external chain) and **automatically top it up** when the balance falls below a threshold. Top-up is done by bridging USDST from STRATO to the card wallet’s chain; optionally the system can **borrow USDST** against the user’s collateral first, then bridge.

## Components

### 1. Card wallet (destination chain)

- **Single-admin SAFE** (or any EOA) on the chain chosen by the user/card provider.
- The credit card provider debits this wallet for card purchases (off-chain rails; the wallet is the source of funds on-chain).
- No new contract required from us: user **links** an existing address (SAFE or EOA) in the UI.

### 2. STRATO: approved bridge-out (CreditCardTopUp contract)

- **Purpose:** Let the backend (relayer) trigger a bridge-out **without the user signing** each time, using a prior ERC‑20 approval.
- **Card storage on-chain:** Card metadata (nickname, provider, network, token, card wallet address) is stored in the contract per user: `mapping(address => CardInfo[]) public userCards`. Users call **addCard**, **updateCard**, or **removeCard** to manage their list; the app reads **getCards(user)** from Cirrus and calls add/update/remove when the user saves or removes a card, then re-fetches to refresh the grid.
- **Flow:**
  1. User approves **CreditCardTopUp** to spend USDST (or the relevant STRATO token) up to a limit.
  2. User configures card wallet (chain + address), threshold, and optionally “borrow then bridge”.
  3. When the service decides to top up, it calls **CreditCardTopUp.topUpCard(user, amount, destChainId, destAddress, externalToken)**.
  4. Contract: `transferFrom(user, this, amount)` → `approve(MercataBridge, amount)` → **MercataBridge.requestWithdrawal(destChainId, destAddress, externalToken, amount)**.
- **Access control:** Only a designated **operator** (relayer backend) can call `topUpCard`; owner sets the operator. Only `msg.sender` can add/update/remove their own cards.
- **Security:** User only risks the allowance they grant to CreditCardTopUp; no custody of funds by the protocol beyond the existing bridge flow.

### 3. Backend service

- **Config API:** Persist per-user settings:
  - Linked card wallet: `chainId`, `address`
  - Threshold (e.g. “top up when balance &lt; $100”)
  - Use borrow: yes/no (borrow USDST against collateral, then bridge)
  - Frequency / cooldown (e.g. check every 15 minutes; max one top-up per hour)
- **Balance watcher:** For each user with a linked card wallet:
  - Resolve the correct external token (e.g. USDC) and decimals for that chain.
  - Poll or subscribe to the card wallet’s balance on that chain.
  - When `balance < threshold` (in USD or in token units), call the STRATO **CreditCardTopUp** contract (as operator) to perform the top-up for that user, for a configured amount (e.g. bring balance to a target).
- **Borrow path (optional):** If “borrow then bridge” is enabled:
  - Ensure user has sufficient collateral and borrowing capacity.
  - Call lending contract to borrow USDST to the user (or to the CreditCardTopUp contract), then perform the same bridge-out (either from user’s balance after borrow, or from contract if we support that flow). Exact sequence depends on lending API (borrow to user vs to contract).

### 4. UI tab: Crypto Credit Card

- **Onboarding / wallet management**
  - Connect or paste the **card wallet address** (destination chain).
  - Select **chain** (Ethereum, Polygon, etc. – from existing bridge config).
  - Show current balance on that chain (read-only).
- **Settings**
  - **Threshold:** “Top up when balance below” (USD or token amount).
  - **Target amount:** “Top up to” (optional) or “Top up by” (fixed amount per run).
  - **Use borrow:** Toggle “Borrow USDST against my collateral, then bridge” (if enabled, backend uses borrow path when doing top-up).
  - **Frequency:** Dropdown (e.g. “Check every 15 min”, “Every hour”, “Daily”) and/or cooldown between top-ups.
- **Approval**
  - Button to grant ERC‑20 approval to **CreditCardTopUp** for USDST (with suggested cap or “unlimited” and clear copy).
- **Status**
  - Last top-up time, last checked balance, next check (if applicable), and any error message (e.g. “Insufficient collateral to borrow”).

## Data model (backend)

- **Credit card config** (per user, one per linked wallet or one global):
  - `userAddress` (STRATO)
  - `destinationChainId`
  - `cardWalletAddress`
  - `thresholdAmount` (wei or human units)
  - `topUpAmount` or `targetBalance` (amount to send per top-up or target balance)
  - `useBorrow` (boolean)
  - `checkFrequencyMinutes` / `cooldownMinutes`
  - `enabled` (boolean)
  - `lastTopUpAt`, `lastCheckedAt`, `lastError`

## Security and ops

- Operator key (relayer) must be restricted and rotated via contract `setOperator`.
- User approvals are limited to the CreditCardTopUp contract; the bridge and custody flow are unchanged.
- Rate limits and max top-up per day per user can be enforced in the service and/or in the contract (e.g. cap per `topUpCard` call).

## Implementation notes

- **Contract:** `CreditCardTopUp.sol` in `mercata/contracts/concrete/Bridge/`. Deploy and set `mercataBridge` and `operator`; set backend env `CREDIT_CARD_TOP_UP_ADDRESS`.
- **Backend:** Config stored in-memory (production should use a DB). Env: `CREDIT_CARD_TOP_UP_ADDRESS`, optional `OPERATOR_ACCESS_TOKEN` (for watcher), optional `EXTERNAL_CHAIN_RPC_URLS` (JSON map of chainId -> rpcUrl for balance checks). Run balance watcher periodically (e.g. cron) by calling `runBalanceWatcher(operatorAccessToken)` from `creditCard.service`.
- **UI:** Tab "Crypto Credit Card" under dashboard More; page at `/dashboard/credit-card`. Cards are **stored on-chain** in CreditCardTopUp: the app reads **getCards(user)** from Cirrus on load, and calls **addCard** / **updateCard** / **removeCard** when the user adds, edits, or removes a card, then re-fetches to refresh the grid. Supported card providers: **MetaMask Card** (Linea, Solana, Base / Base Sepolia) and **Ether.fi Card** (Base / Base Sepolia). Tokens per network in `lib/creditCard/providers.ts`. Balance is fetched via GET `/credit-card/balance?destinationChainId=...&externalToken=...&cardWalletAddress=...`.
- **Bridge – USDT on Base:** To support USDT on Base (and Base Sepolia), the MercataBridge owner must call `setAsset(enabled, externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken)` for the USDT contract on that chain. On Base mainnet (8453), bridged USDT is at `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` (6 decimals). Use the STRATO-side token that mints/burns for USDT; configure the matching external token address for Base Sepolia (84532) if needed. Once the asset is enabled, the credit card flow will show USDT as a supported token for Base and top-ups will work.

## Out of scope for v1

- Deploying or managing the SAFE on the destination chain (user brings their own wallet).
- Card provider integration (we only fund the wallet; how the provider debits it is external).
- Borrow path can be a follow-up if lending does not expose “borrow to operator” or “borrow and then transfer” in one shot.
