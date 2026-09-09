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

### DepositRouter configuration verification

Pass the finalized rollout manifest to verify the deployed DepositRouter
against every generated token and route:

```bash
ROLLOUT_MANIFEST=/secure/path/eab-rollout/external-bridge-rollout-manifest-11155111.json npm run scan:sepolia
```

The command checks the chain, deployed bytecode, paused state, Safe owner,
vault, token minimums, token permissions, every expected route, and every
route observed since deployment. It exits nonzero on missing, mismatched, or
unexpected enabled routes. `DEPOSIT_ROUTER_ADDRESS` is optional in manifest
mode; when supplied, it must match the manifest. Without
`ROLLOUT_MANIFEST`, the command prints a non-validating token summary for the
address in `DEPOSIT_ROUTER_ADDRESS`.

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

### Pair deployment

The pair deployer creates one `ExternalBridgeVault` proxy and one
`DepositRouter` proxy, verifies their initial wiring and roles, and records the
deployment blocks in a network-specific artifact. Set
`CHAIN_<ID>_DEPLOYMENT_CONFIRMATIONS` to the approved finality depth for each
network; deployment artifacts are written only after both transactions reach
that depth.

```bash
npm run deployExternalBridge:sepolia
npm run deployExternalBridge:baseSepolia
npm run deployExternalBridge:lineaSepolia
npm run deployExternalBridge:mainnet
npm run deployExternalBridge:base
npm run deployExternalBridge:linea
```

Each command is preflight-only unless `--execute` is supplied. Production
execution also requires the exact destination chain ID:

```bash
npm run deployExternalBridge:sepolia -- --execute
npm run deployExternalBridge:baseSepolia -- --execute
npm run deployExternalBridge:lineaSepolia -- --execute
CONFIRM_EXTERNAL_BRIDGE_DEPLOY=1 npm run deployExternalBridge:mainnet -- --execute
CONFIRM_EXTERNAL_BRIDGE_DEPLOY=8453 npm run deployExternalBridge:base -- --execute
CONFIRM_EXTERNAL_BRIDGE_DEPLOY=59144 npm run deployExternalBridge:linea -- --execute
```

Set the network RPC URL and `PRIVATE_KEY`. Safe, vault-role, and Permit2
variables are prefixed with the destination chain ID, for example
`CHAIN_11155111_SAFE_ADDRESS` and
`CHAIN_11155111_VAULT_DEFAULT_ADMIN_ADDRESS`. Confirmation depth uses the same
prefix, for example `CHAIN_11155111_DEPLOYMENT_CONFIRMATIONS`. Preflight checks the network,
signer balance, Safe and Permit2 bytecode, and UUPS implementation safety
without submitting transactions. Production output is written to
`deployments/ExternalBridgePair_<network>_*.json`; testnets use
`ExternalBridgeTestnetPair_<network>_*.json`.

### 1. Development

Compile and run the contract and rollout-plan tests:

```bash
npm run compile
npx hardhat test test/ExternalBridgeVault.js test/DepositRouter.test.js
npm run external:deploy:test
npm run external:vault:ops:test
npm run external:rollout:test
```

### All-token configuration generator

First run `router:ops:testnet -- --step setters` as a dry run. Its audit JSON
contains every enabled legacy route and the external token metadata needed by
the generator. Discovery fails if any enabled legacy route references a STRATO
token that is not currently `ACTIVE`; activate that token or disable the stale
legacy route before continuing. Create a settings file containing `sourceChainId`,
`externalDeployment`, `depositPlan`, `tokenRouter`, `externalAssetBridge`,
`bridgeOperator`, `guardian`, and exactly three `settlementVerifiers`.

Prepare the derived bridge/vault templates, inventory, and fail-closed policy:

```bash
npm run external:rollout:prepare -- --settings /secure/path/eab-settings.json --output-dir /secure/path/eab-rollout
```

The external deployment artifact supplies the chain ID, Safe, vault,
DepositRouter, guardian, and initial block. For deployments created before
`depositRouterDeploymentBlock` was recorded, set that field in the settings
file. Preparation never overwrites an existing policy.

Replace every `REVIEW_REQUIRED` risk amount and every route's
`rebaseRequired` value with an explicitly reviewed boolean. Then finalize:

```bash
npm run external:rollout:finalize -- --settings /secure/path/eab-settings.json --policy /secure/path/eab-rollout/external-bridge-rollout-policy-11155111.json --output-dir /secure/path/eab-rollout
```

Finalization fails if token metadata, risk policy, deployment addresses, or
chain IDs are missing or inconsistent. It also requires withdrawals and
AUTO_ROUTE to remain disabled and every `migrateAmount` to remain zero. It
never copies legacy withdrawal limits or submits transactions. The existing
`external:rollout:generate` command remains available for manually supplied
bridge and vault templates.

After Safe configuration, verify DepositRouter against the generated manifest:

```bash
cd app/ethereum && ROLLOUT_MANIFEST=/secure/path/eab-rollout/external-bridge-rollout-manifest-11155111.json npm run scan:sepolia
```

Use the matching scanner for the manifest network:
`scan:sepolia`, `scan:baseSepolia`, `scan:lineaSepolia`, `scan:mainnet`,
`scan:base`, or `scan:linea`.

After the corresponding AdminRegistry votes execute, verify STRATO
initialization, routes and approved actions:

Commands using `--execute` or a `verify-*` step require
`GLOBAL_ADMIN_NAME`, `GLOBAL_ADMIN_PASSWORD`, `OAUTH_CLIENT_SECRET`,
`OAUTH_CLIENT_ID`, `OAUTH_URL`, and `NODE_URL`.
Before a `routes --execute` run submits any vote, it verifies that every
deposit- or withdrawal-enabled route references an `ACTIVE` STRATO token.
If execution stops after earlier calls succeeded, resolve the failure and rerun
the same administrator with `--start-call <FAILED_CALL_NUMBER>`. The failure
message and partial output JSON record that one-based call number.

```bash
cd app/contracts && npm run configure:external-bridge -- --config <EAB_ROLLOUT_DIRECTORY>/external-bridge-11155111.json --step verify-initialize --output-dir <EAB_ROLLOUT_DIRECTORY>
cd app/contracts && npm run configure:external-bridge -- --config <EAB_ROLLOUT_DIRECTORY>/external-bridge-11155111.json --step verify-routes --output-dir <EAB_ROLLOUT_DIRECTORY>
cd app/contracts && npm run configure:external-bridge -- --config <EAB_ROLLOUT_DIRECTORY>/external-bridge-11155111.json --step verify-actions --output-dir <EAB_ROLLOUT_DIRECTORY>
```

Route and action plans are symmetric: they emit explicit true or false values
for rebase requirements and AUTO_ROUTE settings, so the same commands support
initial rollout, policy changes and rollback. Route and action verification are
independent, so `verify-routes` remains valid after AUTO_ROUTE activation.

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
