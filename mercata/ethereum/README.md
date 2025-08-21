# Mercata Ethereum Deployment

Modular Hardhat setup for deploying any Mercata contracts to Ethereum networks with UUPS upgradeable proxy support.

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

3. **Compile contracts:**
   ```bash
   npx hardhat compile
   ```

## Modular Proxy Deployment

The `deployWithProxy.js` script allows you to deploy any UUPS upgradeable contract using environment variables for configuration.

### Basic Usage

```bash
CONTRACT_NAME=<ContractName> INIT_PARAMS='[param1, param2, ...]' npx hardhat run scripts/deployWithProxy.js --network <network>
```

### Required Environment Variables

- **CONTRACT_NAME**: Name of the contract to deploy
- **INIT_PARAMS**: JSON array of initialization parameters

### Optional Environment Variables

- **INIT_METHOD**: Initializer function name (default: "initialize")
- **PROXY_KIND**: Type of proxy (default: "uups")
- **SKIP_VERIFICATION**: Skip post-deployment checks (default: false)
- **AUTO_VERIFY**: Auto-verify on Etherscan after deployment (default: false)
- **SAVE_DEPLOYMENT**: Save deployment info to file (default: true)

## Usage Examples

### Deploy DepositRouter

```bash
# Deploy DepositRouter with specific addresses
CONTRACT_NAME=DepositRouter INIT_PARAMS='["0x8713850E9fF0fd0200ce87C32E3cdB24eD021631", "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631"]' npx hardhat run scripts/deployWithProxy.js --network sepolia

# Deploy with auto-verification
CONTRACT_NAME=DepositRouter INIT_PARAMS='["0x8713850E9fF0fd0200ce87C32E3cdB24eD021631", "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631"]' AUTO_VERIFY=true npx hardhat run scripts/deployWithProxy.js --network sepolia
```

### Deploy ERC20 Token

```bash
# Deploy with name, symbol, and initial supply
CONTRACT_NAME=MyToken INIT_PARAMS='["MyToken", "MTK", 1000000]' npx hardhat run scripts/deployWithProxy.js --network sepolia
```

### Deploy with Complex Parameters

```bash
# Multiple parameter types (addresses, numbers, booleans, strings)
CONTRACT_NAME=ComplexContract INIT_PARAMS='["0x123...", true, 1000, "string param"]' npx hardhat run scripts/deployWithProxy.js --network sepolia
```

### Deploy with Custom Initializer

```bash
# Use custom initialization method
CONTRACT_NAME=MyContract INIT_PARAMS='["param1", "param2"]' INIT_METHOD="initializeCustom" npx hardhat run scripts/deployWithProxy.js --network sepolia
```

## Advanced Usage

### Using NPM Scripts

```bash
# Using predefined scripts (see package.json)
npm run deploy:sepolia:deposit-router
npm run deploy:mainnet:token
```

### Skip Verification During Deployment

```bash
CONTRACT_NAME=MyContract INIT_PARAMS='["param1"]' SKIP_VERIFICATION=true npx hardhat run scripts/deployWithProxy.js --network sepolia
```

### Deploy without Saving Files

```bash
CONTRACT_NAME=MyContract INIT_PARAMS='["param1"]' SAVE_DEPLOYMENT=false npx hardhat run scripts/deployWithProxy.js --network sepolia
```

## Standard Deployment (Non-Proxy)

For contracts that don't need upgradeability:

```bash
# Deploy with constructor arguments
npx hardhat run scripts/deploy.js --network sepolia MyToken "Token Name" "SYMBOL" 1000000

# Simple deployment
npx hardhat run scripts/deploy.js --network sepolia SimpleContract
```

## Contract Verification

### Automatic Verification

```bash
# Verify during deployment
CONTRACT_NAME=MyContract INIT_PARAMS='["param1"]' AUTO_VERIFY=true npx hardhat run scripts/deployWithProxy.js --network sepolia
```

### Manual Verification

```bash
# For proxy contracts (implementation will be verified)
npx hardhat verify --network sepolia IMPLEMENTATION_ADDRESS

# For standard contracts with constructor args
npx hardhat verify --network sepolia CONTRACT_ADDRESS "arg1" "arg2"
```

## Configuration

The deployment script is fully modular and requires no modification for new contracts:

- **deployWithProxy.js**: Deploy any contract as a UUPS upgradeable proxy
  - Uses environment variables for all configuration
  - Supports automatic Etherscan verification
  - Saves deployment information to JSON files
  - Performs post-deployment validation checks
- **deploy.js**: Deploy any contract directly without proxy
  - Pass constructor arguments directly as CLI arguments

## Environment Variables

**Required for deployment:**

- `SEPOLIA_RPC_URL` - Sepolia testnet RPC endpoint
- `MAINNET_RPC_URL` - Ethereum mainnet RPC endpoint
- `PRIVATE_KEY` - Deployer wallet private key
- `ETHERSCAN_API_KEY` - For contract verification

**Example .env file:**

```bash
# Network Configuration
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your-project-id
MAINNET_RPC_URL=https://mainnet.infura.io/v3/your-project-id
PRIVATE_KEY=your-private-key-here
ETHERSCAN_API_KEY=your-etherscan-api-key

# Contract-specific addresses (optional, for reference)
GNOSIS_SAFE_ADDRESS=0x8713850E9fF0fd0200ce87C32E3cdB24eD021631
OWNER_ADDRESS=0x123...
```

## Deployment Output

The script provides comprehensive deployment information:

- **Contract Addresses**: Proxy, Implementation, and ProxyAdmin addresses
- **Deployment Checks**: Calls common getter functions to verify deployment
- **File Output**: Saves deployment info to `deployments/` directory
- **Next Steps**: Provides verification commands and configuration guidance

Example output files:

- `deployments/MyContract_sepolia_latest.json`
- `deployments/MyContract_sepolia_2024-01-01T12-00-00-000Z.json`

## Post-Deployment

After deployment, you'll typically need to:

1. **Configure contract-specific settings**

   - For DepositRouter: `setTokenAllowed()`, `setMinDepositAmount()`, `batchUpdateTokens()`
   - For tokens: `mint()`, `transfer()`, etc.

2. **Set up permissions and admin roles**

   - Grant/revoke roles as needed
   - Transfer ownership if required

3. **Verify contract transparency**

   - Contracts are automatically verified if `AUTO_VERIFY=true`
   - Manual verification commands are provided in output

4. **Update application configuration**
   - Use the proxy address for all interactions
   - Update frontend/backend with new contract addresses

## Troubleshooting

**Common Issues:**

1. **"Contract not found"** - Ensure the contract is compiled and the name matches exactly
2. **"Invalid INIT_PARAMS"** - Verify JSON array format and parameter types
3. **"Deployment failed"** - Check deployer balance and network connectivity
4. **"Verification failed"** - Ensure ETHERSCAN_API_KEY is set and contract is unique

**Debug Mode:**

```bash
# Skip verification to isolate deployment issues
SKIP_VERIFICATION=true CONTRACT_NAME=MyContract INIT_PARAMS='["param1"]' npx hardhat run scripts/deployWithProxy.js --network sepolia
```
