# Native Bridge Deployment

This is the end-to-end install guide for a new native bridge deployment. Follow the numbered sections in order:
1. `Naming`
2. `STRATO`
3. `Ethereum Sepolia`
4. `Fresh Deployment Sequence`
5. `Command Runbook`

The `STRATO` and `Ethereum Sepolia` sections are the canonical fresh-deploy flow. The `Command Runbook` repeats the same operations with placeholder commands and includes upgrade/recovery commands for existing deployments.

The native bridge is split across:
- STRATO: `StratoNativeBridge` and `StratoNativeCustodyVault`
- Ethereum Sepolia: `StratoNativeRepresentationBridge` and `StratoNativeRepresentationToken`

## Naming

This guide uses different admin names on each side on purpose:
- `ADMIN_REGISTRY` = STRATO owner/governance address
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
- `ADMIN_REGISTRY`
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
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
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
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
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
BRIDGE_OPERATOR = <bridge service STRATO address for BA_USERNAME>
GUARDIAN = <ADMIN_REGISTRY>
```

`BRIDGE_OPERATOR` is the STRATO account that the bridge service uses for runtime STRATO writes. It must match the address for the deployed service's `BA_USERNAME` credentials. If this is set to a deployer, test relayer, or stale service account, native withdrawals will be picked up by the service but fail with `SNB: not bridge operator`.

This calls:
- `StratoNativeBridge.initialize(_tokenFactory, _custodyVault, _bridgeOperator, _guardian)`
- `StratoNativeCustodyVault.initialize(_bridge, _guardian)`

Important:
- `setAsset(...)`, `setTokenFactory(...)`, `setCustodyVault(...)`, and vault `setBridge(...)` are owner-governed on STRATO
- if `owner = ADMIN_REGISTRY`, the STRATO helper scripts are expected to work through owner/governance semantics

### Step 6: Configure the STRATO native route

Run this after the Sepolia representation token and bridge proxies exist, because this route points at those Sepolia addresses.

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

### Step 7: Whitelist the custody vault for paused STRATO token moves

For native bridge-out, `StratoNativeBridge.requestWithdrawal(...)` calls the custody vault, and the vault calls `Token.transferFrom(...)` to pull the STRATO token from the withdrawer.

For native bridge-in, `StratoNativeBridge.confirmDeposit(...)` calls the custody vault, and the vault calls `Token.transfer(...)` to unlock the STRATO token to the recipient.

If the STRATO token is paused, both token moves require the custody vault to be whitelisted in `AdminRegistry`.

Execute these STRATO governance actions:

```text
AdminRegistry.addWhitelist(<STRATO_NATIVE_TOKEN>, "transferFrom", <STRATO_NATIVE_CUSTODY_VAULT_PROXY>)
AdminRegistry.addWhitelist(<STRATO_NATIVE_TOKEN>, "transfer", <STRATO_NATIVE_CUSTODY_VAULT_PROXY>)
```

Transaction-builder template:

```text
target: <ADMIN_REGISTRY>
method: addWhitelist(address _target, string _func, address _user)
args:
  _target: <STRATO_NATIVE_TOKEN>
  _func: transferFrom
  _user: <STRATO_NATIVE_CUSTODY_VAULT_PROXY>

target: <ADMIN_REGISTRY>
method: addWhitelist(address _target, string _func, address _user)
args:
  _target: <STRATO_NATIVE_TOKEN>
  _func: transfer
  _user: <STRATO_NATIVE_CUSTODY_VAULT_PROXY>
```

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
- `STRATO_VAULT_BACKED_SIGNER` address(es)
- native mint attestation threshold

Recommended meaning on Sepolia:
- `SEPOLIA_ADMIN_SAFE` = Safe address
- `STRATO_VAULT_BACKED_SIGNER` = address recovered from STRATO vault-backed native mint attestations

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
- on `StratoNativeRepresentationBridge`, optionally split operational roles with `grantRole` / `revokeRole`
- on `StratoNativeRepresentationBridge`, `setAttestationSigner(<STRATO_VAULT_BACKED_SIGNER>, true)` for each native mint attestation signer
- on `StratoNativeRepresentationBridge`, `setAttestationThreshold(<native mint attestation threshold>)`
- on `StratoNativeRepresentationBridge`, optionally `setMaxAttestationValiditySeconds(<seconds>)` if the default 7 day maximum validity should change
- on `StratoNativeRepresentationBridge`, `registerTokenMapping(<STRATO_TOKEN>, <SEPOLIA_REPRESENTATION_TOKEN_PROXY>, false)`

Normal instant mint execution submits vault-signed `NativeMintAttestation` payloads through `mintRepresentationWithAttestation`. The Sepolia representation bridge does not need a hot mint operator role.

`StratoNativeRepresentationBridge.initialize(<SEPOLIA_ADMIN_SAFE>)` bootstraps all bridge roles to the Safe. For production, the Safe should explicitly grant operational roles to the intended addresses and optionally revoke those roles from itself while keeping `DEFAULT_ADMIN_ROLE`.

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
- on the bridge proxy, operational role holders match the deployment role plan
- on the bridge proxy, `attestationSigners(<STRATO_VAULT_BACKED_SIGNER>)` returns `true`
- on the bridge proxy, `attestationThreshold()` returns the configured native mint attestation threshold
- on the bridge proxy, `maxAttestationValiditySeconds()` returns the configured maximum attestation validity
- on the bridge proxy, `stratoToRepresentation(<STRATO_TOKEN>)` returns `<SEPOLIA_REPRESENTATION_TOKEN_PROXY>`

### Step 7: Update bridge service config

Before running the native flow end to end, update the bridge service environment/config with:
- `STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>`
- `CHAIN_11155111_RPC_URL=<sepolia-rpc-url>` if it is not already configured
- `CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY=<destination-native-bridge-key>` for paying gas and signing native mint attestations
- `CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_2=<additional-signer-key>` and higher numbered keys if the destination bridge attestation threshold is greater than `1`

Confirm that `StratoNativeBridge` has the bridge service STRATO address configured as its bridge operator before starting native withdrawals. The operator must be the STRATO address for the same `BA_USERNAME` account running the service.

The instant withdrawal review window is configured on `StratoNativeBridge` with `setInstantWithdrawalDelaySeconds`. The attestation maximum validity window is configured on `StratoNativeRepresentationBridge` with `setMaxAttestationValiditySeconds`.

If the bridge service is deployed through `docker-compose.bridge.tpl.yml`, these values must be present in the runtime env file used by Compose as well. The template now forwards:
- `STRATO_NATIVE_BRIDGE_ADDRESS`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`
- `CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY`
- `CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_2` through `_5`

The bridge service now has a native mint path:
- instant withdrawals move to `PENDING_REVIEW`, wait until the STRATO contract-provided `nativeMintNotBefore`, sign the EIP-712 `NativeMintAttestation`, submit `mintRepresentationWithAttestation(attestation, signatures)` with the chain-specific native bridge key, wait for a successful destination receipt, then call `finalizeWithdrawal` on STRATO with the destination tx hash
- approval-lane withdrawals sign the same attestation, propose `mintRepresentationWithAttestation(attestation, signatures)` to the configured Safe, persist the Safe tx hash on STRATO, and later call `finalizeWithdrawal` after Safe execution

Native redemption recovery policy:
- external-to-STRATO redemptions burn representation tokens on Sepolia before STRATO unlock
- `abortDeposit` on STRATO is an operator rejection/escalation marker and does not automatically re-mint representation tokens on Sepolia
- if a valid external burn cannot be completed on STRATO, Safe/admin operators must intervene manually by fixing and confirming the STRATO deposit or by performing a controlled compensating action on the external chain

The existing bridge service still also requires its normal Safe envs:
- `SAFE_ADDRESS`
- `SAFE_PROPOSER_ADDRESS`
- `SAFE_PROPOSER_PRIVATE_KEY`

### Step 8: Restart or redeploy the bridge service

After env/config changes, restart the bridge service so it picks up:
- the STRATO native bridge address
- the Sepolia native representation bridge address
- the relayer/operator credentials and RPC settings

## Fresh Deployment Sequence

For a new deployment, run these in order. Each item is covered by the detailed sections above and by concrete commands in the runbook below.

1. Collect STRATO and Sepolia admin addresses from `Naming`.
2. Prepare the STRATO `.env` in `mercata/contracts`.
3. Deploy the STRATO `StratoNativeBridge` proxy.
4. Upgrade the STRATO bridge proxy to `StratoNativeBridge`.
5. Deploy the STRATO `StratoNativeCustodyVault` proxy.
6. Upgrade the STRATO vault proxy to `StratoNativeCustodyVault`.
7. Initialize the STRATO bridge and vault.
8. Prepare the Sepolia `.env` in `mercata/ethereum`.
9. Run `npm ci` and `npm run compile` in `mercata/ethereum`.
10. Deploy the Sepolia `StratoNativeRepresentationToken` proxy.
11. Deploy the Sepolia `StratoNativeRepresentationBridge` proxy.
12. Verify the Sepolia bridge proxy EIP-712 domain returns `StratoNativeRepresentationBridge` and version `1`.
13. Execute the Sepolia Safe admin batch: token bridge role, attestation signer, threshold, optional attestation validity, and token mapping.
14. Confirm the Sepolia Safe batch worked.
15. Configure the STRATO native route to point at the Sepolia representation bridge and token proxies.
16. Whitelist the STRATO custody vault for paused-token `transferFrom` and `transfer`.
17. Update bridge service config/env.
18. Restart or redeploy the bridge service.
19. Run the native bridge smoke check.

## Command Runbook

The examples below are templates. Keep environment-specific addresses, amounts, Safe payloads, and saved deployment outputs in local deployment notes outside this committed runbook.

### STRATO: Deploy or Update Native Bridge Contracts

Run from `mercata/contracts`.

If the native bridge and custody vault proxies already exist, upgrade them to the current implementations:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --contract-name StratoNativeBridge \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --contract-name StratoNativeCustodyVault \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

For a fresh proxy deployment, deploy the proxies first, record their addresses, then run the same upgrade commands with the new proxy addresses.

### STRATO: Initialize Bridge and Vault

Run once after fresh proxy deployment or after deploying replacement proxies:

```bash
npm run initialize:native-bridge -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --vault-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --token-factory <TOKEN_FACTORY> \
  --bridge-operator <BRIDGE_OPERATOR> \
  --guardian <GUARDIAN>
```

### STRATO: Configure or Update Native Route

Run this after the external-chain representation bridge and token proxies are known:

```bash
npm run configure:native-route -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --external-chain-id 11155111 \
  --external-bridge <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY> \
  --representation-token <SEPOLIA_REPRESENTATION_TOKEN_PROXY> \
  --external-name "<EXTERNAL_NAME>" \
  --external-symbol <EXTERNAL_SYMBOL> \
  --max-per-withdrawal <MAX_PER_WITHDRAWAL> \
  --instant-withdrawal-threshold <INSTANT_WITHDRAWAL_THRESHOLD> \
  --strato-token <STRATO_NATIVE_TOKEN> \
  --enabled true
```

Use `--enabled false` to disable the STRATO-side route without changing the rest of the route metadata.

### STRATO: Whitelist Custody Vault for Paused Tokens

Native bridge-out pulls the STRATO token into `StratoNativeCustodyVault` using `Token.transferFrom(...)`. Native bridge-in unlocks the STRATO token from custody using `Token.transfer(...)`. If the STRATO token is paused, the token contract requires the custody vault caller to be whitelisted in `AdminRegistry` for both functions.

Execute these STRATO governance actions before native bridge testing:

```text
target: <ADMIN_REGISTRY>
method: addWhitelist(address _target, string _func, address _user)
args:
  _target: <STRATO_NATIVE_TOKEN>
  _func: transferFrom
  _user: <STRATO_NATIVE_CUSTODY_VAULT_PROXY>

target: <ADMIN_REGISTRY>
method: addWhitelist(address _target, string _func, address _user)
args:
  _target: <STRATO_NATIVE_TOKEN>
  _func: transfer
  _user: <STRATO_NATIVE_CUSTODY_VAULT_PROXY>
```

Meaning:
- `_target` = STRATO token being bridged
- `_func` = `transferFrom` for bridge-out lock, `transfer` for bridge-in unlock
- `_user` = `StratoNativeCustodyVault` proxy

### STRATO: Update Runtime Config

These are owner-governed STRATO calls. If you need to change them after deployment, execute the corresponding transaction through the STRATO owner/governance path:

```text
StratoNativeBridge.setInstantWithdrawalDelaySeconds(<seconds>)
StratoNativeBridge.setBridgeOperator(<new-bridge-operator>)
StratoNativeBridge.setGuardian(<new-guardian>)
StratoNativeBridge.setPause(<depositsPaused>, <withdrawalsPaused>)
StratoNativeBridge.setTokenFactory(<new-token-factory>)
StratoNativeBridge.setCustodyVault(<new-custody-vault>)
StratoNativeCustodyVault.setBridge(<new-bridge>)
StratoNativeCustodyVault.setGuardian(<new-guardian>)
StratoNativeCustodyVault.setPause(<paused>)
```

Use `setBridgeOperator(<bridge-service-strato-address>)` when rotating or correcting the service runtime account. This is a security-sensitive role and should remain owner/governance controlled for production; do not make it an instant admin action by default.

A typical instant review delay update would target:

```text
to: <STRATO_NATIVE_BRIDGE_PROXY>
method: setInstantWithdrawalDelaySeconds(uint256)
args: <INSTANT_WITHDRAWAL_DELAY_SECONDS>
```

### Sepolia: Deploy New Representation Contracts

Run from `mercata/ethereum`.

Deploy the representation token proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken \
INIT_PARAMS='["<EXTERNAL_NAME>","<EXTERNAL_SYMBOL>","<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Deploy the representation bridge proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge \
INIT_PARAMS='["<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Record both proxy and implementation addresses printed by the scripts.

### Sepolia: Deploy New Implementations for Upgrades

When proxies already exist and you only need new implementations:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken npm run deployImpl:sepolia
```

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge npm run deployImpl:sepolia
```

Then execute the UUPS upgrade from the Safe admin:

```text
target: <SEPOLIA_REPRESENTATION_TOKEN_PROXY or SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: upgradeToAndCall(address newImplementation, bytes data)
args:
  newImplementation: <NEW_IMPLEMENTATION_ADDRESS>
  data: 0x
```

After deploying or upgrading `StratoNativeRepresentationBridge`, verify the EIP-712 domain on the proxy before testing native withdrawals:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: eip712Domain()
expected:
  name: StratoNativeRepresentationBridge
  version: 1
  chainId: 11155111
  verifyingContract: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
```

If `name` or `version` are empty on an existing proxy, native withdrawal minting will fail with `BadAttestationSignatures()` even when the attestation signer is enabled. Fix the proxy by temporarily deploying an implementation that exposes an admin-only reinitializer:

```solidity
/// @custom:oz-upgrades-validate-as-initializer
function initializeEIP712Domain() external onlyRole(DEFAULT_ADMIN_ROLE) reinitializer(2) {
    __EIP712_init("StratoNativeRepresentationBridge", "1");
}
```

Then upgrade from the Safe admin and call the reinitializer in the same UUPS transaction:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: upgradeToAndCall(address newImplementation, bytes data)
args:
  newImplementation: <TEMP_EIP712_REINITIALIZER_IMPLEMENTATION>
  data: 0xf37e869c
```

`0xf37e869c` is `initializeEIP712Domain()`. After the proxy domain is correct, remove the temporary reinitializer from source before the next normal implementation deployment.

### Sepolia: Safe Admin Config Calls

Execute these from `SEPOLIA_ADMIN_SAFE` after fresh deploy or whenever config changes.

Representation bridge role separation:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: grantRole(bytes32 role, address account)
args:
  role: <UPGRADER_ROLE | MAPPING_ADMIN_ROLE | PAUSER_ROLE | UNPAUSER_ROLE | ATTESTATION_ADMIN_ROLE>
  account: <ROLE_HOLDER>
```

After confirming the intended role holders are active, the Safe may revoke operational roles from itself while retaining `DEFAULT_ADMIN_ROLE`:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: revokeRole(bytes32 role, address account)
args:
  role: <UPGRADER_ROLE | MAPPING_ADMIN_ROLE | PAUSER_ROLE | UNPAUSER_ROLE | ATTESTATION_ADMIN_ROLE>
  account: <SEPOLIA_ADMIN_SAFE>
```

Token grants bridge mint/burn permission:

```text
target: <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
method: grantRole(bytes32 role, address account)
args:
  role: <BRIDGE_ROLE>
  account: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
```

Representation bridge signer and threshold config:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: setAttestationSigner(address signer, bool enabled)
args:
  signer: <native-bridge-signer-address>
  enabled: true
```

`signer` must be the address recovered from the bridge service's `CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY`. If multiple numbered signer keys are configured (`CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_2`, etc.), each signer needed to satisfy the threshold must be enabled. If the service signs with a key that is not enabled here, native withdrawal minting fails on Sepolia with `BadAttestationSignatures()`.

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: setAttestationThreshold(uint8 threshold)
args:
  threshold: <required-signature-count>
```

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: setMaxAttestationValiditySeconds(uint256 validitySeconds)
args:
  validitySeconds: <MAX_ATTESTATION_VALIDITY_SECONDS>
```

Representation mapping:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: registerTokenMapping(address stratoToken, address representationToken, bool freezeRoute)
args:
  stratoToken: <STRATO_NATIVE_TOKEN>
  representationToken: <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
  freezeRoute: <FREEZE_ROUTE>
```

Other useful Safe admin calls:

```text
StratoNativeRepresentationBridge.disableTokenMapping(<STRATO_TOKEN>)
StratoNativeRepresentationBridge.enableTokenMapping(<STRATO_TOKEN>)
StratoNativeRepresentationBridge.freezeTokenMapping(<STRATO_TOKEN>)
StratoNativeRepresentationBridge.pause()
StratoNativeRepresentationBridge.unpause()
StratoNativeRepresentationBridge.setMintPaused(<paused>)
StratoNativeRepresentationBridge.setRedemptionsPaused(<paused>)
StratoNativeRepresentationBridge.migrateTokenMapping(<STRATO_TOKEN>, <NEW_REPRESENTATION_TOKEN>, <freezeRoute>)
StratoNativeRepresentationToken.grantRole(<role>, <account>)
StratoNativeRepresentationToken.revokeRole(<role>, <account>)
```

Use `disableTokenMapping` / `enableTokenMapping` for temporary route-level suspension. Use `freezeTokenMapping` only when the mapping should become permanently non-migratable.

### Sepolia: Safe Transaction Builder JSON

Use Safe Transaction Builder if the UI cannot build the batch directly. Keep address-filled JSON payloads in local deployment notes, not in this committed runbook.

### Bridge Service Env

Set:

```bash
STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>
CHAIN_11155111_RPC_URL=<sepolia-rpc-url>
CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY=<key-for-signer-and-gas>
```

If `attestationThreshold()` is greater than `1`, add enough enabled signer keys:

```bash
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_2=<second-signer-key>
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_3=<third-signer-key>
```

Each configured private key must recover to a signer enabled through `setAttestationSigner`. The bridge service validates at startup that all configured keys are enabled on the destination bridge and that enough enabled keys exist to satisfy `attestationThreshold()`.

### Validation Commands

Run the read-only smoke check:

```bash
npm run smoke:native-bridge -- --external-chain-id 11155111
```

Run the native redemption happy path script after both sides and the bridge service are configured:

```bash
npm run happy:native-redemption
```

## Known Script Behavior

- `initialize-native-bridge.js` uses async receipt polling because synchronous `blockapps-rest` contract calls can fail with `Cannot read properties of null (reading 'contents')`
- `configure-native-route.js` uses the same async receipt polling pattern for the same reason

## Addresses To Save

Keep these in local deployment notes or environment-specific secret/config storage:
- `STRATO_NATIVE_BRIDGE_PROXY`
- `STRATO_NATIVE_CUSTODY_VAULT_PROXY`
- `SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY`
- `SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_IMPL`
- `SEPOLIA_REPRESENTATION_TOKEN_PROXY`
- `SEPOLIA_REPRESENTATION_TOKEN_IMPL`
- `BRIDGE_OPERATOR` (runtime operator for `StratoNativeBridge`)
- `SEPOLIA_ADMIN_SAFE`
- `GUARDIAN`
- `STRATO_TOKEN_ADDRESS`
