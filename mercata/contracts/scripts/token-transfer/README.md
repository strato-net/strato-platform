# Token Transfer Script

Script for transferring tokens to users using environment variables. Supports both single transfers and batch transfers to multiple addresses with multiple amounts per token.

## Usage

```bash
# Copy the sample environment file
cp env.example .env

# Edit .env with your values
# Then run the script
node contestTransfer.js
```

Or set environment variables directly:

### Single User Transfer
```bash
export USER_ADDRESS=1234567890abcdef...
export USDST=1000
export bCSPXST=50
export GOLDST=25

node contestTransfer.js
```

### Multiple User Transfer
```bash
export USER_ADDRESSES="1234567890abcdef...,abcdef1234567890...,fedcba0987654321..."
export USDST=1000
export bCSPXST=50
export GOLDST=25

node contestTransfer.js
```

### Array Token Amounts
```bash
export USER_ADDRESS=1234567890abcdef...
export USDST_ARRAY="500,1000,1500"
export bCSPXST_ARRAY="25,50,75"

node contestTransfer.js
```

## Environment Variables

### Required (choose one)
- `USER_ADDRESS` - Single target user's Ethereum address (without 0x prefix)
- `USER_ADDRESSES` - Comma-separated list of target user addresses (without 0x prefix)

### Token Amounts (optional - set only the tokens you want to transfer)

#### Single Amounts (transferred to all users)
- `USDST` - USDST token amount (in token units, not wei)
- `bCSPXST` - bCSPXST token amount (in token units, not wei)
- `SILVST` - SILVST token amount (in token units, not wei)
- `GOLDST` - GOLDST token amount (in token units, not wei)
- `WBTCST` - WBTCST token amount (in token units, not wei)
- `ETHST` - ETHST token amount (in token units, not wei)

#### Array Amounts (comma-separated, each amount transferred to all users)
- `USDST_ARRAY` - Multiple USDST amounts, e.g., "100,500,1000"
- `bCSPXST_ARRAY` - Multiple bCSPXST amounts, e.g., "25,50,75"
- `SILVST_ARRAY` - Multiple SILVST amounts
- `GOLDST_ARRAY` - Multiple GOLDST amounts
- `WBTCST_ARRAY` - Multiple WBTCST amounts
- `ETHST_ARRAY` - Multiple ETHST amounts

## Features

- Hardcoded token addresses (no CSV needed)
- Support for single or multiple user addresses
- Support for single token amounts or arrays of amounts per token
- Automatic wei conversion using ethers.js
- Detailed per-user transfer summaries
- Comprehensive transaction logging with reports

## Output Examples

### Single User Transfer
```
Transferring to 1 address(es):
  [1] 1234567890abcdef...

  USDST: 1000 (1000000000000000000000 wei)
  bCSPXST: 50 (50000000000000000000 wei)
  GOLDST: 25 (25000000000000000000 wei)
Executing 3 transfers...

Results: 3/3 successful

Per-user summary:
  1234567890abcdef...: 3 successful, 0 failed, 1075.000000 tokens transferred
```

### Multiple User Transfer
```
Transferring to 2 address(es):
  [1] 1234567890abcdef...
  [2] abcdef1234567890...

  USDST: 1000 (1000000000000000000000 wei)
  bCSPXST: 50 (50000000000000000000 wei)
Executing 4 transfers...

Results: 4/4 successful

Per-user summary:
  1234567890abcdef...: 2 successful, 0 failed, 1050.000000 tokens transferred
  abcdef1234567890...: 2 successful, 0 failed, 1050.000000 tokens transferred
```

## Token Addresses

All token addresses are hardcoded (without 0x prefix):
- USDST: `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`
- bCSPXST: `47de839c03a3b014c0cc4f3b9352979a5038f910`
- SILVST: `2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94`
- GOLDST: `cdc93d30182125e05eec985b631c7c61b3f63ff0`
- WBTCST: `7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9`
- ETHST: `93fb7295859b2d70199e0a4883b7c320cf874e6c`

## Dependencies

- `ethers` - For wei conversion and BigInt handling
- `blockapps-rest` - For blockchain interactions 