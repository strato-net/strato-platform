# STRATO Ethereum Deployment

Modular Hardhat setup for deploying STRATO contracts to Ethereum networks with UUPS upgradeable proxy support.

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Setup environment:**

   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

3. **Compile contracts:**

   ```bash
   npm run compile
   ```

4. **Deploy to Sepolia testnet:**
   ```bash
   CONTRACT_NAME=DepositRouter INIT_PARAMS='["0xYOUR_GNOSIS_SAFE", "0xYOUR_OWNER"]' npm run deployWithProxy:sepolia
   ```

## Available Scripts

| Script                            | Description                                    |
| --------------------------------- | ---------------------------------------------- |
| `npm run compile`                 | Compile all contracts                          |
| `npm run deployWithProxy:sepolia` | Deploy contract with proxy to Sepolia testnet  |
| `npm run deployWithProxy:mainnet` | Deploy contract with proxy to Ethereum mainnet |
| `npm run verify:sepolia`          | Verify contract on Sepolia Etherscan           |
| `npm run verify:mainnet`          | Verify contract on Mainnet Etherscan           |
| `npm run scan:sepolia`            | Scan token configurations on Sepolia testnet   |
| `npm run scan:mainnet`            | Scan token configurations on Ethereum mainnet  |

## Utility Scripts

### Token Configuration Scanner

The `scanTokenConfig.js` script allows you to view all configured tokens in a DepositRouter contract:

```bash
# Using npm script (recommended)
npm run scan:sepolia

# Or manually with environment variable
DEPOSIT_ROUTER_ADDRESS=0x1234567890123456789012345678901234567890 npx hardhat run scripts/scanTokenConfig.js --network sepolia
```

**Prerequisites:**
- Run `npm run compile` first to generate the contract ABI
- Set `DEPOSIT_ROUTER_ADDRESS` in your `.env` file

**Permission values:**
- `1` = WRAP only (0b01)
- `2` = MINT only (0b10)  
- `3` = Both WRAP and MINT (0b11)

## Environment Setup

**Required .env file:**

```bash
# Network RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY

# Deployment wallet private key (DO NOT COMMIT THE REAL ONE)
PRIVATE_KEY=0x1234567890abcdef...

# Etherscan API key for verification
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY

# DepositRouter contract address (for utility scripts)
DEPOSIT_ROUTER_ADDRESS=0x1234567890123456789012345678901234567890
```

## Deployment

**Deploy to Sepolia:**

```bash
CONTRACT_NAME=<contractname> INIT_PARAMS='["param1", "param2", ...]' npm run deployWithProxy:sepolia
```

**Deploy to Mainnet:**

```bash
CONTRACT_NAME=<contractname> INIT_PARAMS='["param1", "param2", ...]' npm run deployWithProxy:mainnet
```

**DepositRouter Example:**

```bash
CONTRACT_NAME=DepositRouter INIT_PARAMS='["0xGNOSIS_SAFE_ADDRESS", "0xOWNER_ADDRESS"]' npm run deployWithProxy:sepolia
```

## Verification

After deployment, verify the implementation contract on Etherscan:

```bash
npm run verify:sepolia -- 0xIMPLEMENTATION_ADDRESS
```

## External Asset Bridge Rollout

`ExternalBridgeVault` holds route-local external liquidity. Its initializer
assigns default administration, upgrades, policy, pause, unpause, attestation
administration, and large-withdrawal approval explicitly. The existing
`DepositRouter` remains owned by the Safe.

### 1. Development

Compile and run the contract and rollout-plan tests:

```bash
npm run compile
npx hardhat test test/ExternalBridgeVault.js test/DepositRouter.test.js
npm run external:vault:ops:test
npm run external:rollout:test
```

Copy `externalBridgeVault.config.example.json` outside the repository and
replace every sample value. Amounts are raw token units. Keep every
`migrateAmount` at `0` until configuration and router verification pass.

### All-token configuration generator

First run `router:ops:testnet -- --step setters` as a dry run. Its audit JSON
contains every enabled legacy route and the external token metadata needed by
the generator. Generate a fail-closed policy skeleton:

```bash
npm run external:rollout:generate -- --deposit-plan /absolute/path/deposit-router-setters.json --chain 11155111 --output-dir /secure/path/eab-rollout
```

Replace every `REVIEW_REQUIRED` value and explicitly decide deposit,
withdrawal, rebase, and AUTO_ROUTE enablement for every route. Then generate
the synchronized EAB config, external-vault config, and DepositRouter Safe
Transaction Builder batches:

```bash
npm run external:rollout:generate -- --deposit-plan /absolute/path/deposit-router-setters.json --chain 11155111 --bridge-template /secure/path/external-bridge.base.json --vault-template /secure/path/external-bridge-vault.base.json --policy /secure/path/eab-rollout/external-bridge-rollout-policy-11155111.json --output-dir /secure/path/eab-rollout
```

The generator fails if token metadata, risk policy, or bridge/vault deployment
addresses are missing or inconsistent. It never copies legacy withdrawal
limits automatically and never submits transactions. It writes Safe
Transaction Builder JSON for DepositRouter pause, synchronized token setters,
and unpause. `external:vault:ops` separately writes Safe Transaction Builder
JSON for vault configuration and later liquidity migration.

### 2. Testnet

Deploy one vault proxy per external chain. Supply the default administrator,
upgrader, policy administrator, guardian, unpauser, attestation administrator,
and large-withdrawal approver in that order:

```bash
CONTRACT_NAME=ExternalBridgeVault \
INIT_PARAMS='["0xDEFAULT_ADMIN","0xUPGRADER","0xPOLICY_ADMIN","0xGUARDIAN","0xUNPAUSER","0xATTESTATION_ADMIN","0xLARGE_WITHDRAWAL_APPROVER"]' \
npm run deployWithProxy:sepolia
```

Record the proxy address in the rollout configuration. Deploy the current
`DepositRouter` implementation and use the existing router upgrade proposal
flow. Execute that Safe proposal before running vault operations.

Dry-run the vault configuration and router destination update:

```bash
npm run external:vault:ops -- \
  --config /absolute/path/external-bridge-vault.json \
  --chains 11155111 \
  --step all
```

The plan verifies Safe and guardian roles and reports router ownership,
migration balances, and whether service validator keys derive to configured
signer addresses. Apply mode fails closed on role, ownership, signer, or
liquidity mismatches. Review the JSON output, then propose the Safe
transactions:

```bash
npm run external:vault:ops -- \
  --config /absolute/path/external-bridge-vault.json \
  --chains 11155111 \
  --step configure \
  --apply

npm run external:vault:ops -- \
  --config /absolute/path/external-bridge-vault.json \
  --chains 11155111 \
  --step router \
  --apply
```

Execute the proposals in nonce order. Verify the resulting on-chain state:

```bash
npm run external:vault:ops -- \
  --config /absolute/path/external-bridge-vault.json \
  --chains 11155111 \
  --step verify
```

After successful verification, set only the intended `migrateAmount` values,
dry-run `--step liquidity`, then repeat with `--apply`. ERC-20 transfers and
native-asset transfers are proposed from the Safe directly to the vault.

Finally, use the existing STRATO contract-update flow to set each chain's vault
address and routes on `ExternalAssetBridge`. The bridge service reads vault
addresses from STRATO and requires these environment variables per chain:

```bash
CHAIN_11155111_RPC_URL=https://...
CHAIN_11155111_EXTERNAL_BRIDGE_SIGNER_ADDRESSES=0x...,0x...
CHAIN_11155111_EXTERNAL_BRIDGE_SIGNER_URLS=https://signer-1.example,https://signer-2.example
CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS=0x...
CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_URL=https://kms-signing-adapter.example/sign-transaction
CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_API_TOKEN=...
```

Production deployments must use the KMS/HSM executor configuration above. The
`CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY` setting is only a local or
test fallback.

### 3. Production

Repeat the testnet sequence without changing contract versions. Use production
Safe, guardian, RPC, validator, policy, and token addresses. Start with
`migrateAmount: "0"`, execute and verify configuration and router proposals,
then migrate one explicitly reviewed asset at a time. Do not disable the legacy
custody path or transfer its remaining balance until deposits and withdrawals
complete successfully against the new vault.

## Advanced Configuration

**Optional environment variables:**

- `INIT_METHOD` - Initializer function name (default: "initialize")
- `PROXY_KIND` - Type of proxy (default: "uups")
- `SAVE_DEPLOYMENT` - Save deployment info (default: true)

**Example with custom settings:**

```bash
CONTRACT_NAME=DepositRouter \
INIT_PARAMS='["0xSAFE", "0xOWNER"]' \
INIT_METHOD=initialize \
PROXY_KIND=uups \
npm run deployWithProxy:sepolia
```

## Troubleshooting

**Common Issues:**

### "Contract not found"

**Solution:** Run `npm run compile` and check contract name

### "Invalid INIT_PARAMS"

**Solution:** Verify JSON array format: `'["addr1", "addr2"]'`

### "Network error"

**Solution:** Check RPC URL and internet connection

### "Unable to update lock within the stale threshold"

**Solution:** Remove stale lock files:

```bash
rm -rf .openzeppelin/chain-*.lock
```

**Debug Tips:**

### 💡 Pre-deployment Checklist

- Always run `npm run compile` before deployment
- Contract names are case-sensitive
- Use single quotes around INIT_PARAMS JSON: `'["param1", "param2"]'`
- Check your `.env` file for correct values
- Ensure sufficient ETH balance for gas fees
