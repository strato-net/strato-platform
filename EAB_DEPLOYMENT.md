# Bridge deployment

Actors:

- Coordinator owns `deployment.json`, public reviewed configuration, discovery, checks, and generated handoffs.
- STRATO admins execute the generated admin handoff with separate credentials.
- Safe owners inspect, sign, and execute the generated Safe batch.
- Infra applies the generated service archive and returns public Runtime/verifier URLs and identities.

Reuse `app/contracts/.env` for STRATO access and `app/ethereum/.env` for target-chain RPCs, deployer key, and explorer keys. Keep only rollout-specific public setup values in adjacent `deployment.env`. Put every reviewed address, route, limit, confirmation/finality value, identity, and health URL in `deployment.json`.

Production STRATO accounts that require OTP must set a fresh `OAUTH_TOTP` in `app/contracts/.env` immediately before each STRATO-authenticated command. Each script authenticates once and reuses that access token for the command. Replace or clear the consumed code afterward. Target-chain Hardhat deployment and Safe signing do not use STRATO OAuth.

## 1. Setup and init

**Who:** Coordinator creates the rollout. Infra base accounts may already exist, but chain-specific verifier and Runtime identities are not required yet.

Set the rollout directory:

```bash
export ROLLOUT_DIR=<ABSOLUTE_NEW_ROLLOUT_DIRECTORY>
```

If `deployment.env` does not exist, replace every `<...>` value and create it:

```bash
export REPO_ROOT=<ABSOLUTE_REPOSITORY_PATH>
export SOURCE_CHAIN_ID=<EQUIVALENT_OR_REFERENCE_CHAIN_ID>
export DEPLOY_ENV=<testnet-or-prod>
export NETWORK=<ethereum-or-base-or-linea-or-robinhood-or-hyperevm>

mkdir -p "$ROLLOUT_DIR"
chmod 700 "$ROLLOUT_DIR"

cat > "$ROLLOUT_DIR/deployment.env" <<EOF
REPO_ROOT=$REPO_ROOT
ROLLOUT_DIR=$ROLLOUT_DIR
SOURCE_CHAIN_ID=$SOURCE_CHAIN_ID
DEPLOY_ENV=$DEPLOY_ENV
NETWORK=$NETWORK
EOF

chmod 600 "$ROLLOUT_DIR/deployment.env"
```

Load the existing file at the start of every Coordinator session:

```bash
set -a
source "$ROLLOUT_DIR/deployment.env"
set +a
cd "$REPO_ROOT/app/ethereum"
eval "$(npm run --silent network:environment)"
```

The tooling loads `app/contracts/.env` and `app/ethereum/.env` directly.

```bash
npm run external:rollout -- init \
  --manifest "$ROLLOUT_DIR/deployment.json" \
  --chain-id "$TARGET_CHAIN_ID" \
  --source-chain-id "$SOURCE_CHAIN_ID"
```

Set `include`, target Safe/Permit2/role addresses, deployment and finality confirmations, route limits, and known public identities. For a first STRATO EAB deployment, leave `target.externalAssetBridge` and `target.tokenRouter` as `DEPLOY_REQUIRED` until step 2. Leave Infra-created verifier URLs, authorization signers, Runtime health URL, proposer, and executor values as `REVIEW_REQUIRED` until step 3.

Choose `scope: "combined"` (default EAB + native) or `"eab-only"`.

For a later native extension, reuse the existing schema-version-1 EAB `deployment.json`; do not run `init` or create a schema-version-0 draft. Set `"scope": "native-extension"` and add both `inputs.nativeRoutes` and `inputs.nativeConfig` in the generated shapes:

```json
{
  "inputs": {
    "nativeRoutes": [{
      "bridge-address": "<STRATO_NATIVE_BRIDGE_WITHOUT_0X>",
      "external-chain-id": "<TARGET_CHAIN_ID>",
      "external-bridge": "<NATIVE_REPRESENTATION_BRIDGE>",
      "strato-token": "<STRATO_TOKEN_WITHOUT_0X>",
      "representation-token": "<REPRESENTATION_TOKEN>",
      "max-per-withdrawal": "<INTEGER>",
      "instant-withdrawal-threshold": "<INTEGER>",
      "enabled": false,
      "auto-route-enabled": false,
      "sharedTokenSettings": {
        "depositsDisabled": true,
        "withdrawalsDisabled": true,
        "maxOutstandingWithdrawal": "<INTEGER>"
      }
    }],
    "nativeConfig": {
      "chainId": "<TARGET_CHAIN_ID_AS_NUMBER>",
      "bridgeAddress": "<NATIVE_REPRESENTATION_BRIDGE>",
      "safeAddress": "<SAFE>",
      "executor": "<NATIVE_EXECUTOR>",
      "eabExecutor": "<EAB_EXECUTOR>",
      "attestationSigners": ["<SIGNER>"],
      "disabledAttestationSigners": [],
      "attestationThreshold": "<THRESHOLD_AS_NUMBER>",
      "maxAttestationValiditySeconds": "<INTEGER>",
      "tokens": [{
        "stratoToken": "<STRATO_TOKEN>",
        "representationToken": "<REPRESENTATION_TOKEN>",
        "freezeRoute": false,
        "transfersEnabled": false
      }]
    }
  }
}
```

`chainId` and `attestationThreshold` are JSON numbers; amounts and validity are decimal strings. Use the production verifier count and threshold. Existing EAB routes remain unchanged; schema-version-1 native extension does not use discovery `include` flags.

## 2. Deploy or upgrade contracts

**Who:** STRATO admins for STRATO; Coordinator for target-chain contracts.

STRATO admins use the existing `$REPO_ROOT/app/contracts/.env`. Before running the commands, confirm it contains:

```dotenv
NODE_URL=https://<STRATO_HOST>
OAUTH_URL=<STRATO_OPENID_DISCOVERY_URL>
OAUTH_CLIENT_ID=<CLIENT_ID>
OAUTH_CLIENT_SECRET=<CLIENT_SECRET>
GLOBAL_ADMIN_NAME=<STRATO_ADMIN_USER>
GLOBAL_ADMIN_PASSWORD=<STRATO_ADMIN_PASSWORD>
OAUTH_TOTP=<CURRENT_ONE_TIME_CODE_IF_REQUIRED>
```

```bash
export REPO_ROOT=<ABSOLUTE_REPOSITORY_PATH>
chmod 600 "$REPO_ROOT/app/contracts/.env"
```

First STRATO EAB bootstrap uses the standard scripts. Existing production EAB deployments skip these commands:

```bash
cd "$REPO_ROOT/app/contracts"
npm run deployProxy -- --empty --owner 000000000000000000000000000000000000100c --contract-file BaseCodeCollection.sol
npm run upgrade -- --proxy-address <TOKEN_ROUTER_PROXY> --contract-name TokenRouter --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' +OVERRIDE-CHECKS
npm run deployProxy -- --empty --owner 000000000000000000000000000000000000100c --contract-file BaseCodeCollection.sol
npm run upgrade -- --proxy-address <EAB_PROXY> --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' +OVERRIDE-CHECKS
```

Replace both `DEPLOY_REQUIRED` values in `deployment.json` with the resulting proxy addresses.

STRATO native bridge and custody are discovery + upgrade only. Never create or initialize fresh native proxies:

```bash
cd "$REPO_ROOT/app/contracts"
npm run upgrade -- --proxy-address <NATIVE_BRIDGE_PROXY> --contract-name StratoNativeBridge --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' +OVERRIDE-CHECKS
npm run upgrade -- --proxy-address <NATIVE_CUSTODY_PROXY> --contract-name StratoNativeCustodyVault --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"000000000000000000000000000000000000100c"}' +OVERRIDE-CHECKS
```

Deploy target EAB contracts with the existing standalone command. For production execution, first set `CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$TARGET_CHAIN_ID"`.

```bash
cd "$REPO_ROOT/app/ethereum"
npm run network:deploy-external -- \
  --manifest "$ROLLOUT_DIR/deployment.json" \
  --rollout-dir "$ROLLOUT_DIR/.deployment/external"
npm run network:deploy-external -- \
  --manifest "$ROLLOUT_DIR/deployment.json" \
  --rollout-dir "$ROLLOUT_DIR/.deployment/external" \
  --execute
```

Deploy fresh native destination contracts:

```bash
read -r -p "Type target chain ID $TARGET_CHAIN_ID to deploy native proxies: " CONFIRM_NATIVE_DEPLOY
if [ "$CONFIRM_NATIVE_DEPLOY" = "$TARGET_CHAIN_ID" ]; then
  CONTRACT_NAME=StratoNativeRepresentationBridge INIT_PARAMS='["<SAFE>"]' npx hardhat run scripts/deployWithProxy.js --network "$TARGET_NETWORK" &&
  CONTRACT_NAME=StratoNativeRepresentationToken INIT_PARAMS='["<NAME>","<SYMBOL>","<SAFE>"]' npx hardhat run scripts/deployWithProxy.js --network "$TARGET_NETWORK"
else
  echo "Cancelled; no native deployment command was run"
fi
```

The generic native deployment script has no checkpoint or built-in production confirmation. If its result is uncertain, reconcile the deployer transactions and `deployments/*_latest.json`; do not rerun it. `generate` independently reads the contracts and fails unless the reviewed Safe has every required native admin role.

For target upgrades, deploy implementations and have the Safe execute `upgradeToAndCall`:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge npx hardhat run scripts/deployImplementationOnly.js --network "$TARGET_NETWORK"
CONTRACT_NAME=StratoNativeRepresentationToken npx hardhat run scripts/deployImplementationOnly.js --network "$TARGET_NETWORK"
```

Record the generated paths in the schema-version-0 `deployment.json`:

- `discovery.target.nativeDeployment`: `$REPO_ROOT/app/ethereum/deployments/StratoNativeRepresentationBridge_<network>_latest.json`
- each included `discovery.nativeRoutes[i].deployment`: `$REPO_ROOT/app/ethereum/deployments/StratoNativeRepresentationToken_<network>_latest.json`

Use absolute paths after expanding `$REPO_ROOT`; paths are otherwise resolved relative to `$ROLLOUT_DIR`. The coordinator derives proxy addresses, Safe, token name, and symbol from those files and checks their chain IDs. Do not hand-type those derived values. The EAB deployment is read from `.deployment/external/external-deployment.json`.

After all target deployments finish:

```bash
perl -i -pe 's/^PRIVATE_KEY=.*/PRIVATE_KEY=/' "$REPO_ROOT/app/ethereum/.env"
unset PRIVATE_KEY CONFIRM_EXTERNAL_BRIDGE_DEPLOY CONFIRM_NATIVE_DEPLOY
```

## 3. Bootstrap Infra and preflight

**Who:** Coordinator generates the stopped-service package; Infra provisions or reuses the service foundations.

After all target deployment paths are recorded:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- bootstrap --manifest "$ROLLOUT_DIR/deployment.json"
```

Check only `.deployment/bootstrap/`. Give Infra:

- the reviewed `strato-net/eab-infra` kit tag or commit;
- the release commit and image digests;
- `infra-bootstrap.json`;
- `infra-bootstrap.tar.gz`.

Infra verifies the archive hashes and creates or reuses the Runtime and proposer foundations first, using the generated `bridge.env.template`. Infra records the Runtime access address and egress IP, but Runtime may remain not ready.

Infra then gives each verifier operator its EAB policy and Runtime access address and creates the chain's verifier stack with `Running=No`:

```bash
eab-infra/guides/tools/deploy.sh <verifier-folder>/<network>.conf --preview
eab-infra/guides/tools/deploy.sh <verifier-folder>/<network>.conf
```

`Running=No` is provisioning mode: it creates the endpoint and KMS signer identities without starting traffic. It must not require the new attestor to be registered or funded yet; those checks apply when changing to `Running=Yes`. If the selected `eab-infra` version performs those checks for `Running=No`, update it before continuing.

Infra returns every value named in `infra-bootstrap.json`: verifier URLs and EAB/native signer addresses, Runtime EAB/native executors, proposer, Runtime access address, and Runtime health URL. New deployments use short-lived requests signed by the Runtime access KMS key; verifier API tokens are not exchanged.

The Coordinator records those public values in `deployment.json`. For a combined rollout, also set `inputs.nativeConfig.executor`, `eabExecutor`, and `attestationSigners` from the returned identities. Resolve every remaining `REVIEW_REQUIRED`, then run:

```bash
npm run external:rollout -- preflight --manifest "$ROLLOUT_DIR/deployment.json"
```

Check: `PREFLIGHT_PASSED`. This is read-only and fails on unresolved review values, missing scope/routes/limits/identities/confirmations/finality/Safe/health values, STRATO network mismatch, target RPC mismatch, or missing Safe code.

For `native-extension`, skip `bootstrap`: reuse the existing Runtime, proposer, verifier URLs, EAB/native signer identities, and executors, record them in the schema-version-1 manifest, then run `preflight`.

## 4. Generate preactivation

```bash
npm run external:rollout -- generate --manifest "$ROLLOUT_DIR/deployment.json"
```

Check only `.deployment/current/`. It contains the current bound outputs:

- `preactivation-admin.json`, when STRATO governance is pending;
- one `preactivation-safe-<safe>.json`, atomically combining pause, EAB configuration, and native destination configuration;
- `services.json` and `service-config.tar.gz`.

Generation fails if EAB and native use different Safes. It never emits activation calls.

STRATO admins use the same existing `app/contracts/.env` from step 2:

```bash
export ADMIN_APPROVAL_FILE=<ABSOLUTE_GENERATED_ADMIN_JSON_FROM_COORDINATOR>
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- approve \
  --file "$ADMIN_APPROVAL_FILE" \
  --env-file "$REPO_ROOT/app/contracts/.env"
```

Safe owners run:

```bash
npm run safe:batch -- inspect --file <SAFE_JSON> --chain-id "$TARGET_CHAIN_ID" --safe <SAFE>

read -rsp "Safe owner private key: " SAFE_OWNER_PRIVATE_KEY; echo
export SAFE_OWNER_PRIVATE_KEY
npm run safe:batch -- sign --file <SAFE_JSON> --chain-id "$TARGET_CHAIN_ID" --safe <SAFE> --output "$OWNER_SIGNATURE_FILE"
unset SAFE_OWNER_PRIVATE_KEY

read -rsp "Safe transaction executor private key: " SAFE_TX_EXECUTOR_PRIVATE_KEY; echo
export SAFE_TX_EXECUTOR_PRIVATE_KEY
npm run safe:batch -- execute --file <SAFE_JSON> --chain-id "$TARGET_CHAIN_ID" --safe <SAFE> --signature "$OWNER_SIGNATURE_FILE" --confirm "$REVIEWED_SAFE_TX_HASH"
unset SAFE_TX_EXECUTOR_PRIVATE_KEY
```

### Infra handoff and service startup

**Who:** Coordinator hands off the final generated package; Infra starts the provisioned services.

The Coordinator gives Infra:

- `.deployment/current/services.json`;
- `.deployment/current/service-config.tar.gz`;

Infra must:

1. Verify the archive against `services.json` and distribute the final EAB policy and, when present, native policy to each verifier operator.
2. After the preactivation STRATO and Safe batches have registered every signer, set `Running=Yes`, preview, and deploy each verifier. Confirm every verifier is healthy.
3. Give the Runtime operator the final `bridge.env.template`. Preserve its data volume, journals, and polling cursors; run only one Runtime for the STRATO environment.
4. Resolve the Runtime secrets, increase `RestartRevision`, then preview and deploy:

   ```bash
   eab-infra/guides/tools/deploy.sh <runtime-folder>/runtime.conf --preview
   eab-infra/guides/tools/deploy.sh <runtime-folder>/runtime.conf
   ```

5. Confirm `LastStart` reports `started <time>, ready`, the Runtime HTTPS health endpoint is ready, and its deployment metadata lists every reviewed verifier.

An `eab-only` package omits native Runtime variables and native verifier policy. A `combined` or `native-extension` package includes them. Infra must not add or remove native configuration independently of the generated package.

Infra then returns the deployed image revisions and confirms that the URLs and identities match `services.json`. Do not activate routes yet; the Coordinator runs step 5 first.

## 5. Verify

```bash
npm run external:rollout -- verify --manifest "$ROLLOUT_DIR/deployment.json"
```

Check: `READY_FOR_ACTIVATION`. Verify performs fresh Cirrus, target RPC, contract identity, Safe, policy, Runtime, and verifier readiness reads. It exits nonzero until preactivation and service readiness are complete.

## 6. Activate

```bash
npm run external:rollout -- activate --manifest "$ROLLOUT_DIR/deployment.json"
```

This re-runs verify gates and replaces `.deployment/current/` with activation-only handoffs. The Coordinator gives the STRATO admin the absolute `activation-admin.json` path. Set `ADMIN_APPROVAL_FILE` to that path and execute it with `approve --file "$ADMIN_APPROVAL_FILE" --env-file "$REPO_ROOT/app/contracts/.env"`. Execute `activation-safe-<safe>.json` with `safe:batch`. Activation is never included in preactivation.

## Recovery

Do not retry uncertain submissions. Reconcile live state and replace current outputs:

```bash
npm run external:rollout -- generate --manifest "$ROLLOUT_DIR/deployment.json"
```

After preactivation is complete:

```bash
npm run external:rollout -- verify --manifest "$ROLLOUT_DIR/deployment.json"
npm run external:rollout -- activate --manifest "$ROLLOUT_DIR/deployment.json"
```

Never reuse an older admin file, Safe signature, or Safe nonce.

`network:deploy-external --manifest` accepts only the reviewed schema-version-0 predeployment manifest. `bootstrap` expands it to schema version 1. After that, do not redeploy those contracts; recover from the existing deployment checkpoint and live transaction receipts. A separately approved replacement deployment must use the standalone chain-prefixed environment configuration and a new rollout directory.
