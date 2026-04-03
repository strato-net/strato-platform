# Bridge Rearchitecture Deployment Runbook

This document covers deployment for both **testnet** and **mainnet** environments. Each step is labeled with `[TESTNET]`, `[MAINNET]`, or `[BOTH]`. Testnet must be fully deployed and smoke-tested before mainnet begins.

---

## Environment Reference

| | Testnet | Mainnet |
|--|---------|---------|
| **STRATO node** | `https://node1.testnet.strato.nexus` | `https://app.strato.nexus` |
| **EVM Chain A** | Sepolia (11155111) | Ethereum (1) |
| **EVM Chain B** | Base Sepolia (84532) | Base (8453) |
| **EVM Chain C** | Linea Sepolia (59141) | Linea (59144) |
| **Hardhat network flags** | `--network sepolia` / `--network baseSepolia` / `--network lineaSepolia` | `--network mainnet` / `--network base` / `--network linea` |
| **Block explorer** | sepolia.etherscan.io / sepolia.basescan.org / sepolia.lineascan.build | etherscan.io / basescan.org / lineascan.build |
| **Env profile flag** | `--env testnet` | `--env prod` |
| **Contracts per env** | 15 (3 vaults, 9 rep tokens, 3 rep bridges) | 15 (same set) |

### STRATO-Native Token Addresses

| Token | STRATO Address |
|-------|---------------|
| USDST | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` |
| GOLDST | `cdc93d30182125e05eec985b631c7c61b3f63ff0` |
| SILVST | `2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94` |

---

## Prerequisites

- [ ] `[BOTH]` Hardhat dependencies installed: `cd mercata/ethereum && npm install`
- [ ] `[BOTH]` Bridge service dependencies installed: `cd mercata/services/bridge && npm install`
- [ ] `[BOTH]` Environment variables configured in `mercata/ethereum/.env` and `mercata/services/bridge/.env`
- [ ] `[BOTH]` Safe multisig wallet accessible on all target chains
- [ ] `[BOTH]` Relayer EOA funded with ETH on all target chains
- [ ] `[BOTH]` STRATO admin credentials available
- [ ] `[MAINNET]` Testnet deployment fully completed and all smoke tests passing
- [ ] `[MAINNET]` Security audit of new contracts reviewed and signed off
- [ ] `[MAINNET]` Rate limit values reviewed by team and calibrated to expected mainnet volume
- [ ] `[MAINNET]` Mainnet Safe has sufficient signers online for multisig approval

## Required Environment Variables

```bash
# mercata/ethereum/.env
PRIVATE_KEY=<deployer_private_key>

# --- Testnet ---
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/<key>
LINEA_SEPOLIA_RPC_URL=https://linea-sepolia.g.alchemy.com/v2/<key>

# --- Mainnet ---
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>
LINEA_RPC_URL=https://linea-mainnet.g.alchemy.com/v2/<key>

SAFE_ADDRESS=<safe_multisig_address>
```

```bash
# mercata/services/bridge/.env (add after deployment)
ACROSS_SIGNER_PRIVATE_KEY=<relayer_eoa_private_key>

# --- Testnet ---
CHAIN_11155111_VAULT_ADDRESS=<vault_sepolia>
CHAIN_84532_VAULT_ADDRESS=<vault_base_sepolia>
CHAIN_59141_VAULT_ADDRESS=<vault_linea_sepolia>
CHAIN_11155111_REP_BRIDGE_ADDRESS=<rep_bridge_sepolia>
CHAIN_84532_REP_BRIDGE_ADDRESS=<rep_bridge_base_sepolia>
CHAIN_59141_REP_BRIDGE_ADDRESS=<rep_bridge_linea_sepolia>

# --- Mainnet ---
CHAIN_1_VAULT_ADDRESS=<vault_mainnet>
CHAIN_8453_VAULT_ADDRESS=<vault_base>
CHAIN_59144_VAULT_ADDRESS=<vault_linea>
CHAIN_1_REP_BRIDGE_ADDRESS=<rep_bridge_mainnet>
CHAIN_8453_REP_BRIDGE_ADDRESS=<rep_bridge_base>
CHAIN_59144_REP_BRIDGE_ADDRESS=<rep_bridge_linea>

STRATO_CUSTODY_VAULT_ADDRESS=<custody_vault_strato>
```

---

## Phase 1: Deploy External-Chain Contracts

### Step 1.1: Compile Contracts `[BOTH]`

```bash
cd mercata/ethereum
npx hardhat compile
```

**Verify:** All contracts compile with no errors and no warnings.

---

### Step 1.2: Deploy ExternalBridgeVault `[TESTNET]`

**Dry-run (review output only, no state change):**
```bash
# The deploy script always executes. To dry-run, review the config output
# and verify deployer balance is sufficient before running.
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployBridgeVault.js --network sepolia
```

**Verify:**
```bash
cat deployments/ExternalBridgeVault_sepolia_latest.json
# Confirm proxy, implementation addresses
# https://sepolia.etherscan.io/address/<proxy_address>#code
```

Record `SEPOLIA_VAULT_ADDRESS`.

Repeat for Base Sepolia and Linea Sepolia:
```bash
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployBridgeVault.js --network baseSepolia
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployBridgeVault.js --network lineaSepolia
```

Record `BASE_SEPOLIA_VAULT_ADDRESS` and `LINEA_SEPOLIA_VAULT_ADDRESS`.

### Step 1.2M: Deploy ExternalBridgeVault `[MAINNET]`

> **Gate:** Testnet smoke tests must be passing before proceeding.

```bash
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployBridgeVault.js --network mainnet
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployBridgeVault.js --network base
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployBridgeVault.js --network linea
```

Record `MAINNET_VAULT_ADDRESS`, `BASE_VAULT_ADDRESS`, and `LINEA_VAULT_ADDRESS`.

**Verify:**
```bash
cat deployments/ExternalBridgeVault_mainnet_latest.json
cat deployments/ExternalBridgeVault_base_latest.json
cat deployments/ExternalBridgeVault_linea_latest.json
# Verify on etherscan.io, basescan.org, and lineascan.build
```

---

### Step 1.3: Deploy StratoRepresentationTokens `[TESTNET]`

Deploy 3 tokens per chain (9 total for testnet):

```bash
# Sepolia, Base Sepolia, Linea Sepolia
for NETWORK in sepolia baseSepolia lineaSepolia; do
  for TOKEN in USDST GOLDST SILVST; do
    SAFE_ADDRESS=<testnet_safe> TOKEN_NAME=$TOKEN TOKEN_SYMBOL=$TOKEN \
      npx hardhat run scripts/deployRepresentationToken.js --network $NETWORK
  done
done
```

**Verify:** Check `deployments/StratoRepresentationToken_*_*_latest.json` for all 9 deployments.

### Step 1.3M: Deploy StratoRepresentationTokens `[MAINNET]`

```bash
# Ethereum Mainnet, Base, Linea
for NETWORK in mainnet base linea; do
  for TOKEN in USDST GOLDST SILVST; do
    SAFE_ADDRESS=<mainnet_safe> TOKEN_NAME=$TOKEN TOKEN_SYMBOL=$TOKEN \
      npx hardhat run scripts/deployRepresentationToken.js --network $NETWORK
  done
done
```

---

### Step 1.4: Deploy StratoRepresentationBridge `[TESTNET]`

One per chain:

```bash
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network sepolia
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network baseSepolia
SAFE_ADDRESS=<testnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network lineaSepolia
```

Record `SEPOLIA_REP_BRIDGE_ADDRESS`, `BASE_SEPOLIA_REP_BRIDGE_ADDRESS`, and `LINEA_SEPOLIA_REP_BRIDGE_ADDRESS`.

### Step 1.4M: Deploy StratoRepresentationBridge `[MAINNET]`

```bash
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network mainnet
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network base
SAFE_ADDRESS=<mainnet_safe> npx hardhat run scripts/deployRepresentationBridge.js --network linea
```

Record `MAINNET_REP_BRIDGE_ADDRESS`, `BASE_REP_BRIDGE_ADDRESS`, and `LINEA_REP_BRIDGE_ADDRESS`.

---

## Phase 2: Configure Roles and Mappings (via Safe)

### Step 2.1: Dry-Run `[TESTNET]`

```bash
cd mercata/ethereum
node scripts/configureBridgeRoles.js --network sepolia
node scripts/configureBridgeRoles.js --network baseSepolia
node scripts/configureBridgeRoles.js --network lineaSepolia
```

**Verify planned transactions include:**
- `grantRole(BRIDGE_OPERATOR_ROLE, <relayer>)` on ExternalBridgeVault
- `grantRole(BRIDGE_OPERATOR_ROLE, <relayer>)` on StratoRepresentationBridge
- `grantRole(MINTER_ROLE, <rep_bridge>)` on each StratoRepresentationToken
- `setTokenMapping(<stratoAddr>, <repTokenAddr>)` for each asset
- `setMintRateLimit` / `setBurnRateLimit` for each asset
- `setGnosisSafe(<vault>)` on DepositRouter (if `CHAIN_<id>_DEPOSIT_ROUTER` is set)

### Step 2.2: Apply `[TESTNET]`

```bash
node scripts/configureBridgeRoles.js --network sepolia --apply
node scripts/configureBridgeRoles.js --network baseSepolia --apply
node scripts/configureBridgeRoles.js --network lineaSepolia --apply
```

**Verify (after Safe approval + execution):**

| Check | Method |
|-------|--------|
| Vault operator role | `ExternalBridgeVault.hasRole(BRIDGE_OPERATOR_ROLE, <relayer>)` via Etherscan Read |
| Rep bridge operator role | `StratoRepresentationBridge.hasRole(BRIDGE_OPERATOR_ROLE, <relayer>)` |
| Minter role on tokens | `StratoRepresentationToken.hasRole(MINTER_ROLE, <rep_bridge>)` |
| Token mappings | `StratoRepresentationBridge.getRepresentationToken(<stratoAddr>)` returns correct rep token |
| Rate limits | `StratoRepresentationBridge.remainingMintLimit(<stratoAddr>)` returns nonzero |

### Step 2.1M–2.2M: Dry-Run and Apply `[MAINNET]`

> **Gate:** Testnet configuration verified and all on-chain checks passing.

```bash
# Dry-run all three chains first
node scripts/configureBridgeRoles.js --network mainnet
node scripts/configureBridgeRoles.js --network base
node scripts/configureBridgeRoles.js --network linea

# Apply after reviewing dry-run output
node scripts/configureBridgeRoles.js --network mainnet --apply
node scripts/configureBridgeRoles.js --network base --apply
node scripts/configureBridgeRoles.js --network linea --apply
```

**Mainnet rate limit values:**
- These must be reviewed and adjusted in `configureBridgeRoles.js` before applying.
- Recommended: 2x expected peak daily withdrawal volume per asset, 24-hour rolling window.
- Per-transaction caps should be set conservatively (e.g., $100K per release for stablecoins).

---

## Phase 3: STRATO-Side Deployment `[BOTH]`

### Step 3.1: Upgrade MercataBridge

```bash
cd mercata/contracts

# Testnet
NODE_URL=https://node1.testnet.strato.nexus \
  node deploy/upgrade.js \
    --proxy-address 0000000000000000000000000000000000001008 \
    --contract-name MercataBridge \
    --contract-file BaseCodeCollection.sol

# Mainnet (after testnet verified)
NODE_URL=https://app.strato.nexus \
  node deploy/upgrade.js \
    --proxy-address 0000000000000000000000000000000000001008 \
    --contract-name MercataBridge \
    --contract-file BaseCodeCollection.sol
```

**Verify:** Upgrade succeeds or governance vote is initiated. After completion, the contract supports `isNative` and `setStratoCustodyVault`.

### Step 3.2: Deploy StratoCustodyVault on STRATO

Deploy via the existing contract deployment framework. Record `STRATO_CUSTODY_VAULT_ADDRESS`.

### Step 3.3: Rearchitecture Migration — Dry-Run

```bash
# Testnet
NODE_URL=https://node1.testnet.strato.nexus \
  node deploy/bridge-rearchitecture-migration.js

# Mainnet
NODE_URL=https://app.strato.nexus \
  node deploy/bridge-rearchitecture-migration.js
```

**Verify planned calls:**
1. `setStratoCustodyVault(<vault_address>)`
2. `setAsset(isNative=true, ...)` for USDST (2 chains), GOLDST (2 chains), SILVST (2 chains)

### Step 3.4: Rearchitecture Migration — Apply

```bash
# Testnet
STRATO_CUSTODY_VAULT_ADDRESS=<vault_addr> \
  NODE_URL=https://node1.testnet.strato.nexus \
  node deploy/bridge-rearchitecture-migration.js --apply

# Mainnet (after testnet verified)
STRATO_CUSTODY_VAULT_ADDRESS=<vault_addr> \
  NODE_URL=https://app.strato.nexus \
  node deploy/bridge-rearchitecture-migration.js --apply
```

**Verify:**
- Cirrus query: `BlockApps-MercataBridge-assets` shows `isNative=true` for USDST/GOLDST/SILVST
- Cirrus query: `MercataBridge.stratoCustodyVault` returns the vault address

---

## Phase 4: Custody Migration

### Step 4.1: Repoint DepositRouter `[TESTNET]` then `[MAINNET]`

If not already done by `configureBridgeRoles.js`, submit via Safe:

| Chain | Call | Target |
|-------|------|--------|
| Sepolia (testnet) | `DepositRouter.setGnosisSafe(SEPOLIA_VAULT_ADDRESS)` | Testnet vault |
| Base Sepolia (testnet) | `DepositRouter.setGnosisSafe(BASE_SEPOLIA_VAULT_ADDRESS)` | Testnet vault |
| Linea Sepolia (testnet) | `DepositRouter.setGnosisSafe(LINEA_SEPOLIA_VAULT_ADDRESS)` | Testnet vault |
| Ethereum (mainnet) | `DepositRouter.setGnosisSafe(MAINNET_VAULT_ADDRESS)` | Mainnet vault |
| Base (mainnet) | `DepositRouter.setGnosisSafe(BASE_VAULT_ADDRESS)` | Mainnet vault |
| Linea (mainnet) | `DepositRouter.setGnosisSafe(LINEA_VAULT_ADDRESS)` | Mainnet vault |

**Verify:** `DepositRouter.gnosisSafe()` returns the vault address on each chain.

### Step 4.2: Transfer Custody Balances `[TESTNET]` then `[MAINNET]`

> **MAINNET CAUTION:** This moves real funds. Execute one chain at a time. Verify vault balance after each transfer before proceeding to the next.

For each token held by the Safe on each chain:

1. **ERC-20:** Safe transaction → `ERC20.transfer(vaultAddress, balance)`
2. **ETH:** Safe transaction → send ETH value to vault address

**Verify per chain:**
```
ExternalBridgeVault ETH balance: <explorer>/address/<vault>#internaltx
ExternalBridgeVault token balances: <explorer>/address/<vault>#tokentxns
Old Safe balance should be zero (or near-zero for gas dust)
```

> **MAINNET:** After each chain's transfer, wait 2 block confirmations and verify vault balance before proceeding to the next chain.

---

## Phase 5: Deploy Updated Bridge Service

### Step 5.1: Update Environment `[TESTNET]` then `[MAINNET]`

Add to `mercata/services/bridge/.env`:

```bash
# Testnet
CHAIN_11155111_VAULT_ADDRESS=<sepolia_vault>
CHAIN_84532_VAULT_ADDRESS=<base_sepolia_vault>
CHAIN_59141_VAULT_ADDRESS=<linea_sepolia_vault>
CHAIN_11155111_REP_BRIDGE_ADDRESS=<sepolia_rep_bridge>
CHAIN_84532_REP_BRIDGE_ADDRESS=<base_sepolia_rep_bridge>
CHAIN_59141_REP_BRIDGE_ADDRESS=<linea_sepolia_rep_bridge>

# Mainnet (in prod .env)
CHAIN_1_VAULT_ADDRESS=<mainnet_vault>
CHAIN_8453_VAULT_ADDRESS=<base_vault>
CHAIN_59144_VAULT_ADDRESS=<linea_vault>
CHAIN_1_REP_BRIDGE_ADDRESS=<mainnet_rep_bridge>
CHAIN_8453_REP_BRIDGE_ADDRESS=<base_rep_bridge>
CHAIN_59144_REP_BRIDGE_ADDRESS=<linea_rep_bridge>

STRATO_CUSTODY_VAULT_ADDRESS=<strato_custody_vault>

# Keep disabled initially on both environments
REBALANCING_ENABLED=false
CIRCUIT_BREAKER_ENABLED=false
```

### Step 5.2: Build and Start `[BOTH]`

```bash
cd mercata/services/bridge
npm run build
npm run start
```

**Verify:**
- Service starts without errors
- Log: `AssetFamilyRegistry Initialized` with correct asset counts
- Log: `LiquidityManager Balances refreshed` with correct entry counts
- Polling services start normally
- No errors in verification service (vault addresses resolve correctly)

### Step 5.3: Deploy Updated Backend and UI `[BOTH]`

Standard deployment process. The new `isNative` and `assetFamily` fields are additive — backward compatible.

---

## Phase 6: Smoke Tests

### `[TESTNET]` — Run all tests on each chain before proceeding to mainnet

Run tests 1–5 on Sepolia and Base Sepolia. Run tests 1–4 on Linea Sepolia (Across rebalancing is not available on Linea Sepolia).

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | External-canonical deposit | Send USDC to vault via DepositRouter | Bridge service detects deposit, STRATO mints USDC representation |
| 2 | External-canonical withdrawal | Request USDC withdrawal on STRATO | Allocator checks liquidity, vault releases USDC, MercataBridge burns |
| 3 | STRATO-canonical outbound | Request USDST withdrawal targeting chain | MercataBridge escrows, rep bridge mints rUSDST, custody vault locks |
| 4 | STRATO-canonical inbound | Burn rUSDST on external chain via UI | Bridge service detects burn, MercataBridge unlocks from custody vault |
| 5 | Rate limit enforcement | Attempt release exceeding rate limit | Transaction reverts with `RateLimitExceeded` |

### `[MAINNET]` — Run tests 1–4 with small amounts

| # | Test | Amount | Notes |
|---|------|--------|-------|
| 1 | External-canonical deposit | ~$1 equivalent | Verify end-to-end before larger deposits |
| 2 | External-canonical withdrawal | ~$1 equivalent | Verify vault release works |
| 3 | STRATO-canonical outbound | 1 USDST | Verify rep mint + custody lock |
| 4 | STRATO-canonical inbound | 1 rUSDST | Verify burn + custody unlock |

> After small-amount tests pass, gradually increase to normal operational amounts.

---

## Phase 7: Enable Advanced Features

### `[TESTNET]` — Enable immediately after smoke tests

> **Note:** Across testnet does not support Linea Sepolia (59141). Rebalancing to/from Linea Sepolia will not work until either Across adds support or an alternative cross-chain transfer mechanism is configured. Rebalancing between Sepolia and Base Sepolia works normally. On mainnet, Across fully supports Linea (59144).

```bash
REBALANCING_ENABLED=true
REBALANCING_MIN_THRESHOLD=500000000000000000000  # $500 in 18-dec
CIRCUIT_BREAKER_ENABLED=true
CB_ANOMALY_THRESHOLD=10000000000000000000000  # $10K for testnet
```

### `[MAINNET]` — Enable after 24–48 hour monitoring period

```bash
REBALANCING_ENABLED=true
REBALANCING_MIN_THRESHOLD=<calibrated_to_mainnet_volume>
REBALANCING_RESERVE_PCT=10

CIRCUIT_BREAKER_ENABLED=true
CB_ANOMALY_THRESHOLD=<calibrated_to_2x_peak_daily_volume>
CB_WINDOW_DURATION_MS=3600000
```

> **MAINNET:** Review rebalancing and circuit breaker thresholds with the team before enabling. Use testnet values as a starting point but calibrate to actual mainnet volume.

---

## Rollback Procedures

All rollbacks can be performed independently per chain. Mainnet and testnet rollbacks do not affect each other.

### Rollback: Revert DepositRouter to Safe

Via Safe multisig on the affected chain:
```
DepositRouter.setGnosisSafe(<old_safe_address>)
```
**Effect:** New deposits go back to Safe. Existing vault deposits are unaffected.

### Rollback: Sweep Vault Back to Safe

Via Safe multisig (Safe holds DEFAULT_ADMIN_ROLE):
```
ExternalBridgeVault.sweepERC20(<token>, <safe_address>)
ExternalBridgeVault.sweepETH(<safe_address>)
```
**Effect:** All vault funds returned to Safe. Must also revert DepositRouter.

> **MAINNET:** Sweep one token at a time. Verify Safe balance after each sweep.

### Rollback: Disable isNative on Assets

On STRATO:
```bash
# Re-run setAsset with isNative=false for each STRATO-canonical asset
# This reverts to mint/burn behavior for native assets
node deploy/bridge-rearchitecture-migration.js --apply
# (after editing STRATO_CANONICAL_ASSETS in the script to set isNative=false)
```

### Rollback: Bridge Service

Remove vault env vars from `.env` and restart. The verification service falls back to `config.safe.address` when `CHAIN_<id>_VAULT_ADDRESS` is not set.

### Rollback: Full Revert Sequence (Nuclear Option)

1. Pause bridge service
2. Sweep all vault balances back to Safe (per chain)
3. Revert all DepositRouters to Safe addresses
4. Set `isNative=false` on all STRATO-canonical assets
5. Remove vault env vars from bridge service
6. Restart bridge service
7. Verify old Safe-based flow works end-to-end

---

## Deployment Order Summary

```
TESTNET                                              MAINNET
────────                                             ───────
1. Compile contracts                                 (same binary)
2. Deploy vaults (Sepolia, Base Sepolia, Linea Sep)  8.  Deploy vaults (Mainnet, Base, Linea)
3. Deploy rep tokens (9 contracts: 3 tokens x 3 ch)  9.  Deploy rep tokens (9 contracts)
4. Deploy rep bridges (3 contracts)                  10. Deploy rep bridges (3 contracts)
5. Configure roles (dry-run → apply, all 3 chains)  11. Configure roles (dry-run → apply, all 3 chains)
6. STRATO: upgrade + migrate                        12. STRATO: upgrade + migrate (prod node)
7. Smoke tests ← GATE                               13. Custody transfer (one chain at a time)
                                                     14. Deploy service + backend + UI
                                                     15. Small-amount smoke tests
                                                     16. Monitoring period (24-48h)
                                                     17. Enable rebalancing + circuit breakers
```

---

## Post-Deployment Checklist

### `[TESTNET]`

- [ ] ExternalBridgeVault deployed on Sepolia, Base Sepolia, and Linea Sepolia
- [ ] 9 StratoRepresentationTokens deployed (USDST, GOLDST, SILVST x 3 chains)
- [ ] 3 StratoRepresentationBridges deployed (one per chain)
- [ ] All roles granted and verified on-chain (all 3 chains)
- [ ] Token mappings registered and verified (all 3 chains)
- [ ] Rate limits configured (all 3 chains)
- [ ] StratoCustodyVault deployed on STRATO
- [ ] MercataBridge upgraded with isNative
- [ ] Assets registered with correct isNative flags
- [ ] DepositRouters repointed to vaults (all 3 chains)
- [ ] Custody balances transferred
- [ ] Bridge service running with vault env vars (all 3 chains)
- [ ] All 5 smoke tests passing
- [ ] Rebalancing enabled
- [ ] Circuit breakers enabled

### `[MAINNET]`

- [ ] All testnet checklist items verified first
- [ ] Rate limits reviewed and calibrated to mainnet volume
- [ ] Security review of deployed contract addresses
- [ ] ExternalBridgeVault deployed on Mainnet, Base, and Linea
- [ ] 9 StratoRepresentationTokens deployed (3 tokens x 3 chains)
- [ ] 3 StratoRepresentationBridges deployed
- [ ] All roles granted (verified on etherscan/basescan/lineascan)
- [ ] Token mappings registered (all 3 chains)
- [ ] Rate limits configured (mainnet-calibrated values, all 3 chains)
- [ ] STRATO-side upgrade and migration applied
- [ ] DepositRouters repointed (one chain at a time)
- [ ] Custody balances transferred (one chain at a time, verified after each)
- [ ] Bridge service deployed with mainnet vault env vars (all 3 chains)
- [ ] Small-amount smoke tests passing
- [ ] 24–48 hour monitoring period completed
- [ ] Reconciliation running with no discrepancy alerts
- [ ] Rebalancing enabled with mainnet thresholds
- [ ] Circuit breakers enabled with mainnet thresholds
- [ ] Old Safe balances confirmed zero on all 3 chains (excluding gas dust)
