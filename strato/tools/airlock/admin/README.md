# Railgun Admin Scripts

Scripts for deploying and configuring the Railgun contract on STRATO.

## Prerequisites

- Run `strato-auth` first to authenticate (token stored in `~/.secrets/stratoToken`)
- jq and restish must be installed
- For bash autocomplete, source the completion script

## Initial Setup

### setup-restish.sh

Configures restish to work with the STRATO API. Run this once per machine, or whenever you need to update the API spec.

```bash
./setup-restish.sh [strato-host]

# Example with custom host:
./setup-restish.sh my-strato-node:8081
```

This script:
1. Downloads the swagger spec from your running STRATO instance
2. Creates an auth helper script that uses `strato-auth`
3. Creates/updates `~/.config/restish/apis.json` with auth configuration

After setup, restish commands like `restish strato post-bloc-transaction --resolve` will work.

## Tools

### strato-call

A CLI tool for calling Solidity contract functions with tab completion.

```bash
# Register contracts for easy access
./strato-call --register usdst 937efa7e3a77e20bbdbd7c0d32b6514f368c1010 USDST
./strato-call --register railgun 95be101d075f44084ca1cf51d0106c8606773952 RailgunSmartWallet

# List registered contracts
./strato-call --list-contracts

# List functions for a contract
./strato-call --list-functions usdst

# Show function parameters
./strato-call --function-info usdst transfer

# Call a function
./strato-call usdst balanceOf accountAddress=f1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14
./strato-call usdst transfer to=... value=1000000000000000000
```

#### Tab Completion Setup

**Bash:**
```bash
# Add to your ~/.bashrc:
source /path/to/strato-call-completion.bash
```

**Zsh:**
```bash
# Copy to your fpath and add to ~/.zshrc:
fpath=(/path/to/airlock/admin $fpath)
autoload -Uz compinit && compinit
```

After setup, tab completion works for:
- Contract aliases (first argument)
- Function names (second argument)
- Function parameters (subsequent arguments)

## Deployment Scripts

### deploy-railgun.sh

Deploys the Railgun contract to STRATO.

```bash
./deploy-railgun.sh [base_url]
```

- `base_url`: STRATO API URL (default: http://localhost:8081)

Example:
```bash
./deploy-railgun.sh http://localhost:8081
```

Note the contract address from the output - you'll need it for subsequent commands.

### set-verifier-key.sh

Sets a verification key for a specific circuit size on the Railgun contract.

```bash
./set-verifier-key.sh <contract_address> <nullifiers> <commitments> [base_url]
```

- `contract_address`: Address of deployed RailgunSmartWallet
- `nullifiers`: Number of nullifiers in the circuit
- `commitments`: Number of commitments in the circuit
- `base_url`: STRATO API URL (default: http://localhost:8081)

Example:
```bash
./set-verifier-key.sh 959b55477e53900402fdbb2633b56709d252cadd 1 1
```

## Verifier Keys

Verifier keys are stored in `verifier-keys/` as JSON files named `key-{nullifiers}-{commitments}.json`.

These keys were extracted from the mainnet Railgun deployment at:
https://etherscan.io/address/0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9

Available keys:
- `key-1-1.json` - 1 nullifier, 1 commitment (pure unshield)

To add more keys, query mainnet with `getVerificationKey(nullifiers, commitments)` and format as JSON.

## Typical Setup Flow

1. Deploy contract:
   ```bash
   ./deploy-railgun.sh
   # Note the contract address
   ```

2. Set verification key(s):
   ```bash
   ./set-verifier-key.sh <address> 1 1
   ```

3. Update airlock config or use the new contract address with airlock commands.
