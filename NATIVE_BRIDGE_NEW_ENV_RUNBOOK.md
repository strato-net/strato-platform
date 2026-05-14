# Native Bridge New Environment Runbook

This runbook is for a fresh native bridge environment. Replace all `<...>` placeholders before running commands or importing Safe JSON.

## 0. Values To Collect

```text
ADMIN_REGISTRY=<STRATO admin/governance address>
ADMIN_REGISTRY_WITHOUT_0X=<same address without 0x>
TOKEN_FACTORY=<STRATO token factory>
BRIDGE_OPERATOR=<STRATO bridge service account address>
GUARDIAN=<STRATO guardian address>
STRATO_NATIVE_TOKEN=<STRATO token to bridge>

SEPOLIA_ADMIN_SAFE=<Safe address>
SEPOLIA_DEPLOYER_PRIVATE_KEY=<EOA private key in mercata/ethereum .env>
STRATO_VAULT_BACKED_SIGNER=<native mint attestation signer address>
ATTESTATION_THRESHOLD=<required native mint signature count>
MAX_ATTESTATION_VALIDITY_SECONDS=604800

EXTERNAL_NAME=<token display name, e.g. Wrapped STRATO>
EXTERNAL_SYMBOL=<token symbol, e.g. STRATO>
MAX_PER_WITHDRAWAL=<wei amount>
INSTANT_WITHDRAWAL_THRESHOLD=<wei amount>
INSTANT_WITHDRAWAL_DELAY_SECONDS=<seconds>
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

## 1. Deploy STRATO Contracts

Run from `mercata/contracts`.

Deploy two `Proxy` contracts through the normal STRATO deployment path and record:

```text
STRATO_NATIVE_BRIDGE_PROXY=<new proxy>
STRATO_NATIVE_CUSTODY_VAULT_PROXY=<new proxy>
```

Upgrade the bridge proxy:

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

Optional runtime config:

```text
target: <STRATO_NATIVE_BRIDGE_PROXY>
method: setInstantWithdrawalDelaySeconds(uint256)
args:
  newDelaySeconds: <INSTANT_WITHDRAWAL_DELAY_SECONDS>
```

Whitelist the custody vault for paused-token movement if the STRATO token is paused:

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

## 2. Deploy Sepolia Contracts

Run from `mercata/ethereum`.

```bash
npm ci
npm run compile
```

Deploy the representation token proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken \
INIT_PARAMS='["<EXTERNAL_NAME>","<EXTERNAL_SYMBOL>","<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Record:

```text
SEPOLIA_REPRESENTATION_TOKEN_PROXY=<printed token proxy>
SEPOLIA_REPRESENTATION_TOKEN_IMPL=<printed token implementation>
```

Deploy the representation bridge proxy:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge \
INIT_PARAMS='["<SEPOLIA_ADMIN_SAFE>"]' \
npm run deployWithProxy:sepolia
```

Record:

```text
SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY=<printed bridge proxy>
SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_IMPL=<printed bridge implementation>
```

## 3. Sepolia Safe Admin Batch

Import the following JSON into Safe Transaction Builder after replacing placeholders. This first batch grants the token bridge role, keeps general transfers disabled, allows redemption transfers to the representation bridge, configures attestation policy, and registers the STRATO token mapping.

```json
{
  "version": "1.0",
  "chainId": "11155111",
  "createdAt": 0,
  "meta": {
    "name": "Native bridge initial setup",
    "description": "Configure representation token and bridge for native bridge route",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<SEPOLIA_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<SEPOLIA_REPRESENTATION_TOKEN_PROXY>",
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
        "account": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>"
      }
    },
    {
      "to": "<SEPOLIA_REPRESENTATION_TOKEN_PROXY>",
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
        "account": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
        "allowed": "true"
      }
    },
    {
      "to": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
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
        "signer": "<STRATO_VAULT_BACKED_SIGNER>",
        "enabled": "true"
      }
    },
    {
      "to": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
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
      "to": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
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
      "to": "<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>",
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
        "representationToken": "<SEPOLIA_REPRESENTATION_TOKEN_PROXY>",
        "freezeRoute": "false"
      }
    }
  ]
}
```

Important:

- Do not call `setTransfersEnabled(true)` until the sale or release condition is met.
- `setTransferEndpoint(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>, true)` allows redemption transfers to the bridge while peer-to-peer transfers remain blocked.

## 4. Optional Sepolia Safe Role Separation

Use this JSON shape for each operational role you want to move from the Safe to a dedicated holder.

```json
{
  "version": "1.0",
  "chainId": "11155111",
  "createdAt": 0,
  "meta": {
    "name": "Native bridge role separation",
    "description": "Grant operational role to dedicated holder",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<SEPOLIA_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<TARGET_PROXY>",
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
        "role": "<ROLE_HASH>",
        "account": "<ROLE_HOLDER>"
      }
    }
  ]
}
```

Use these target contracts:

```text
StratoNativeRepresentationBridge roles:
  TARGET_PROXY=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
  ROLE_HASH=<UPGRADER_ROLE | MAPPING_ADMIN_ROLE | PAUSER_ROLE | UNPAUSER_ROLE | ATTESTATION_ADMIN_ROLE>

StratoNativeRepresentationToken roles:
  TARGET_PROXY=<SEPOLIA_REPRESENTATION_TOKEN_PROXY>
  ROLE_HASH=<UPGRADER_ROLE | TRANSFER_ADMIN_ROLE>
```

After confirming the intended role holder has the role, use the same JSON shape with `revokeRole` to remove operational roles from `<SEPOLIA_ADMIN_SAFE>` if desired. Keep `DEFAULT_ADMIN_ROLE` on the Safe.

## 5. Configure STRATO Native Route

Run from `mercata/contracts` after Sepolia token and bridge proxies exist.

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

## 6. STRATO Token Bridge Setup Checklist

For each STRATO token that should bridge to Sepolia, complete these token-specific setup steps.

STRATO-side setup:

```text
1. Record the STRATO token contract address as <STRATO_NATIVE_TOKEN> and use it in the commands below.
2. Whitelist the custody vault for token movement if the STRATO token is paused:
   AdminRegistry.addWhitelist(<STRATO_NATIVE_TOKEN>, "transferFrom", <STRATO_NATIVE_CUSTODY_VAULT_PROXY>)
   AdminRegistry.addWhitelist(<STRATO_NATIVE_TOKEN>, "transfer", <STRATO_NATIVE_CUSTODY_VAULT_PROXY>)
3. Configure the route on StratoNativeBridge:
   stratoToken=<STRATO_NATIVE_TOKEN>
   externalChainId=11155111
   externalBridge=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
   representationToken=<SEPOLIA_REPRESENTATION_TOKEN_PROXY>
   maxPerWithdrawal=<MAX_PER_WITHDRAWAL>
   instantWithdrawalThreshold=<INSTANT_WITHDRAWAL_THRESHOLD>
   enabled=true
```

Sepolia-side setup:

```text
1. Deploy one StratoNativeRepresentationToken proxy for this STRATO token.
2. Deploy or reuse the StratoNativeRepresentationBridge proxy for the environment.
3. Grant BRIDGE_ROLE on the representation token to <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>.
4. Keep general transfers disabled until the sale or release condition is met.
5. Allow redemption while transfers are disabled:
   StratoNativeRepresentationToken.setTransferEndpoint(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>, true)
6. Register the token mapping on the representation bridge:
   StratoNativeRepresentationBridge.registerTokenMapping(<STRATO_NATIVE_TOKEN>, <SEPOLIA_REPRESENTATION_TOKEN_PROXY>, false)
```

Runtime setup:

```text
1. The bridge service needs the STRATO native bridge proxy and Sepolia representation bridge proxy.
2. The Mercata backend needs the STRATO native bridge proxy and STRATO custody vault proxy.
3. There is no separate backend env var per token. Token availability comes from the route configured in StratoNativeBridge.
4. The UI/backend will only surface the token after the backend can query the configured route from Cirrus.
```

## 7. Bridge Service Runtime Config

Set these for the bridge service:

```bash
STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>
CHAIN_11155111_RPC_URL=<sepolia-rpc-url>
CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY=<native-mint-signer-and-gas-key>
```

If `ATTESTATION_THRESHOLD > 1`, set enough additional enabled signer keys:

```bash
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_2=<second-native-mint-signer-key>
CHAIN_11155111_NATIVE_BRIDGE_PRIVATE_KEY_3=<third-native-mint-signer-key>
```

Restart or redeploy the bridge service after updating env.

## 8. Mercata Backend Runtime Config

The `mercata/backend` API needs the STRATO-side native bridge addresses so it can expose native routes, build native withdrawal transactions, and query native withdrawal/redemption state from Cirrus.

Set these for the Mercata backend process:

```bash
STRATO_NATIVE_BRIDGE=<STRATO_NATIVE_BRIDGE_PROXY>
STRATO_NATIVE_CUSTODY_VAULT=<STRATO_NATIVE_CUSTODY_VAULT_PROXY>
```

These are configured in `mercata/backend/src/config/config.ts` and exposed through `mercata/backend/src/config/constants.ts`. The native bridge API paths use them in `mercata/backend/src/api/services/bridge.service.ts` and `mercata/backend/src/api/helpers/bridge.helper.ts`.

Important naming distinction:

- `mercata/backend` uses `STRATO_NATIVE_BRIDGE` and `STRATO_NATIVE_CUSTODY_VAULT`.
- `mercata/services/bridge` and the native smoke/happy-path scripts use `STRATO_NATIVE_BRIDGE_ADDRESS` and `STRATO_NATIVE_CUSTODY_VAULT_ADDRESS`.

If the backend is deployed through generated Docker Compose, make sure the generated backend service forwards both backend env vars. They are included in the all-docker compose generator in `strato/core/strato-init/src/Blockchain/Init/DockerComposeAllDocker.hs`.

Restart or redeploy the Mercata backend after updating env.

## 9. Verification Calls

Verify Sepolia token:

```text
StratoNativeRepresentationToken.hasRole(<BRIDGE_ROLE>, <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>) == true
StratoNativeRepresentationToken.transfersEnabled() == false
StratoNativeRepresentationToken.transferEndpoints(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>) == true
```

Verify Sepolia bridge:

```text
StratoNativeRepresentationBridge.attestationSigners(<STRATO_VAULT_BACKED_SIGNER>) == true
StratoNativeRepresentationBridge.attestationThreshold() == <ATTESTATION_THRESHOLD>
StratoNativeRepresentationBridge.maxAttestationValiditySeconds() == <MAX_ATTESTATION_VALIDITY_SECONDS>
StratoNativeRepresentationBridge.stratoToRepresentation(<STRATO_NATIVE_TOKEN>) == <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
StratoNativeRepresentationBridge.routeActive(<STRATO_NATIVE_TOKEN>) == true
```

Verify STRATO:

```bash
npm run smoke:native-bridge -- --external-chain-id 11155111
```

Verify backend env:

```text
mercata/backend env:
  STRATO_NATIVE_BRIDGE=<STRATO_NATIVE_BRIDGE_PROXY>
  STRATO_NATIVE_CUSTODY_VAULT=<STRATO_NATIVE_CUSTODY_VAULT_PROXY>
```

Native routes should appear through the backend bridge routes API once the backend env is present and the STRATO native route has been configured.

## 10. Enable General Transfers Later

Only after the sale or release condition is met, import this Safe transaction:

```json
{
  "version": "1.0",
  "chainId": "11155111",
  "createdAt": 0,
  "meta": {
    "name": "Enable representation token transfers",
    "description": "Enable peer-to-peer transfers after sale or release condition",
    "txBuilderVersion": "1.18.0",
    "createdFromSafeAddress": "<SEPOLIA_ADMIN_SAFE>",
    "createdFromOwnerAddress": "",
    "checksum": ""
  },
  "transactions": [
    {
      "to": "<SEPOLIA_REPRESENTATION_TOKEN_PROXY>",
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
