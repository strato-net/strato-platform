# Token Transfer Script

Script for transferring tokens to users using environment variables.

## Usage

```bash
# Copy the sample environment file
cp env.example .env

# Edit .env with your values
# Then run the script
node contestTransfer.js
```

Or set environment variables directly:
```bash
export USER_ADDRESS=1234567890abcdef...
export USDST=1000
export bCSPXST=50
export GOLDST=25

node contestTransfer.js
```

## Environment Variables

### Required
- `USER_ADDRESS` - Target user's Ethereum address (without 0x prefix)

### Optional (set only the tokens you want to transfer)
- `USDST` - USDST token amount (in token units, not wei)
- `bCSPXST` - bCSPXST token amount (in token units, not wei)
- `SILVST` - SILVST token amount (in token units, not wei)
- `GOLDST` - GOLDST token amount (in token units, not wei)
- `WBTCST` - WBTCST token amount (in token units, not wei)
- `ETHST` - ETHST token amount (in token units, not wei)

## Features

- Hardcoded token addresses (no CSV needed)
- Automatic wei conversion using ethers.js
- Clean, minimal output
- Detailed transaction logging

## Output

```
Transferring to 1234567890abcdef...:
  USDST: 1000 (1000000000000000000000 wei)
  bCSPXST: 50 (50000000000000000000 wei)
  GOLDST: 25 (25000000000000000000 wei)
Executing 3 transfers...

Results: 3/3 successful
Total transferred: 1075.000000 tokens
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