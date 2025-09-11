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
