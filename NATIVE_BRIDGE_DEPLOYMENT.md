# Native Bridge Deployment

Simple deployment steps for the native bridge split across:
- STRATO: `StratoNativeBridge` and `StratoNativeCustodyVault`
- Ethereum Sepolia: `StratoNativeRepresentationBridge` and `StratoNativeRepresentationToken`

## Naming

This guide uses different admin names on each side on purpose:
- `ADMIN_REGISTRY` = STRATO owner/governance address (`0x000000000000000000000000000000000000100c`)
- `SEPOLIA_ADMIN_SAFE` = Safe address passed into the Sepolia contracts as `admin`

On STRATO in this guide:
- config/governance actions are owner-driven
- `owner = ADMIN_REGISTRY`
- `bridgeOperator` is the only delegated runtime operator role

## STRATO

### Prereqs

From `mercata/contracts`, make sure your `.env` has:
- `GLOBAL_ADMIN_NAME`
- `GLOBAL_ADMIN_PASSWORD`
- `NODE_URL`
- `OAUTH_URL`
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`

Also decide these runtime addresses up front:
- `BRIDGE_OPERATOR`
- `GUARDIAN`

Recommended meaning on STRATO:
- `BRIDGE_OPERATOR` = relayer address used for routine native bridge execution
- `GUARDIAN` = pause address; this can also be `ADMIN_REGISTRY` if you do not want a separate guardian

And have these contract addresses ready:
- `ADMIN_REGISTRY` = `0x000000000000000000000000000000000000100c`
- `TOKEN_FACTORY`

### Step 1: Deploy a `Proxy` for `StratoNativeBridge`

Deploy `mercata/contracts/concrete/Proxy/Proxy.sol` and record the proxy address.

Use:
- `_initialOwner = ADMIN_REGISTRY`
- `_logicContract = <temporary logic address>`

The point of this step is just to create the proxy address first.

### Step 2: Upgrade that proxy to `StratoNativeBridge`

Run from `mercata/contracts`:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --contract-name StratoNativeBridge \
  --contract-file Bridge/StratoNativeBridge.sol \
  --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' \
  +OVERRIDE-CHECKS
```

### Step 3: Deploy a `Proxy` for `StratoNativeCustodyVault`

Again deploy `mercata/contracts/concrete/Proxy/Proxy.sol` and record the proxy address.

Use:
- `_initialOwner = ADMIN_REGISTRY`
- `_logicContract = <temporary logic address>`

### Step 4: Upgrade that proxy to `StratoNativeCustodyVault`

Run from `mercata/contracts`:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --contract-name StratoNativeCustodyVault \
  --contract-file Bridge/StratoNativeCustodyVault.sol \
  --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' \
  +OVERRIDE-CHECKS
```

### Step 5: Initialize bridge + vault

Run from `mercata/contracts`:

```bash
npm run initialize:native-bridge -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --vault-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --token-factory <TOKEN_FACTORY> \
  --bridge-operator <BRIDGE_OPERATOR> \
  --guardian <GUARDIAN>
```

For the simplest governance-driven STRATO setup, this is valid:

```text
BRIDGE_OPERATOR = <testnet relayer address>
GUARDIAN = 0x000000000000000000000000000000000000100c
```

This calls:
- `StratoNativeBridge.initialize(_tokenFactory, _custodyVault, _bridgeOperator, _guardian)`
- `StratoNativeCustodyVault.initialize(_bridge, _guardian)`

Important:
- `setAsset(...)`, `setTokenFactory(...)`, `setCustodyVault(...)`, and vault `setBridge(...)` are owner-governed on STRATO
- if `owner = ADMIN_REGISTRY`, the STRATO helper scripts are expected to work through owner/governance semantics

### Step 6: Configure the STRATO native route

Run from `mercata/contracts`:

```bash
npm run configure:native-route -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --external-chain-id 11155111 \
  --external-bridge <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY> \
  --representation-token <SEPOLIA_REPRESENTATION_TOKEN_PROXY> \
  --external-name "Wrapped Native STRATO" \
  --external-symbol wSTRATO \
  --max-per-withdrawal <MAX_PER_WITHDRAWAL> \
  --strato-token <STRATO_NATIVE_TOKEN> \
  --enabled true
```

Notes:
- `external-chain-id` is Sepolia for now: `11155111`
- `external-bridge` must be the Sepolia `StratoNativeRepresentationBridge` proxy
- `representation-token` must be the Sepolia `StratoNativeRepresentationToken` proxy

## Ethereum Sepolia

### Prereqs

From `mercata/ethereum`, make sure your `.env` has:
- `PRIVATE_KEY`
- `SEPOLIA_RPC_URL` (optional if you want to override the default public RPC)
- `ETHERSCAN_API_KEY` (optional, only needed for verify)

Note:
- with the current repo scripts, Sepolia deployment is still EOA-driven through `PRIVATE_KEY`
- the Safe is used as the contract admin after deployment by passing the Safe address as `SEPOLIA_ADMIN_SAFE` during initialization
- post-deploy admin actions should be executed from the Safe

Also decide:
- `SEPOLIA_ADMIN_SAFE`
- `BRIDGE_OPERATOR`

Recommended meaning on Sepolia:
- `SEPOLIA_ADMIN_SAFE` = Safe address
- `BRIDGE_OPERATOR` = relayer/operator address that will mint representations after verified STRATO withdrawals

And have ready:
- `STRATO_TOKEN` (the STRATO-side native token address this route represents)

### Step 1: Install and compile

Run from `mercata/ethereum`:

```bash
npm ci
npm run compile
```

### Step 2: Deploy the Sepolia representation token proxy

Run from `mercata/ethereum`:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken \
INIT_PARAMS='["Wrapped Native STRATO","wSTRATO","<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Use:
- deployer = EOA from `PRIVATE_KEY`
- `SEPOLIA_ADMIN_SAFE` = Safe address

Record:
- token proxy address
- token implementation address

### Step 3: Deploy the Sepolia representation bridge proxy

Run from `mercata/ethereum`:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge \
INIT_PARAMS='["<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Use:
- deployer = EOA from `PRIVATE_KEY`
- `SEPOLIA_ADMIN_SAFE` = Safe address

Record:
- bridge proxy address
- bridge implementation address

### Step 4: Execute the Sepolia Safe batch

Use the Sepolia Safe to execute the post-deploy admin transactions.

Saved batch file:
- `mercata/ethereum/deployments/sepolia-native-bridge-safe-batch.json`

This batch does:
- on `StratoNativeRepresentationToken`, `grantRole(BRIDGE_ROLE, <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>)`
- on `StratoNativeRepresentationBridge`, `grantRole(BRIDGE_OPERATOR_ROLE, <BRIDGE_OPERATOR>)`
- on `StratoNativeRepresentationBridge`, `registerTokenMapping(<STRATO_TOKEN>, <SEPOLIA_REPRESENTATION_TOKEN_PROXY>, false)`

`BRIDGE_OPERATOR` here is the Sepolia-side relayer/operator address.

### Step 5: Optional verify

If you want to verify implementations on Etherscan:

```bash
npm run verify:sepolia -- <IMPLEMENTATION_ADDRESS>
```

Verification is optional for bridge setup. It is not required to continue if:
- the Sepolia deployments succeeded
- the Safe batch executed successfully

### Step 6: Confirm the Sepolia Safe batch worked

Fastest checks:
- Safe shows the full batch executed successfully
- on the token proxy, `hasRole(BRIDGE_ROLE, <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>)` returns `true`
- on the bridge proxy, `hasRole(BRIDGE_OPERATOR_ROLE, <BRIDGE_OPERATOR>)` returns `true`
- on the bridge proxy, `stratoToRepresentation(<STRATO_TOKEN>)` returns `<SEPOLIA_REPRESENTATION_TOKEN_PROXY>`

### Step 7: Update bridge service config

Before running the native flow end to end, update the bridge service environment/config with:
- `STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>`
- `CHAIN_11155111_RPC_URL=<sepolia-rpc-url>` if it is not already configured
- ensure the relayer/operator address used on STRATO and Sepolia is the same `BRIDGE_OPERATOR` address

If the bridge service is deployed through `docker-compose.bridge.tpl.yml`, these values must be present in the runtime env file used by Compose as well. The template now forwards:
- `STRATO_NATIVE_BRIDGE_ADDRESS`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`

The existing bridge service still also requires its normal Safe envs:
- `SAFE_ADDRESS`
- `SAFE_PROPOSER_ADDRESS`
- `SAFE_PROPOSER_PRIVATE_KEY`

### Step 8: Restart or redeploy the bridge service

After env/config changes, restart the bridge service so it picks up:
- the STRATO native bridge address
- the Sepolia native representation bridge address
- the relayer/operator credentials and RPC settings

## Recommended Order

1. Deploy STRATO bridge proxy
2. Upgrade STRATO bridge proxy
3. Deploy STRATO vault proxy
4. Upgrade STRATO vault proxy
5. Deploy Sepolia token proxy
6. Deploy Sepolia bridge proxy
7. Initialize STRATO bridge + vault
8. Execute the Sepolia Safe batch
9. Confirm the Safe batch worked
10. Configure the STRATO route to point at Sepolia
11. Update bridge service config/env
12. Restart or redeploy the bridge service

## Known Script Behavior

- `initialize-native-bridge.js` uses async receipt polling because synchronous `blockapps-rest` contract calls can fail with `Cannot read properties of null (reading 'contents')`
- `configure-native-route.js` uses the same async receipt polling pattern for the same reason

## Addresses To Save

Keep these in your deployment notes or `.env`:
- `STRATO_NATIVE_BRIDGE_PROXY`  0x49f69252b00235030a4dcd4c7ef17a64ef346258
- `STRATO_NATIVE_CUSTODY_VAULT_PROXY`  0x8cfe7b576f69260673e9a1a9517137f12a49ed93
- `SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY` 0x80f6497E8F8700c89B3A0B030C3e71aa874f6CF7
- `SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_IMPL` 0x13037f8793ac6bFf3a9764e70Ec3650a16A5E525
- `SEPOLIA_REPRESENTATION_TOKEN_PROXY` 0x9Cd7eeF7c43d1c00f4ebb5619D60101eede94087 (for STRATO)
- `SEPOLIA_REPRESENTATION_TOKEN_IMPL` 0x47Fb6e8B371B25A06dDa608F1bC79fA2a135096E (for STRATO)
- `BRIDGE_OPERATOR` 0x8F7915BA636668542b48C6652868313b15A59496
- `SEPOLIA_ADMIN_SAFE` 0x8713850E9fF0fd0200ce87C32E3cdB24eD021631
- `GUARDIAN` 0x000000000000000000000000000000000000100c (can be a different address as well)
- `STRATO_TOKEN_ADDRESS` 0x2680dc6693021cd3fefb84351570874fbef8332a (for STRATO)
