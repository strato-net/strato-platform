# Mercata Ethereum Deployment

Modular Hardhat setup for deploying Mercata contracts to Ethereum networks with UUPS upgradeable proxy support.

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
