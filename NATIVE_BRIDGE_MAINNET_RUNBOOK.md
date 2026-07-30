# Native Bridge Mainnet Runbook

This runbook is for production native STRATO bridging and auction preparation. Replace every `<...>` placeholder before executing commands or importing Safe JSON. Do not reuse Sepolia addresses on mainnet.

## 0. Scope And Safety Gates

Use this runbook for:

- STRATO mainnet (`upquark`) native bridge setup.
- Ethereum mainnet representation token and representation bridge setup.
- STRATO token bridge-out to Ethereum for auction/liquidity operations.
- Transfer restrictions before public token transfer unlock.

Required gates before production execution:

```text
Git branch and commit approved:
  branch=<release-or-bridge-native-branch>
  commit=<approved commit>

Contracts audited/reviewed:
  StratoNativeBridge
  StratoNativeCustodyVault
  StratoNativeRepresentationToken
  StratoNativeRepresentationBridge

Safe signers confirmed:
  STRATO governance/admin signer set
  Ethereum mainnet Safe owners and threshold

Deployment authority confirmed:
  STRATO deployer is funded and approved only for deployment execution
  Ethereum deployer is funded and approved only for deployment execution
  Final STRATO owner/admin is ADMIN_REGISTRY
  Final Ethereum admin is ETHEREUM_ADMIN_SAFE

Operational credentials confirmed:
  bridge service STRATO account
  Ethereum mainnet RPC
  native mint signer keys
```

## 1. Values To Collect

```text
STRATO_NETWORK_NAME=upquark
STRATO_NETWORK_ID=33056204878082667
ETHEREUM_CHAIN_ID=1

STRATO_DEPLOYER=<STRATO deployer account used to deploy/upgrade proxies>
ETHEREUM_DEPLOYER=<Ethereum deployer EOA used to deploy proxies>

ADMIN_REGISTRY=<STRATO admin/governance address>
ADMIN_REGISTRY_WITHOUT_0X=<same address without 0x>
TOKEN_FACTORY=<STRATO token factory>
BRIDGE_OPERATOR=<STRATO bridge service account address>
GUARDIAN=<STRATO guardian address>

STRATO_NATIVE_TOKEN=<STRATO token to bridge>
STRATO_NATIVE_BRIDGE_PROXY=<STRATO native bridge proxy>
STRATO_NATIVE_CUSTODY_VAULT_PROXY=<STRATO native custody vault proxy>

ETHEREUM_ADMIN_SAFE=<Ethereum mainnet Safe address>
ETHEREUM_REPRESENTATION_TOKEN_PROXY=<Ethereum representation token proxy>
ETHEREUM_REPRESENTATION_TOKEN_IMPL=<Ethereum representation token implementation>
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY=<Ethereum representation bridge proxy>
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_IMPL=<Ethereum representation bridge implementation>

ETHEREUM_RPC_URL=<Ethereum mainnet RPC URL>
NATIVE_MINT_SIGNER_1=<attestation signer address>
NATIVE_MINT_SIGNER_2=<optional attestation signer address>
NATIVE_MINT_SIGNER_3=<optional attestation signer address>
ATTESTATION_THRESHOLD=<required native mint signature count>
MAX_ATTESTATION_VALIDITY_SECONDS=604800

EXTERNAL_NAME=STRATO
EXTERNAL_SYMBOL=STRATO
MAX_PER_WITHDRAWAL=<wei amount>
INSTANT_WITHDRAWAL_THRESHOLD=<wei amount>
INSTANT_WITHDRAWAL_DELAY_SECONDS=<seconds>

AUCTION_DEPLOYER_SAFE=<Safe that deploys/funds auction>
LIQUIDITY_LAUNCHER=<LiquidityLauncher address>
AUCTION_CONTRACT=<auction contract address after deployment>
UNISWAP_V4_POSITION_MANAGER=<Ethereum mainnet PositionManager>
UNISWAP_V4_POOL_MANAGER=<Ethereum mainnet PoolManager>
```

Role hashes:

```text
BRIDGE_ROLE=0x52ba824bfabc2bcfcdf7f0edbb486ebb05e1836c90e78047efeb949990f72e5f
UPGRADER_ROLE=0x189ab7a9244df0848122154315af71fe140f3db0fe014031783b0946b8c9d2e3
MAPPING_ADMIN_ROLE=0x91254af6ef471a2b22aab0d27dac912f65156059964a7fe1f3f45622a2a502c3
PAUSER_ROLE=0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a
UNPAUSER_ROLE=0x427da25fe773164f88948d3e215c94b6554e2ed5e5f203a821c9f2f6131cf75a
ATTESTATION_ADMIN_ROLE=0x4110599d2acaa482abb1463b9950b5376506e9043f0ab8ec962aec422695559f
TRANSFER_ADMIN_ROLE=0x915327d54f2c758ad33c35b031b5e89868657ea971cda2b8103c502dc672509c
```

## 2. Code Preparation

On the deploy host:

```bash
cd <strato-platform>
git checkout <approved-branch>
git pull
git rev-parse --short HEAD
grep -R "parseNativeBridgeAssets\|isMappingTrue(raw.enabled)" -n app/backend/src
```

The application code can be built earlier, but do not activate the app containers for native mainnet routes until the STRATO and Ethereum contract addresses are finalized and runtime env is set. Mainnet native routes require production `STRATO_NATIVE_BRIDGE`, `STRATO_NATIVE_CUSTODY_VAULT`, and bridge-service Ethereum env values.

## 3. STRATO Mainnet Contracts

Run from `app/contracts`.

The STRATO deployer may be a funded operational account, but it must not be the final authority. The upgrade commands below set `initialOwner` to `<ADMIN_REGISTRY_WITHOUT_0X>`, so owner-only native bridge and custody vault administration belongs to STRATO governance/admin after deployment.

If deploying new proxies, deploy two `Proxy` contracts and record:

```text
STRATO_NATIVE_BRIDGE_PROXY=<new proxy>
STRATO_NATIVE_CUSTODY_VAULT_PROXY=<new proxy>
```

Upgrade the native bridge proxy:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --contract-name StratoNativeBridge \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

Upgrade the custody vault proxy:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --contract-name StratoNativeCustodyVault \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

Initialize the bridge and vault:

```bash
npm run initialize:native-bridge -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --vault-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --token-factory <TOKEN_FACTORY> \
  --bridge-operator <BRIDGE_OPERATOR> \
  --guardian <GUARDIAN>
```

Set instant withdrawal delay if required:

```text
target: <STRATO_NATIVE_BRIDGE_PROXY>
method: setInstantWithdrawalDelaySeconds(uint256)
args:
  newDelaySeconds: <INSTANT_WITHDRAWAL_DELAY_SECONDS>
```

If the STRATO token is paused, whitelist the custody vault for bridge lock/unlock movement:

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

## 4. Ethereum Mainnet Contracts

Run from `app/ethereum`.

The Ethereum deployer may be any approved funded EOA. It should only submit deployment transactions. The initializer params below assign `DEFAULT_ADMIN_ROLE` to `<ETHEREUM_ADMIN_SAFE>`, not to the deployer. Do not continue to production activation if the deployer retains unexpected admin roles after deployment.

```bash
npm ci
npm run compile
```

Deploy the representation token proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken \
INIT_PARAMS='["<EXTERNAL_NAME>","<EXTERNAL_SYMBOL>","<ETHEREUM_ADMIN_SAFE>"]' \
npm run deployWithProxy:mainnet
```

Record:

```text
ETHEREUM_REPRESENTATION_TOKEN_PROXY=<printed token proxy>
ETHEREUM_REPRESENTATION_TOKEN_IMPL=<printed token implementation>
```

Deploy the representation bridge proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge \
INIT_PARAMS='["<ETHEREUM_ADMIN_SAFE>"]' \
npm run deployWithProxy:mainnet
```

Record:

```text
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY=<printed bridge proxy>
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_IMPL=<printed bridge implementation>
```

Verify implementations and proxies on Etherscan before Safe administration:

```text
ETHEREUM_REPRESENTATION_TOKEN_PROXY verified
ETHEREUM_REPRESENTATION_TOKEN_IMPL verified
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY verified
ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_IMPL verified
```

## 5. Ethereum Safe Initial Admin Batch

Import into Ethereum mainnet Safe Transaction Builder after replacing placeholders. This grants bridge mint/burn authority, keeps general transfers disabled, enables redemption transfers to the bridge, configures attestation policy, and registers the STRATO mapping.

```json
{
  "version": "1.0",
  "chainId": "1",
  "createdAt": 0,
  "meta": {
    "name": "Mainnet native bridge initial setup",
    "description": "Configure STRATO representation token and native representation bridge",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<ETHEREUM_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "role", "type": "bytes32", "internalType": "bytes32" },
          { "name": "account", "type": "address", "internalType": "address" }
        ],
        "name": "grantRole",
        "payable": false
      },
      "contractInputsValues": {
        "role": "0x52ba824bfabc2bcfcdf7f0edbb486ebb05e1836c90e78047efeb949990f72e5f",
        "account": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>"
      }
    },
    {
      "to": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "account", "type": "address", "internalType": "address" },
          { "name": "allowed", "type": "bool", "internalType": "bool" }
        ],
        "name": "setTransferEndpoint",
        "payable": false
      },
      "contractInputsValues": {
        "account": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
        "allowed": "true"
      }
    },
    {
      "to": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "signer", "type": "address", "internalType": "address" },
          { "name": "enabled", "type": "bool", "internalType": "bool" }
        ],
        "name": "setAttestationSigner",
        "payable": false
      },
      "contractInputsValues": {
        "signer": "<NATIVE_MINT_SIGNER_1>",
        "enabled": "true"
      }
    },
    {
      "to": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "threshold", "type": "uint8", "internalType": "uint8" }
        ],
        "name": "setAttestationThreshold",
        "payable": false
      },
      "contractInputsValues": {
        "threshold": "<ATTESTATION_THRESHOLD>"
      }
    },
    {
      "to": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "validitySeconds", "type": "uint256", "internalType": "uint256" }
        ],
        "name": "setMaxAttestationValiditySeconds",
        "payable": false
      },
      "contractInputsValues": {
        "validitySeconds": "<MAX_ATTESTATION_VALIDITY_SECONDS>"
      }
    },
    {
      "to": "<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "stratoToken", "type": "address", "internalType": "address" },
          { "name": "representationToken", "type": "address", "internalType": "address" },
          { "name": "freezeRoute", "type": "bool", "internalType": "bool" }
        ],
        "name": "registerTokenMapping",
        "payable": false
      },
      "contractInputsValues": {
        "stratoToken": "<STRATO_NATIVE_TOKEN>",
        "representationToken": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
        "freezeRoute": "false"
      }
    }
  ]
}
```

If `ATTESTATION_THRESHOLD` is greater than `1`, add one `setAttestationSigner(<signer>, true)` transaction for each additional signer before `setAttestationThreshold`.

## 6. Rename CATA To STRATO

Complete this section if the STRATO-side token was originally deployed as CATA and must appear as STRATO before mainnet bridge/auction activation.

Run from `app/contracts`.

Step 1: upgrade the CATA token proxy to the implementation that supports the rename function:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_TOKEN> \
  --contract-name <CATA_TOKEN_CONTRACT_NAME> \
  --contract-file BaseCodeCollection.sol \
  +OVERRIDE-CHECKS
```

Step 2: call the token rename function through STRATO governance/admin tooling:

```text
target: <STRATO_NATIVE_TOKEN>
method: setNameAndSymbol(string,string)
args:
  name: STRATO
  symbol: STRATO
```

If the deployed function name differs in that token implementation, use the exact function name exposed by the upgraded token contract.

Verify before continuing:

```text
Token.name() == STRATO
Token.symbol() == STRATO
```

## 7. Configure STRATO Native Route

Run from `app/contracts` after Ethereum mainnet token and bridge proxies exist:

```bash
npm run configure:native-route -- \
  --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --external-chain-id 1 \
  --external-bridge <ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY> \
  --representation-token <ETHEREUM_REPRESENTATION_TOKEN_PROXY> \
  --external-name "<EXTERNAL_NAME>" \
  --external-symbol <EXTERNAL_SYMBOL> \
  --max-per-withdrawal <MAX_PER_WITHDRAWAL> \
  --instant-withdrawal-threshold <INSTANT_WITHDRAWAL_THRESHOLD> \
  --strato-token <STRATO_NATIVE_TOKEN> \
  --enabled true
```

Verify Cirrus:

```bash
curl -s "<STRATO_NODE_URL>/cirrus/search/BlockApps-StratoNativeBridge-assets?address=eq.<STRATO_NATIVE_BRIDGE_PROXY_WITHOUT_0X>" | jq
```

## 8. Runtime Configuration

Bridge service env:

```bash
STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>
CHAIN_1_RPC_URL=<ETHEREUM_RPC_URL>
CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>
CHAIN_1_NATIVE_BRIDGE_PRIVATE_KEY=<native-mint-signer-and-gas-key>
```

If multiple signers are required:

```bash
CHAIN_1_NATIVE_BRIDGE_PRIVATE_KEY_1=<second-native-mint-signer-key>
CHAIN_1_NATIVE_BRIDGE_PRIVATE_KEY_2=<third-native-mint-signer-key>
```

STRATO App mainnet addresses should be added to `app/backend/src/config/config.ts` before building the backend image. Update the Upquark entries after the production proxies are final:

```ts
export const defaultStratoNativeBridgeFor: Record<string, string> = {
  "114784819836269": "49f69252b00235030a4dcd4c7ef17a64ef346258", // Helium testnet
  "33056204878082667": "<STRATO_NATIVE_BRIDGE_PROXY>", // Upquark mainnet
};

export const defaultStratoNativeCustodyVaultFor: Record<string, string> = {
  "114784819836269": "8cfe7b576f69260673e9a1a9517137f12a49ed93", // Helium testnet
  "33056204878082667": "<STRATO_NATIVE_CUSTODY_VAULT_PROXY>", // Upquark mainnet
};
```

Runtime env vars `STRATO_NATIVE_BRIDGE` and `STRATO_NATIVE_CUSTODY_VAULT` can still override these defaults, but the production deployment should not depend on manually setting them if the addresses are known at build time.

## 9. App Image Build And Activation

Only run this section after:

```text
1. STRATO native bridge and custody vault addresses are final.
2. Ethereum representation token and bridge addresses are final.
3. STRATO route is configured for externalChainId=1.
4. Ethereum Safe admin batch has executed.
5. Backend `config.ts` has the production native bridge/vault defaults, or backend runtime env overrides are set.
6. Bridge-service runtime env values above are set in the deploy environment.
```

Build backend/UI images from the approved checkout:

```bash
cd <strato-platform>
make app
```

Use the final `strato-patch-app ...` command printed by `make app`, then recreate app containers:

```bash
strato-patch-app <node-dir> <app-backend-image> <app-ui-image>
cd <node-dir>
docker compose -p strato up -d --no-deps app-backend app-ui
```

Restart the bridge service after native bridge-service env is set:

```bash
docker compose -p strato up -d --no-deps bridge
```

Verify the running backend has native route code:

```bash
docker exec <app-backend-container> sh -lc 'grep -R "parseNativeBridgeAssets\|isMappingTrue(raw.enabled)" -n dist src 2>/dev/null | head -20'
```

## 10. Verification

Ethereum token checks:

```text
StratoNativeRepresentationToken.hasRole(DEFAULT_ADMIN_ROLE, <ETHEREUM_ADMIN_SAFE>) == true
StratoNativeRepresentationToken.hasRole(DEFAULT_ADMIN_ROLE, <ETHEREUM_DEPLOYER>) == false
StratoNativeRepresentationToken.hasRole(<BRIDGE_ROLE>, <ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>) == true
StratoNativeRepresentationToken.transfersEnabled() == false
StratoNativeRepresentationToken.transferEndpoints(<ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>) == true
```

Ethereum bridge checks:

```text
StratoNativeRepresentationBridge.hasRole(DEFAULT_ADMIN_ROLE, <ETHEREUM_ADMIN_SAFE>) == true
StratoNativeRepresentationBridge.hasRole(DEFAULT_ADMIN_ROLE, <ETHEREUM_DEPLOYER>) == false
StratoNativeRepresentationBridge.attestationSigners(<NATIVE_MINT_SIGNER_1>) == true
StratoNativeRepresentationBridge.attestationThreshold() == <ATTESTATION_THRESHOLD>
StratoNativeRepresentationBridge.maxAttestationValiditySeconds() == <MAX_ATTESTATION_VALIDITY_SECONDS>
StratoNativeRepresentationBridge.stratoToRepresentation(<STRATO_NATIVE_TOKEN>) == <ETHEREUM_REPRESENTATION_TOKEN_PROXY>
StratoNativeRepresentationBridge.routeActive(<STRATO_NATIVE_TOKEN>) == true
```

STRATO route checks:

```text
StratoNativeBridge.owner() == <ADMIN_REGISTRY>
StratoNativeCustodyVault.owner() == <ADMIN_REGISTRY>
StratoNativeBridge.assets(<STRATO_NATIVE_TOKEN>, 1).enabled == true
StratoNativeBridge.assets(<STRATO_NATIVE_TOKEN>, 1).externalBridge == <ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>
StratoNativeBridge.assets(<STRATO_NATIVE_TOKEN>, 1).representationToken == <ETHEREUM_REPRESENTATION_TOKEN_PROXY>
```

Backend/API checks:

```bash
curl -s "<STRATO_APP_BACKEND_URL>/api/v1/bridge/bridgeableTokens/1" | jq '.data // . | map(select(.routeType=="native"))'
```

Start with a small production bridge-out amount before moving auction inventory:

```text
1. Bridge out a small STRATO amount to an operator wallet.
2. Confirm withdrawal state moves INITIATED -> PENDING_REVIEW -> COMPLETED.
3. Confirm Ethereum representation token balance increased.
4. Confirm redemption back to STRATO with a small amount if operationally required.
```

## 11. Auction Preparation

Keep `transfersEnabled()` false until the release condition is met. Whitelist only endpoints that must send, receive, or custody STRATO during auction setup.

Pre-auction endpoints:

```text
AUCTION_DEPLOYER_SAFE=<Safe that receives bridged STRATO and deploys/funds auction>
LIQUIDITY_LAUNCHER=<LiquidityLauncher address>
```

Whitelist pre-auction endpoints:

```json
{
  "version": "1.0",
  "chainId": "1",
  "createdAt": 0,
  "meta": {
    "name": "Whitelist STRATO auction setup endpoints",
    "description": "Whitelist auction deployer Safe and LiquidityLauncher while general transfers are disabled",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<ETHEREUM_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "account", "type": "address", "internalType": "address" },
          { "name": "allowed", "type": "bool", "internalType": "bool" }
        ],
        "name": "setTransferEndpoint",
        "payable": false
      },
      "contractInputsValues": {
        "account": "<AUCTION_DEPLOYER_SAFE>",
        "allowed": "true"
      }
    },
    {
      "to": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "account", "type": "address", "internalType": "address" },
          { "name": "allowed", "type": "bool", "internalType": "bool" }
        ],
        "name": "setTransferEndpoint",
        "payable": false
      },
      "contractInputsValues": {
        "account": "<LIQUIDITY_LAUNCHER>",
        "allowed": "true"
      }
    }
  ]
}
```

After auction deployment, whitelist each deployed auction/pool contract that sends, receives, or custodies STRATO:

```text
StratoNativeRepresentationToken.setTransferEndpoint(<AUCTION_CONTRACT>, true)
StratoNativeRepresentationToken.setTransferEndpoint(<UNISWAP_V4_POSITION_MANAGER>, true)
StratoNativeRepresentationToken.setTransferEndpoint(<UNISWAP_V4_POOL_MANAGER>, true)
```

If using a governed LBP strategy and CCA initializer, also whitelist:

```text
StratoNativeRepresentationToken.setTransferEndpoint(<GOVERNED_LBP_STRATEGY>, true)
StratoNativeRepresentationToken.setTransferEndpoint(<CCA_INITIALIZER>, true)
```

Temporary endpoint removal after auction deployment/funding:

```text
StratoNativeRepresentationToken.setTransferEndpoint(<AUCTION_DEPLOYER_SAFE>, false)
StratoNativeRepresentationToken.setTransferEndpoint(<LIQUIDITY_LAUNCHER>, false)
```

Only remove an endpoint after confirming no future auction migration, claim, sweep, or LP operation requires it.

## 12. Bridge STRATO For Auction Inventory

Bridge STRATO out from STRATO to the auction deployer Safe:

```text
source: STRATO wallet holding <STRATO_NATIVE_TOKEN>
destination chain: Ethereum mainnet (1)
external recipient: <AUCTION_DEPLOYER_SAFE>
amount: <auction inventory amount in 18-decimal units>
```

Expected result:

```text
STRATO side:
  withdrawal bridgeStatus == COMPLETED
  externalTxHash set

Ethereum side:
  ETHEREUM_REPRESENTATION_TOKEN_PROXY.balanceOf(<AUCTION_DEPLOYER_SAFE>) increased by bridged amount
```

### Later Side Note: Full Transferability

Full peer-to-peer transferability is intentionally not part of the near-term deployment or auction setup. Keep `transfersEnabled()` false until the later release condition is approved. Only after that approval, import this Safe transaction:

```json
{
  "version": "1.0",
  "chainId": "1",
  "createdAt": 0,
  "meta": {
    "name": "Enable STRATO representation token transfers",
    "description": "Enable peer-to-peer STRATO transfers after sale or release condition",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<ETHEREUM_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<ETHEREUM_REPRESENTATION_TOKEN_PROXY>",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "name": "enabled", "type": "bool", "internalType": "bool" }
        ],
        "name": "setTransfersEnabled",
        "payable": false
      },
      "contractInputsValues": {
        "enabled": "true"
      }
    }
  ]
}
```

After enabling transfers:

```text
StratoNativeRepresentationToken.transfersEnabled() == true
Document timestamp, Safe tx hash, and release approval reference.
```

## 13. Recovery And Rollback

If backend does not show the native route:

```text
1. Confirm StratoNativeBridge route exists in Cirrus for externalChainId=1.
2. Confirm backend env STRATO_NATIVE_BRIDGE and STRATO_NATIVE_CUSTODY_VAULT.
3. Confirm running backend image contains parseNativeBridgeAssets and isMappingTrue(raw.enabled).
4. Restart app-backend.
```

If a native withdrawal is stuck in `INITIATED`:

```text
1. Confirm bridge service is running with STRATO_NATIVE_BRIDGE_ADDRESS.
2. Confirm BRIDGE_OPERATOR matches the bridge service STRATO account.
3. Confirm CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS and CHAIN_1_NATIVE_BRIDGE_PRIVATE_KEY are configured.
4. Check bridge service logs for queueManualNativeWithdrawalBatch or finalizeNativeWithdrawalBatch.
```

If a native redemption is stuck after the Ethereum-side burn:

```text
1. Treat the burn as final; there is no regular abort/redemption-refund path.
2. Confirm the RedemptionRequested event was emitted by <ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>.
3. Confirm bridge service is running and polling CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS.
4. Confirm STRATO_NATIVE_BRIDGE_ADDRESS, STRATO_NATIVE_CUSTODY_VAULT_ADDRESS, and BRIDGE_OPERATOR are correct.
5. Check whether the STRATO native deposit was recorded in Cirrus.
6. If not recorded, fix polling/RPC/service configuration and let the bridge service retry recordDeposit.
7. If recorded but not completed, fix the blocking STRATO state (route enabled, deposits unpaused, custody vault unpaused, vault locked balance sufficient, token whitelist if paused) and let the bridge service retry confirmDeposit.
8. Do not create an external re-mint or off-chain compensation without governance approval and a written incident record.
```

If Safe execution shows `GS013` for native mint:

```text
1. Confirm nativeMintNotBefore has passed.
2. Confirm attestationThreshold and attestationSigners.
3. Confirm routeActive(<STRATO_NATIVE_TOKEN>) is true.
4. Confirm the Safe transaction target is <ETHEREUM_NATIVE_REPRESENTATION_BRIDGE_PROXY>.
5. Retry after Safe transaction service/indexing catches up if all checks pass.
```

If transfers fail before public unlock:

```text
1. Confirm transfersEnabled() is false.
2. Confirm transferEndpoints(sender) or transferEndpoints(recipient) is true.
3. Add the required contract/Safe as a transfer endpoint, or wait until post-auction transfer unlock.
```
