# Bridge Service — Operations Runbook

Step-by-step procedures for adding and removing chains and assets. Use this when onboarding a new network or a new token.

- For **how the service works** → [FLOW.md](FLOW.md)
- For **config and deployment** → [README](../README.md)

---

## Contents

- [Add a chain](#add-a-chain)
- [Remove a chain](#remove-a-chain)
- [Add an asset](#add-an-asset)
- [Remove an asset](#remove-an-asset)

---

> **Note:** The authoritative registry of chains and assets lives on-chain in `MercataBridge.chains` and `MercataBridge.assets`. The service discovers both dynamically via Cirrus every cycle, so there is no "register in the service" step. The two local knobs are `.env` (per-chain RPC URLs, credentials) and restart. For replay, cursor rewind, and stuck-deposit recovery, see [FLOW.md § State, idempotency, and recovery](FLOW.md#state-idempotency-and-recovery).

---

## Add a chain

Use when you want to start bridging a new EVM chain (Base, Arbitrum, another testnet, etc.). Assumes the DepositRouter contract is already deployed on that chain and its address is known.

### 1. Register the chain on-chain (admin vote)

> **Admin on-chain call**
>
> - **Contract:** `MercataBridge` (`BRIDGE_ADDRESS`)
> - **Function:** `setChain(string chainName, address custody, address hotWallet, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router)`

Example args:

- `chainName`: `"Base"`
- `custody`: the Safe address on that chain (external format, `0x…`).
- `hotWallet`: the hot-wallet Safe address on that chain, or `0x0000…0000` if none.
- `enabled`: `true`.
- `externalChainId`: the chain's EVM id (e.g. `8453` for Base mainnet).
- `lastProcessedBlock`: starting block to scan from (`0` for full history, or a recent block to skip historical scan).
- `router`: the DepositRouter contract address on that chain.

Admin UI → Vote On Issues → Create New Issue → select `setChain`, fill args, approve.

### 2. Add the RPC URL to the service env

```bash
CHAIN_<externalChainId>_RPC_URL=https://eth-<network>.g.alchemy.com/v2/<key>
```

Any RPC endpoint that supports `eth_getLogs`, `eth_blockNumber`, `eth_getTransactionReceipt`, and internal-trace equivalents works.

> **Note:** `configValidator` will refuse to start if the new chain's RPC URL is missing. A non-OK `eth_blockNumber` response is a warning, not a hard error.

### 3. Restart the service

### 4. Verify

- Startup: `ConfigValidator Found N enabled chains` with N incremented.
- First `AlchemyPolling` cycle logs per-chain activity; `data/lastProcessedBlocks.json` gets an entry for the new chain id.
- Send a small test deposit on the new chain via its DepositRouter. Within one `bridgeInInterval` cycle:
  - `BridgeService Successfully deposited 1 deposits`
  - `Verification ERC20 check …` (or ETH path)
  - `BridgeService Successfully confirmed 1 deposits`
  - `VoucherService Successfully minted 25 vouchers for 1 users`

---

## Remove a chain

The clean way to remove a chain is to disable it on-chain. The service filters `getEnabledChains()` on `value->>enabled=eq.true`, so a disabled chain drops out of all four polling loops on the next cycle.

### 1. Disable on-chain

> **Admin on-chain call**
>
> - **Contract:** `MercataBridge` (`BRIDGE_ADDRESS`)
> - **Function:** `toggleChain(uint256 externalChainId, bool enabled)`
> - **Args:** `externalChainId` = the chain to disable; `enabled` = `false`.

Admin UI → Vote On Issues → Create New Issue → select `toggleChain`, fill args, approve.

`toggleChain` only mutates the `.enabled` flag. Custody, hot wallet, router, chain name, and last-processed block are all preserved.

### 2. Verify

- Next `AlchemyPolling` cycle no longer polls the chain (no per-chain log line).
- `ConfigValidator Found N enabled chains` on next restart shows N decremented.

> **Note:** To re-enable, repeat `toggleChain(externalChainId, true)` — the existing cursor, custody, and router addresses are preserved.

---

## Add an asset

Use when you want to start bridging a new token on an already-enabled chain.

### Prerequisites

The STRATO-side token must already exist and be enabled:

1. **Token deployed** from BlockApps Token Factory — Admin UI → Tokens → Create New Token (name, symbol, decimals, initial supply: 0). Note the deployed `stratoToken` address.
2. **Token enabled** — Admin UI → Token Status → set to ACTIVE (status code 2).

Without these, `setAsset` in step 2 will reference a non-existent or inactive token.

### 1. Permit the token on the DepositRouter (Safe multisig)

This is an Ethereum-side transaction executed via the Safe wallet. In the Safe UI, use the "Use Implementation ABI" option to load the DepositRouter's functions.

> **Ethereum on-chain call**
>
> - **Contract:** the chain's DepositRouter (find the address in `MercataBridge.chains[chainId].router` on Cirrus)
> - **Function:** `batchUpdateTokens(address[] tokens, uint96[] minAmounts, bool[] isPermitteds, address[] targetStratoTokens)`
> - **Args:**
>   - `tokens`: `[<erc20-address>]`
>   - `minAmounts`: `[0]`
>   - `isPermitteds`: `[true]`
>   - `targetStratoTokens`: `[<strato-side-token-address>]`

Execute the Safe transaction.

**Verification:** call `canDeposit(<token_address>, 1, <targetStratoToken>)` on the DepositRouter via Etherscan or the Safe read-contract tab — should return `true`. This checks both the token permission and the specific route.

### 2. Register the asset on-chain (admin vote)

> **Admin on-chain call**
>
> - **Contract:** `MercataBridge` (`BRIDGE_ADDRESS`)
> - **Function:** `setAsset(bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken)`

Example args:

- `enabled`: `true`.
- `externalChainId`: the chain's EVM id.
- `externalDecimals`: source-chain token decimals (e.g. `6` for USDC, `18` for most ERC20s).
- `externalName` / `externalSymbol`: display strings (e.g. `"Rocket Pool ETH"`, `"rETH"`).
- `externalToken`: source-chain token address (`0x…`).
- `maxPerWithdrawal`: `0` for unlimited, or a safety cap in the token's integer units.
- `stratoToken`: STRATO-side token address (no `0x`, lowercase).

Admin UI → Vote On Issues → Create New Issue → select `setAsset`, fill args, approve.

### 3. Grant the bridge mint/burn on the STRATO token (admin vote)

The bridge mints on deposit confirmation and burns on withdrawal. Without these whitelist entries, bridged deposits land on STRATO but the token never actually mints.

> **Admin on-chain call (vote 1 — mint)**
>
> - **Contract:** `000000000000000000000000000000000000100c` (AdminRegistry)
> - **Function:** `addWhitelist(address targetAddress, string functionName, address userAddress)`
> - **Args:** `targetAddress` = the STRATO-side token (no `0x`); `functionName` = `"mint"`; `userAddress` = `0000000000000000000000000000000000001008` (the bridge).

> **Admin on-chain call (vote 2 — burn)**
>
> - Same contract, same function.
> - **Args:** same `targetAddress` and `userAddress`; `functionName` = `"burn"`.

Approve both.

### 4. Verify

- `getAssetInfo` queries return the new asset (check Cirrus `BlockApps-MercataBridge-assets` directly, or wait for the next bridge-in cycle).
- Trigger a small test deposit on the source chain:
  - `AlchemyPolling` parses the log and calls `MercataBridge.depositBatch`.
  - `Verification ERC20 check …` confirms receipt matching.
  - `BridgeService Successfully confirmed 1 deposits` + `VoucherService Successfully minted …`.
- STRATO-side balance of the recipient increases by the expected amount.

---

## Remove an asset

The clean way to remove an asset is to disable it on-chain. However, disabling an asset while deposits are in-flight can break the deposit-verification polling cycle, so resolve in-flight deposits first.

> **Warning:** `getDepositsByStatus("1")` fetches all initiated deposits regardless of asset enablement, then maps each against `getAssetInfo` (which only returns enabled assets). If a deposit exists for a just-disabled asset, the mapping throws `"Asset info not found..."` and crashes the **entire** deposit-verification cycle — blocking all other deposits too. Always drain in-flight deposits before disabling.

### 1. Drain in-flight deposits

Before disabling, check Cirrus for any `bridgeStatus=1` deposits referencing this asset's `externalToken` + `externalChainId`. Wait for the next verification cycle to confirm or review them. If any are stuck, use `POST /request-deposit-action` to resolve them manually (see [FLOW.md § The HTTP unblock flow](FLOW.md#the-http-unblock-flow)).

### 2. Revoke DepositRouter permission (Ethereum Safe)

Revoke via `batchUpdateTokens([token], [0], [false], [targetStratoToken])` on the DepositRouter to stop new deposits from reaching the bridge on the Ethereum side. Do this **before** disabling on-chain so no new deposits arrive while you're draining.

### 3. Disable on-chain

> **Admin on-chain call**
>
> - **Contract:** `MercataBridge` (`BRIDGE_ADDRESS`)
> - **Function:** `toggleAsset(address externalToken, uint256 externalChainId, bool enabled)`
> - **Args:** `externalToken` = source-chain token address; `externalChainId` = the chain id; `enabled` = `false`.

Admin UI → Vote On Issues → Create New Issue → select `toggleAsset`, fill args, approve.

`toggleAsset` only mutates the `.enabled` flag. All other asset fields (decimals, name, symbol, stratoToken, limits) are preserved.

### 4. Verify

- No `bridgeStatus=1` deposits remain for this asset in Cirrus.
- Withdrawals for this asset can't be requested from the STRATO UI while it's disabled.
- The deposit-verification cycle continues normally for other assets (no `"Asset info not found"` errors in logs).

> **Note:** To re-enable, repeat `toggleAsset(externalToken, externalChainId, true)` and re-permit on the DepositRouter — all other config is preserved.
