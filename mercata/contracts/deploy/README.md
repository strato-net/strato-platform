# Deploy Directory

This directory contains deployment and upgrade scripts for the Mercata contract system on BlockApps STRATO.

## Overview

The deploy directory provides a toolkit for deploying and managing Mercata smart contracts, including:
- Initial deployment of the full Mercata code collection
- Proxy contract upgrades for existing deployments
- Authentication and configuration management
- Utility functions for contract interactions

## Files

### Main Scripts

#### `deploy.js`
Main deployment script that deploys the complete Mercata code collection.

**Usage**:
```bash
npm run deploy
```

**Required Environment Variables**:
- `GLOBAL_ADMIN_NAME` - Username of the deployer
- `GLOBAL_ADMIN_PASSWORD` - Password of the deployer
- `NODE_URL` - STRATO node URL
- `OAUTH_URL` - OAuth discovery URL
- `OAUTH_CLIENT_ID` - OAuth client ID
- `OAUTH_CLIENT_SECRET` - OAuth client secret

**Output**: Prints all deployed contract addresses, including `SaveUSDSTVault`, `StratoNativeBridge`, and `StratoNativeCustodyVault`, and provides ready-to-paste `.env` snippets.

**Native bridge role seeding**:
- During full `Mercata` deployment, the native STRATO contracts now take explicit `bridgeOperator`, `admin`, and `guardian` addresses in `initialize(...)`.
- The bundled `BaseCodeCollection` deploy seeds those direct-call roles to the deploying admin account (`tx.origin`) rather than the proxy owner.
- This avoids the native runtime roles pointing at `AdminRegistry`, whose governance execution path does not satisfy the native bridge's direct role checks.
- After deployment, rotate these roles as needed using the native bridge and custody vault setter functions once your intended operator, admin, and guardian addresses are known.

#### `upgrade.js`
Script for upgrading existing proxy contracts to new implementations.

**Usage**:
```bash
node upgrade.js --proxy-address <address> --contract-name <name> --contract-file <file>
```

**Required Arguments**:
- `--proxy-address` - Address of the proxy contract to upgrade
- `--contract-name` - Name of the implementation contract (e.g., PoolFactory)
- `--contract-file` - Path to contract file from (e.g., Pools/PoolFactory.sol)

**Optional Arguments**:
- `--constructor-args` - JSON string of constructor arguments
  - These will be applied only to the implementation contract, not the proxy
  - This argument is required if the format of the newly deployed constructor differs from `constructor(address initialOwner)`;
    - its default is `{"initialOwner":"deadbeef"}`; this value will be ignored by the proxy
- `+OVERRIDE-CHECKS` - Skip contract name verification check
  - This flag is currently recommended due to a high false positive rate in the checker

**Required Environment Variables**:
- `GLOBAL_ADMIN_NAME` - Username of the upgrader
- `GLOBAL_ADMIN_PASSWORD` - Password of the upgrader
- `NODE_URL` - STRATO node URL
- `OAUTH_URL` - OAuth discovery URL
- `OAUTH_CLIENT_ID` - OAuth client ID
- `OAUTH_CLIENT_SECRET` - OAuth client secret

**Output**:

When successful, the upgrade script will give output in one of the following styles depending on whether additional governance votes are needed to approve the upgrade:

```
====== Upgrade Successful ======
Proxy Address: 1002
New Implementation: c3b1d56051f8173209a4ac455c80bb2ec4b25deb
================================
```

```
======  Upgrade  Pending  ======
Proxy Uploaded and Upgrade Requested.
Governance Vote Required.
Vote Issue ID: 56ec75ebe9c78448bead9e285fb2d63ad7725cd0ee3592dcbe9005f8a814734d
Proxy Address: 100c
New Implementation: eb315fdcfed2e7bee070f65195046b18895bb2db
================================
```

If Upgrade Pending is observed, the Vote Issue ID may be used to locate the issue in the Vote on Issues tab of the governance interface. In the above example, the issue `56ec75ebe9c78448bead9e285fb2d63ad7725cd0ee3592dcbe9005f8a814734d` will be a proposal to call `Proxy(100c).setLogicContract(eb315fdcfed2e7bee070f65195046b18895bb2db)`.

**Examples**:
```bash
node upgrade.js \
  --proxy-address 100a \
  --contract-name PoolFactory \
  --contract-file Pools/PoolFactory.sol

npm run upgrade -- \
  --proxy-address 1002 \
  --contract-name PriceOracle \
  --contract-file Lending/PriceOracle.sol \
  --constructor-args '{"_owner":"deadbeef"}' \
  +OVERRIDE-CHECKS
```

It may be scripted in a manner such as the following:
```bash
#!/bin/bash
set -e

# Define upgrade triples: proxy_address contract_name contract_file
# Note that constructor arguments must follow the correct format but are otherwise ignored
# (They are set in the implementation contract's storage, not the proxy)
UPGRADES=(
  1002 PriceOracle Lending/PriceOracle.sol '{"_owner": "deadbeef"}'
  1003 CollateralVault Lending/CollateralVault.sol '{"initialOwner": "deadbeef"}'
  1004 LiquidityPool Lending/LiquidityPool.sol '{"_owner": "deadbeef"}'
  1005 LendingPool Lending/LendingPool.sol '{"initialOwner": "deadbeef"}'
  1006 PoolConfigurator Lending/PoolConfigurator.sol '{"initialOwner": "deadbeef"}'
  1007 LendingRegistry Lending/LendingRegistry.sol '{"initialOwner": "deadbeef"}'
  1008 MercataBridge Bridge/MercataBridge.sol '{"_owner": "deadbeef"}'
  100a PoolFactory Pools/PoolFactory.sol '{"initialOwner": "deadbeef"}'
  100b TokenFactory Tokens/TokenFactory.sol '{"initialOwner": "deadbeef"}'
  100c AdminRegistry Admin/AdminRegistry.sol '{}'
  100d FeeCollector Admin/FeeCollector.sol '{"_owner": "deadbeef"}'
  100e Voucher Voucher/Voucher.sol '{}'
  100f Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
  1011 CDPEngine CDP/CDPEngine.sol '{"initialOwner": "deadbeef"}'
  1012 CDPRegistry CDP/CDPRegistry.sol '{"initialOwner": "deadbeef"}'
  1013 CDPVault CDP/CDPVault.sol '{"initialOwner": "deadbeef"}'
  1014 CDPReserve CDP/CDPReserve.sol '{"_owner": "deadbeef"}'
  1015 SafetyModule Lending/SafetyModule.sol '{"initialOwner": "deadbeef"}'
  1016 Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
  1017 Pool Pools/Pool.sol '{"initialOwner": "deadbeef"}'
  1018 Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
  1019 Pool Pools/Pool.sol '{"initialOwner": "deadbeef"}'
  101a Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
  101b Pool Pools/Pool.sol '{"initialOwner": "deadbeef"}'
  101c Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
  101d Pool Pools/Pool.sol '{"initialOwner": "deadbeef"}'
  101e Token Tokens/Token.sol '{"initialOwner": "deadbeef"}'
)

# Process in groups of 4
for ((i=0; i<${#UPGRADES[@]}; i+=4)); do
  PROXY_ADDRESS="${UPGRADES[i]}"
  CONTRACT_NAME="${UPGRADES[i+1]}"
  CONTRACT_FILE="${UPGRADES[i+2]}"
  CONSTRUCTOR_ARGS="${UPGRADES[i+3]}"
  
  echo "npm run upgrade -- --proxy-address $PROXY_ADDRESS --contract-name $CONTRACT_NAME --contract-file $CONTRACT_FILE --constructor-args '$CONSTRUCTOR_ARGS' +OVERRIDE-CHECKS"
  npm run upgrade -- --proxy-address "$PROXY_ADDRESS" --contract-name "$CONTRACT_NAME" --contract-file "$CONTRACT_FILE" --constructor-args "$CONSTRUCTOR_ARGS" +OVERRIDE-CHECKS
done
```

#### `initialize-native-bridge.js`
Initialize freshly deployed `StratoNativeBridge` and `StratoNativeCustodyVault` proxies.

**Usage**:
```bash
npm run initialize:native-bridge -- \
  --bridge-address <bridge-proxy> \
  --vault-address <vault-proxy> \
  --token-factory <token-factory> \
  --bridge-operator <operator> \
  --guardian <guardian>
```

**Required Arguments**:
- `--bridge-address` - Proxy address of `StratoNativeBridge`
- `--vault-address` - Proxy address of `StratoNativeCustodyVault`
- `--token-factory` - STRATO `TokenFactory` address
- `--bridge-operator` - Runtime operator allowed to process native deposits/withdrawals
- `--guardian` - Guardian allowed to pause the native bridge and custody vault

**What it does**:
- Calls `StratoNativeBridge.initialize(_tokenFactory, _custodyVault, _bridgeOperator, _guardian)`
- Calls `StratoNativeCustodyVault.initialize(_bridge, _guardian)`
- Leaves route/config/wiring changes under owner governance (`AdminRegistry` when used as proxy owner)
- Prints governance vote IDs if either initialize call requires approval

#### `configure-native-route.js`
Configure or update a native STRATO bridge route on `StratoNativeBridge`.

**Usage**:
```bash
npm run configure:native-route -- \
  --bridge-address <bridge-proxy> \
  --external-chain-id <chain-id> \
  --external-bridge <external-bridge> \
  --representation-token <representation-token> \
  --external-name <name> \
  --external-symbol <symbol> \
  --max-per-withdrawal <amount> \
  --strato-token <strato-token> \
  [--enabled <true|false>]
```

**Required Arguments**:
- `--bridge-address` - Proxy address of `StratoNativeBridge`
- `--external-chain-id` - External chain ID for the route
- `--external-bridge` - External representation bridge expected for this route
- `--representation-token` - External representation token mapped to the STRATO token
- `--external-name` - Display name for the external asset
- `--external-symbol` - Display symbol for the external asset
- `--max-per-withdrawal` - Per-withdrawal cap as an unsigned integer string (`0` disables the cap)
- `--strato-token` - STRATO token address backing the route

**Optional Arguments**:
- `--enabled` - Route enabled flag (`true` by default)

**What it does**:
- Calls `StratoNativeBridge.setAsset(enabled, externalChainId, externalBridge, representationToken, externalName, externalSymbol, maxPerWithdrawal, stratoToken)`
- Prints a governance vote ID if the route update requires approval

## Directory Structure

```
deploy/
├── auth.js         # Authentication utilities
├── config.js       # Configuration management
├── contract.js     # Contract compilation and deployment
├── deploy.js       # Main code collection deployment script
├── README.md       # This file
├── upgrade.js      # Proxy upgrade script
└── util.js         # General utility functions
```
