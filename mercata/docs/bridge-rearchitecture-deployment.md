# Bridge Rearchitecture Deployment Runbook

## Prerequisites

- [ ] Hardhat project dependencies installed: `cd mercata/ethereum && npm install`
- [ ] Bridge service dependencies installed: `cd mercata/services/bridge && npm install`
- [ ] Environment variables configured in `mercata/ethereum/.env` and `mercata/services/bridge/.env`
- [ ] Safe multisig wallet accessible for both Sepolia and Base Sepolia
- [ ] Relayer EOA funded with testnet ETH on both Sepolia and Base Sepolia
- [ ] STRATO admin credentials available (GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD)

## Required Environment Variables

```bash
# mercata/ethereum/.env
PRIVATE_KEY=<deployer_private_key>
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/<key>
SAFE_ADDRESS=<safe_multisig_address>

# mercata/services/bridge/.env (add these after deployment)
ACROSS_SIGNER_PRIVATE_KEY=<relayer_eoa_private_key>
CHAIN_11155111_VAULT_ADDRESS=<deployed_vault_sepolia>
CHAIN_84532_VAULT_ADDRESS=<deployed_vault_base_sepolia>
CHAIN_11155111_REP_BRIDGE_ADDRESS=<deployed_rep_bridge_sepolia>
CHAIN_84532_REP_BRIDGE_ADDRESS=<deployed_rep_bridge_base_sepolia>
STRATO_CUSTODY_VAULT_ADDRESS=<deployed_custody_vault_strato>
```

---

## Phase 1: Deploy External-Chain Contracts

### Step 1.1: Compile Contracts

```bash
cd mercata/ethereum
npx hardhat compile
```

**Verify:** All contracts compile with no errors.

### Step 1.2: Deploy ExternalBridgeVault on Sepolia

**Dry-run (estimate gas):**
```bash
SAFE_ADDRESS=<safe_addr> npx hardhat run scripts/deployBridgeVault.js --network sepolia
```

**Execute:**
```bash
SAFE_ADDRESS=<safe_addr> npx hardhat run scripts/deployBridgeVault.js --network sepolia
```

**Verify:**
```bash
cat deployments/ExternalBridgeVault_sepolia_latest.json
# Check proxy and implementation addresses
# Verify on Etherscan: https://sepolia.etherscan.io/address/<proxy_address>
```

Record the proxy address as `SEPOLIA_VAULT_ADDRESS`.

### Step 1.3: Deploy ExternalBridgeVault on Base Sepolia

```bash
SAFE_ADDRESS=<safe_addr> npx hardhat run scripts/deployBridgeVault.js --network baseSepolia
```

**Verify:** `cat deployments/ExternalBridgeVault_baseSepolia_latest.json`

Record the proxy address as `BASE_SEPOLIA_VAULT_ADDRESS`.

### Step 1.4: Deploy StratoRepresentationTokens on Sepolia

Deploy one per STRATO-native asset:

```bash
# USDST
SAFE_ADDRESS=<safe_addr> TOKEN_NAME=USDST TOKEN_SYMBOL=USDST \
  npx hardhat run scripts/deployRepresentationToken.js --network sepolia

# GOLDST
SAFE_ADDRESS=<safe_addr> TOKEN_NAME=GOLDST TOKEN_SYMBOL=GOLDST \
  npx hardhat run scripts/deployRepresentationToken.js --network sepolia

# SILVST
SAFE_ADDRESS=<safe_addr> TOKEN_NAME=SILVST TOKEN_SYMBOL=SILVST \
  npx hardhat run scripts/deployRepresentationToken.js --network sepolia
```

**Verify:** Check `deployments/StratoRepresentationToken_*_sepolia_latest.json` for each.

### Step 1.5: Deploy StratoRepresentationTokens on Base Sepolia

Repeat Step 1.4 with `--network baseSepolia`.

### Step 1.6: Deploy StratoRepresentationBridge on Sepolia

```bash
SAFE_ADDRESS=<safe_addr> npx hardhat run scripts/deployRepresentationBridge.js --network sepolia
```

**Verify:** `cat deployments/StratoRepresentationBridge_sepolia_latest.json`

Record as `SEPOLIA_REP_BRIDGE_ADDRESS`.

### Step 1.7: Deploy StratoRepresentationBridge on Base Sepolia

```bash
SAFE_ADDRESS=<safe_addr> npx hardhat run scripts/deployRepresentationBridge.js --network baseSepolia
```

Record as `BASE_SEPOLIA_REP_BRIDGE_ADDRESS`.

---

## Phase 2: Configure Roles and Mappings (via Safe)

### Step 2.1: Dry-Run Configuration on Sepolia

```bash
node scripts/configureBridgeRoles.js --network sepolia
```

**Verify:** Review the planned transactions output. Confirm:
- BRIDGE_OPERATOR_ROLE granted to relayer EOA on vault
- BRIDGE_OPERATOR_ROLE granted to relayer EOA on rep bridge
- MINTER_ROLE granted to rep bridge on each rep token
- Token mappings registered on rep bridge
- Rate limits set on rep bridge

### Step 2.2: Apply Configuration on Sepolia

```bash
node scripts/configureBridgeRoles.js --network sepolia --apply
```

**Verify:**
1. Check Safe UI for pending proposals
2. Approve and execute each proposal via Safe multisig
3. After execution, verify on-chain:
```bash
# Check vault operator role (use etherscan Read Contract)
# ExternalBridgeVault.hasRole(BRIDGE_OPERATOR_ROLE, <relayer_address>) == true

# Check rep bridge operator role
# StratoRepresentationBridge.hasRole(BRIDGE_OPERATOR_ROLE, <relayer_address>) == true

# Check minter role on rep tokens
# StratoRepresentationToken.hasRole(MINTER_ROLE, <rep_bridge_address>) == true

# Check token mappings
# StratoRepresentationBridge.getRepresentationToken(<strato_token_addr>) == <rep_token_addr>
```

### Step 2.3: Repeat for Base Sepolia

```bash
node scripts/configureBridgeRoles.js --network baseSepolia
node scripts/configureBridgeRoles.js --network baseSepolia --apply
```

---

## Phase 3: STRATO-Side Deployment

### Step 3.1: Upgrade MercataBridge

The MercataBridge contract has been modified with `isNative` support and `stratoCustodyVault` integration. Use the existing upgrade script:

```bash
cd mercata/contracts
node deploy/upgrade.js \
  --proxy-address 0000000000000000000000000000000000001008 \
  --contract-name MercataBridge \
  --contract-file BaseCodeCollection.sol
```

**Verify:** The upgrade should either succeed directly or require a governance vote. Check the output.

### Step 3.2: Deploy StratoCustodyVault on STRATO

The StratoCustodyVault is a new contract. Deploy it using the existing deploy framework:

```bash
cd mercata/contracts
node deploy/deploy.js
# Or use a targeted deploy if the framework supports it
```

Record the deployed address as `STRATO_CUSTODY_VAULT_ADDRESS`.

### Step 3.3: Run Rearchitecture Migration (Dry-Run)

```bash
cd mercata/contracts
node deploy/bridge-rearchitecture-migration.js
```

**Verify:** Review the planned calls:
1. `setStratoCustodyVault(<vault_address>)` on MercataBridge
2. `setAsset(isNative=true, ...)` for each STRATO-canonical asset (USDST, GOLDST, SILVST on both chains)

### Step 3.4: Apply Rearchitecture Migration

```bash
STRATO_CUSTODY_VAULT_ADDRESS=<vault_addr> \
  node deploy/bridge-rearchitecture-migration.js --apply
```

**Verify:**
- Query Cirrus `BlockApps-MercataBridge-assets` table: USDST/GOLDST/SILVST entries should now have `isNative=true`
- Query MercataBridge state: `stratoCustodyVault` should return the vault address

---

## Phase 4: Custody Migration

### Step 4.1: Repoint DepositRouter (via Safe)

This is already included in the `configureBridgeRoles.js` script if `CHAIN_<id>_DEPOSIT_ROUTER` env var is set. Otherwise, submit manually via Safe:

Call `setGnosisSafe(<vault_address>)` on each DepositRouter:
- Sepolia DepositRouter → `SEPOLIA_VAULT_ADDRESS`
- Base Sepolia DepositRouter → `BASE_SEPOLIA_VAULT_ADDRESS`

**Verify:**
```
# DepositRouter.gnosisSafe() should return the vault address, not the old Safe address
```

### Step 4.2: Transfer Existing Custody Balances

Transfer any existing token balances from the old Safe to the new ExternalBridgeVault via Safe multisig transactions:

For each token held by the Safe on each chain:
1. Create a Safe transaction: `ERC20.transfer(vaultAddress, balance)`
2. For ETH: Create a Safe transaction sending ETH to the vault address
3. Approve and execute via Safe multisig

**Verify:**
```
# Check vault balances on each chain
# ExternalBridgeVault ETH balance: etherscan
# ExternalBridgeVault token balances: etherscan token tab
```

---

## Phase 5: Deploy Updated Bridge Service

### Step 5.1: Update Environment

Add the new env vars to `mercata/services/bridge/.env`:

```bash
CHAIN_11155111_VAULT_ADDRESS=<sepolia_vault>
CHAIN_84532_VAULT_ADDRESS=<base_sepolia_vault>
CHAIN_11155111_REP_BRIDGE_ADDRESS=<sepolia_rep_bridge>
CHAIN_84532_REP_BRIDGE_ADDRESS=<base_sepolia_rep_bridge>
STRATO_CUSTODY_VAULT_ADDRESS=<strato_custody_vault>

# Keep disabled initially
REBALANCING_ENABLED=false
CIRCUIT_BREAKER_ENABLED=false
```

### Step 5.2: Build and Start

```bash
cd mercata/services/bridge
npm run build
npm run start
```

**Verify:**
- Service starts without errors
- Asset family registry initializes (check logs for "AssetFamilyRegistry Initialized")
- Liquidity manager refreshes balances (check logs for "LiquidityManager Balances refreshed")
- Polling services start normally

### Step 5.3: Deploy Updated Backend and UI

Deploy the updated backend and UI with standard deployment process. No special migration needed — the new `isNative` and `assetFamily` fields are additive.

---

## Phase 6: Smoke Tests

### Test 1: External-Canonical Deposit (Bridge In)

1. Send USDC to ExternalBridgeVault via DepositRouter on Sepolia
2. Verify bridge service detects the deposit
3. Verify STRATO mints the USDC representation
4. Check deposit appears in transaction history

### Test 2: External-Canonical Withdrawal (Bridge Out)

1. Request withdrawal of USDC on STRATO targeting Sepolia
2. Verify withdrawal allocator checks liquidity
3. Verify vault releases USDC to recipient on Sepolia
4. Verify MercataBridge burns the STRATO representation

### Test 3: STRATO-Canonical Outbound (Bridge Out Native)

1. Request withdrawal of USDST on STRATO targeting Sepolia
2. Verify MercataBridge escrows USDST
3. Verify StratoRepresentationBridge mints rUSDST on Sepolia
4. Verify MercataBridge locks escrowed USDST into StratoCustodyVault

### Test 4: STRATO-Canonical Inbound (Return to STRATO)

1. Burn rUSDST on Sepolia via StratoRepresentationBridge (through UI)
2. Verify bridge service detects the burn event
3. Verify MercataBridge unlocks USDST from StratoCustodyVault to user

### Test 5: Rate Limit Enforcement

1. Attempt to release more than the configured rate limit from the vault
2. Verify the transaction reverts with `RateLimitExceeded`

---

## Phase 7: Enable Advanced Features

After a monitoring period (recommended: 24-48 hours of stable operation):

### Step 7.1: Enable Rebalancing

```bash
# Update .env
REBALANCING_ENABLED=true
REBALANCING_MIN_THRESHOLD=500000000000000000000  # $500
```

Restart the bridge service.

### Step 7.2: Enable Circuit Breakers

```bash
# Update .env
CIRCUIT_BREAKER_ENABLED=true
CB_ANOMALY_THRESHOLD=<threshold_in_wei>
```

Restart the bridge service.

---

## Rollback Procedures

### Rollback: Revert DepositRouter to Safe

Via Safe multisig:
```
DepositRouter.setGnosisSafe(<old_safe_address>)
```

### Rollback: Sweep Vault Back to Safe

Via Safe multisig (Safe is DEFAULT_ADMIN_ROLE):
```
ExternalBridgeVault.sweepERC20(<token>, <safe_address>)
ExternalBridgeVault.sweepETH(<safe_address>)
```

### Rollback: Disable isNative on Assets

On STRATO, call `setAsset(isNative=false, ...)` for each STRATO-canonical asset to revert to mint/burn behavior.

### Rollback: Bridge Service

The bridge service falls back to legacy Safe address if `CHAIN_<id>_VAULT_ADDRESS` is not set. Remove the vault env vars and restart to revert to Safe-based flow.

---

## Post-Deployment Checklist

- [ ] ExternalBridgeVault deployed and funded on Sepolia
- [ ] ExternalBridgeVault deployed and funded on Base Sepolia
- [ ] StratoRepresentationToken deployed for USDST, GOLDST, SILVST on both chains (6 contracts)
- [ ] StratoRepresentationBridge deployed on both chains (2 contracts)
- [ ] All roles granted (BRIDGE_OPERATOR on vaults/bridges, MINTER on tokens)
- [ ] Token mappings registered on StratoRepresentationBridge
- [ ] Rate limits configured on all contracts
- [ ] StratoCustodyVault deployed on STRATO
- [ ] MercataBridge upgraded with isNative support
- [ ] STRATO-canonical assets registered with isNative=true
- [ ] DepositRouter repointed to ExternalBridgeVault
- [ ] Custody balances transferred from Safe to vault
- [ ] Bridge service deployed with vault env vars
- [ ] All 5 smoke tests passing
- [ ] Reconciliation running (check logs every 5 minutes)
- [ ] Rebalancing enabled after monitoring period
- [ ] Circuit breakers enabled after baseline established
