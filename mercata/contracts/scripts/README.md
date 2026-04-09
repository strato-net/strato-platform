# Scripts Directory

This directory contains utility scripts for the Mercata contracts system.

## Available Scripts

### Yield Vault Live Tools
**Location**: `yield-vault-live/`

Read-only and direct-call tools for inspecting and exercising deployed
`YieldVault` contracts on STRATO testnet/mainnet using an authenticated bearer
token from `strato-auth`.

- **Script**: `inspectLiveVault.js` - Inspect live vault state, mappings, and current recommended next calls
- **Script**: `vaultDirectFlow.js` - Send direct calls such as strategy approval, deposit, deploy, return, and redeem

**Usage**:
```bash
cd yield-vault-live
node inspectLiveVault.js
node vaultDirectFlow.js inspect
```

### Token Transfer Script
**Location**: `token-transfer/`

Script for transferring tokens to users using environment variables.

- **Script**: `contestTransfer.js` - Transfers tokens to a specific user
- **Documentation**: `README.md`
- **Sample Config**: `env.example`

**Usage**:
```bash
cd token-transfer
node contestTransfer.js
```

See the `token-transfer/README.md` for detailed documentation.

## Directory Structure

```
scripts/
├── README.md                 # This file
├── token-transfer/           # Token transfer utilities
│   ├── contestTransfer.js    # Transfer script
│   ├── README.md             # Documentation
│   └── env.example           # Sample environment config
└── yield-vault-live/         # Live deployed vault inspection/call tools
    ├── common.js             # Shared auth/query/transaction helpers
    ├── inspectLiveVault.js   # Read-only live state inspector
    └── vaultDirectFlow.js    # Direct call CLI for live vault testing
```

## Adding New Scripts

When adding new scripts to this directory:

1. Create a new subdirectory for related functionality
2. Include a README.md with usage instructions
3. Follow the existing patterns for error handling and logging
4. Use the shared utilities from `../deploy/util.js` 