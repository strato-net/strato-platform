# Scripts Directory

This directory contains utility scripts for the Mercata contracts system.

## Available Scripts

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
└── token-transfer/           # Token transfer utilities
    ├── contestTransfer.js    # Transfer script
    ├── README.md            # Documentation
    └── env.example          # Sample environment config
```

## Adding New Scripts

When adding new scripts to this directory:

1. Create a new subdirectory for related functionality
2. Include a README.md with usage instructions
3. Follow the existing patterns for error handling and logging
4. Use the shared utilities from `../deploy/util.js`