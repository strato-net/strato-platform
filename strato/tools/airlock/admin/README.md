# Railgun Admin Scripts

Scripts for deploying and configuring the Railgun contract on STRATO.

## Prerequisites

- Run `airlock login` first to authenticate (token stored in `~/.secrets/stratoToken`)
- jq and curl must be installed

## Scripts

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
