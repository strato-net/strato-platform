# Hot Wallet Bridge Deployment Runbook

**PR:** [#6465 — Added support for hot wallets](https://github.com/strato-net/strato-platform/pull/6465)
**Related issue:** #6445 (Small withdrawals)
**Date:** 2026-03-16

---

## Overview

This deployment adds per-chain Safe hot wallet support to MercataBridge. Withdrawals at or below a configured threshold per chain/token pair are routed through a 1/N Safe hot wallet for immediate execution, bypassing the multi-sig approval flow. Withdrawals above the threshold continue using the existing multi-sig Safe.

---

## Pre-deployment: Create and Fund Safe Hot Wallet

### 1. Create Safe hot wallet

- Create a new Safe wallet with **1-of-N** signer threshold on [app.safe.global](https://app.safe.global)
- **Add and activate the Safe on all three production chains:**
  - Ethereum mainnet (chain ID `1`)
  - Base (chain ID `8453`)
  - Linea (chain ID `59144`)

### 2. Configure Safe owners

- Add the **bridge service account** as an owner (must be owner, not just proposer — the bridge executes hot wallet transactions immediately)
- Optionally add founders as additional owners

### 3. Fund the hot wallet

Fund the hot wallet address on **all three chains** with operational balances of:

| Token | Ethereum (1) | Base (8453) | Linea (59144) |
|-------|-------------|-------------|---------------|
| ETH   | _TBD_       | _TBD_       | _TBD_         |
| USDC  | _TBD_       | _TBD_       | _TBD_         |
| USDT  | _TBD_       | _TBD_       | _TBD_         |

> Fill in amounts based on expected hot wallet withdrawal volume. The hot wallet balance is checked at withdrawal time — if insufficient, the bridge falls back to the main Safe automatically.

Record the Safe hot wallet address: `<SAFE_HOT_WALLET_ADDRESS>`

---

## Step 1: Upgrade MercataBridge Contract on STRATO

Deploy the new base code collection and upgrade the MercataBridge proxy to pick up the new `hotWallet` field in `ChainInfo`, `useHotWallet` in `WithdrawalInfo`, `hotWithdrawalThresholds` mapping, and the `setHotWithdrawalThreshold` function.

```bash
# MercataBridge proxy is at address 1008
npm run upgrade -- \
  --proxy-address 1008 \
  --contract-name MercataBridge \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"_owner": "deadbeef"}' \
  +OVERRIDE-CHECKS
```

**Expected output:** `====== Upgrade Successful ======` or `Upgrade Pending` (if governance vote required — approve before continuing).

---

## Step 2: Call `setChain` for All Three Chains

The `setChain` function signature now includes the `hotWallet` parameter:

```solidity
function setChain(
    string chainName,
    address custody,
    address hotWallet,    // <-- NEW: Safe hot wallet address on this chain
    bool enabled,
    uint256 externalChainId,
    uint256 lastProcessedBlock,
    address router
) external onlyOwner
```

Call `setChain` for each chain, using the **existing config values** for `chainName`, `custody`, `enabled`, `externalChainId`, `lastProcessedBlock`, and `router` — and adding the hot wallet address.

> **Important:** Query the current `chains[chainId]` state for each chain before calling `setChain` to preserve existing values (especially `lastProcessedBlock`). Setting it to 0 or a stale value will cause the bridge to re-process old blocks.

```
MercataBridge(1008).setChain(
    <chainName>,           // existing value (e.g. "Ethereum")
    <custody>,             // existing custody address
    <SAFE_HOT_WALLET_ADDRESS>,  // new hot wallet address (same Safe on all chains)
    true,                  // enabled
    1,                     // Ethereum mainnet chain ID
    <lastProcessedBlock>,  // existing value — DO NOT reset
    <router>               // existing deposit router address
)
```

Repeat for:
- **Ethereum mainnet** — `externalChainId = 1`
- **Base** — `externalChainId = 8453`
- **Linea** — `externalChainId = 59144`

---

## Step 3: Call `setHotWithdrawalThreshold` for Each Asset on All Chains

```solidity
function setHotWithdrawalThreshold(
    uint256 chainId,      // external chain ID
    address token,        // external token address on that chain
    uint256 newThreshold  // max amount (in external token decimals) for hot wallet routing
) external onlyOwner
```

Withdrawals where `externalTokenAmount <= threshold` AND the chain has a hot wallet configured will be routed through the hot wallet.

### Thresholds to set

| Chain | Chain ID | Token | External Token Address | Threshold | Notes |
|-------|----------|-------|----------------------|-----------|-------|
| Ethereum | `1` | ETH | `0x0000000000000000000000000000000000000000` | _TBD_ | In wei (18 decimals) |
| Ethereum | `1` | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | _TBD_ | In USDC units (6 decimals) |
| Ethereum | `1` | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | _TBD_ | In USDT units (6 decimals) |
| Base | `8453` | ETH | `0x0000000000000000000000000000000000000000` | _TBD_ | In wei (18 decimals) |
| Base | `8453` | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54e0b3210` | _TBD_ | In USDC units (6 decimals) |
| Linea | `59144` | ETH | `0x0000000000000000000000000000000000000000` | _TBD_ | In wei (18 decimals) |
| Linea | `59144` | USDC | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | _TBD_ | In USDC units (6 decimals) |
| Linea | `59144` | USDT | _TBD_ | _TBD_ | |

> Example: To set a $100 USDC threshold on Base:
> `setHotWithdrawalThreshold(8453, 0x833589fCD6eDb6E08f4c7C32D4f71b54e0b3210, 100000000)`
> (100 * 10^6 = 100000000)

Add rows for any other bridged assets (WBTC, wstETH, rETH, etc.) as needed.

---

## Step 4: Update Bridge Server Config

Add the `SAFE_HOT_WALLET_ADDRESS` environment variable to the bridge service deployment config:

```bash
SAFE_HOT_WALLET_ADDRESS=<hot wallet address from Step 0>
```

This is read by the bridge service at `mercata/services/bridge/src/config/index.ts`:
```typescript
safe: {
    address: process.env.SAFE_ADDRESS,           // existing multi-sig
    hotWalletAddress: process.env.SAFE_HOT_WALLET_ADDRESS,  // new hot wallet
    ...
}
```

---

## Step 5: Deploy New Bridge Service Version

Upgrade the bridge service to the version containing the hot wallet changes (from the `hot-wallet` branch, merged in PR #6465).

```bash
# Update bridge image version in docker-compose and redeploy
# The template is in docker-compose.bridge.tpl.yml
```

---

## Verification Checklist

- [ ] Safe hot wallet created as 1/N on Ethereum, Base, and Linea
- [ ] Bridge service account is an **owner** (not just proposer) on the Safe
- [ ] Hot wallet funded with ETH + tokens on all three chains
- [ ] MercataBridge contract upgraded at proxy `1008`
- [ ] `setChain` called for chain IDs `1`, `8453`, `59144` with hot wallet address
- [ ] `setHotWithdrawalThreshold` called for each token on each chain
- [ ] `SAFE_HOT_WALLET_ADDRESS` set in bridge service environment
- [ ] Bridge service redeployed with new version
- [ ] Smoke test: small withdrawal (below threshold) routes through hot wallet and executes immediately
- [ ] Smoke test: large withdrawal (above threshold) routes through main Safe multi-sig as before
- [ ] Verify `HotWithdrawalThresholdUpdated` events emitted on-chain for each threshold set
- [ ] Verify `ChainUpdated` events include hot wallet address for each chain

## Rollback

- **Contract:** `setHotWithdrawalThreshold` can be set to `0` for any chain/token to disable hot wallet routing for that pair. Setting all thresholds to 0 effectively disables the feature without a contract downgrade.
- **Per-chain:** `setChain` can be called with `hotWallet = address(0)` to remove the hot wallet for a specific chain.
- **Bridge service:** Remove `SAFE_HOT_WALLET_ADDRESS` from env and redeploy — the bridge will treat all withdrawals as multi-sig.
