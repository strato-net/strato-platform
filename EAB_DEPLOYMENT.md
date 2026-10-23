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
printf 'TARGET_NETWORK=%s\nTARGET_CHAIN_ID=%s\nTARGET_RPC_ENV=%s\nVERIFIERS=%s/%s\n' \
  "$TARGET_NETWORK" "$TARGET_CHAIN_ID" "$TARGET_RPC_ENV" \
  "$VERIFIER_THRESHOLD" "$VERIFIER_COUNT"
```

The tooling loads `app/contracts/.env` and `app/ethereum/.env` directly.
The `eval` command is silent. Confirm the printed network, chain ID, RPC variable, and verifier threshold/count match the intended deployment before continuing.

The target Safe must already exist. Set its chain-scoped address in `app/ethereum/.env` before init:

```dotenv
CHAIN_<TARGET_CHAIN_ID>_SAFE_ADDRESS=<TARGET_SAFE_ADDRESS>
```

`init` validates this value and writes it to `discovery.target.safeAddress`; it never copies a Safe from the reference chain. It also assigns the Safe to all vault governance roles, matching the existing chain configurations. If a role uses a different address, set its chain-scoped role variable in `app/ethereum/.env` before init.

`init` prefills the canonical Permit2 address `0x000000000022D473030F116dDEE9F6B43aC78BA3`. Set `CHAIN_<TARGET_CHAIN_ID>_PERMIT2_ADDRESS` only when the target uses a different deployment. Preflight confirms that the selected address has target-chain bytecode.

```bash
npm run external:rollout -- init \
  --manifest "$ROLLOUT_DIR/deployment.json" \
  --chain-id "$TARGET_CHAIN_ID" \
  --source-chain-id "$SOURCE_CHAIN_ID"
```

Set `include`, target Safe/Permit2/role addresses, deployment and finality confirmations, route limits, and known public identities. For a first STRATO EAB deployment, leave `target.externalAssetBridge` and `target.tokenRouter` as `DEPLOY_REQUIRED` until step 2. Leave Infra-created verifier URLs, authorization signers, Runtime health URL, proposer, and executor values as `REVIEW_REQUIRED` until step 3.

Choose `scope: "combined"` (default EAB + native) or `"eab-only"`.

Every included `eabRoutes` item must explicitly contain:

```json
{
  "mintPolicy": {
    "capacity": "<STRATO_TOKEN_RAW_AMOUNT>",
    "refillRate": "<STRATO_TOKEN_RAW_AMOUNT_PER_SECOND>"
  },
  "tokenPolicy": {
    "minDepositAmount": "<EXTERNAL_TOKEN_RAW_AMOUNT>",
    "maxPerWithdrawal": "<EXTERNAL_TOKEN_RAW_AMOUNT>",
    "manualReviewThreshold": "<EXTERNAL_TOKEN_RAW_AMOUNT>",
    "bucketCapacity": "<EXTERNAL_TOKEN_RAW_AMOUNT>",
    "refillRate": "<EXTERNAL_TOKEN_RAW_AMOUNT_PER_SECOND>",
    "maxAutoWithdrawalAmount": "<EXTERNAL_TOKEN_RAW_AMOUNT>",
    "migrateAmount": "0",
    "enabled": true
  },
  "routePolicy": {
    "depositsEnabled": true,
    "withdrawalsEnabled": true,
    "rebaseRequired": false,
    "autoRouteEnabled": false,
    "maxAutoDepositAmount": "0"
  }
}
```

`mintPolicy` is shared by STRATO destination token, not isolated by external chain. If the `stratoToken` is already used by another route, changing its capacity or refill rate changes the existing routes too. Compare against the live policy and obtain explicit approval before generating the rollout.

Do not reformat values written by `init`. When replacing `REVIEW_REQUIRED`, use only this rule: flags are unquoted JSON booleans (`true` or `false`); editable integers are quoted decimal strings (`"120"` or `"0"`). Set zero explicitly when a numeric feature is disabled. `init` visibly prefills only equivalent MercataBridge fields: asset enablement, the withdrawal cap converted to target-token units, and the hot-wallet threshold converted to `manualReviewThreshold`. Review those values. Fields without an equivalent remain `REVIEW_REQUIRED`; expansion uses only the values recorded in this JSON and performs no hidden inheritance.

For combined scope, `init` also writes each native route's current `nativePolicy`:

```json
{
  "nativePolicy": {
    "externalName": "<NAME>",
    "externalSymbol": "<SYMBOL>",
    "maxPerWithdrawal": "<STRATO_TOKEN_RAW_AMOUNT>",
    "instantWithdrawalThreshold": "<STRATO_TOKEN_RAW_AMOUNT>",
    "enabled": true,
    "autoRouteEnabled": false,
    "sharedTokenSettings": {
      "depositsDisabled": false,
      "withdrawalsDisabled": true,
      "maxOutstandingWithdrawal": "<STRATO_TOKEN_RAW_AMOUNT>"
    }
  },
  "destinationPolicy": {
    "freezeRoute": "<REVIEW_BOOLEAN>",
    "transfersEnabled": "<REVIEW_BOOLEAN>"
  }
}
```

Review `discovery.target.nativeConfig.attestationThreshold` and `maxAttestationValiditySeconds` as well. Source-native values are visibly prefilled from `StratoNativeBridge`; target-only destination controls remain `REVIEW_REQUIRED`. Excluded native routes may retain review values.

### Funding checkpoints

- Before step 2, fund the target-chain contract deployer with the target chain's native gas token.
- Before executing generated batches, fund every STRATO admin with STRATO fee vouchers and fund the Safe transaction executor with the target chain's native gas token.
- After Infra returns the service identities and before startup, fund the Runtime EAB executor and, for combined deployments, the native mint executor with the target chain's native gas token. Fund the Runtime bridge-operator account and every verifier settlement-attestor account with STRATO fee vouchers.
- Check every distinct address separately. The Safe, authorization signers, and Safe proposer need no balance unless the same address also submits transactions.

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

For a new environment, the first package has `phase: foundation-identities`, a provisional `bridge.env.template`, and no verifier policies. Infra uses that template only to create or reuse the stopped Runtime foundations and each verifier's base account. The Runtime is expected to remain not ready. Infra returns the STRATO settlement-verifier addresses and Runtime values listed in `requiredReturn`. Record them in `discovery.target.settlementVerifiers` and the matching `services` fields, then run `bootstrap` again.

The second package has `phase: verifier-identities` and contains policies bound to the returned STRATO addresses. Infra gives each verifier operator its policy and Runtime access address and creates the chain's verifier stack with `Running=No`:

```bash
eab-infra/guides/tools/deploy.sh <verifier-folder>/<network>.conf --preview
eab-infra/guides/tools/deploy.sh <verifier-folder>/<network>.conf
```

`Running=No` creates the endpoint and KMS signer identities without starting traffic. Registration and voucher checks apply only when changing to `Running=Yes`.

Infra returns every value named in the second package's `requiredReturn`. The Coordinator records the verifier URLs and signer addresses in the schema-version-0 `deployment.json`. For a combined rollout, also set `discovery.target.nativeConfig.executor`, `eabExecutor`, and `attestationSigners`. Resolve every remaining `REVIEW_REQUIRED`, then run:

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

When a preactivation Safe file is generated, Safe owners execute it before any STRATO admin approval:

```bash
export SAFE_JSON=<ABSOLUTE_PREACTIVATION_SAFE_JSON>
export SAFE=<SAFE_ADDRESS>
export OWNER_SIGNATURE_FILE="$ROLLOUT_DIR/preactivation-owner-signature.json"

cd "$REPO_ROOT/app/ethereum"
npm run safe:batch -- inspect --file "$SAFE_JSON" --chain-id "$TARGET_CHAIN_ID" --safe "$SAFE"

export REVIEWED_SAFE_TX_HASH=<SAFE_TX_HASH_PRINTED_BY_INSPECT>

set -a
source "$REPO_ROOT/app/ethereum/.env"
set +a
export SAFE_OWNER_PRIVATE_KEY="$PRIVATE_KEY"
npm run safe:batch -- sign --file "$SAFE_JSON" --chain-id "$TARGET_CHAIN_ID" --safe "$SAFE" --output "$OWNER_SIGNATURE_FILE"
unset SAFE_OWNER_PRIVATE_KEY

export SAFE_TX_EXECUTOR_PRIVATE_KEY="$PRIVATE_KEY"
npm run safe:batch -- execute --file "$SAFE_JSON" --chain-id "$TARGET_CHAIN_ID" --safe "$SAFE" --signature "$OWNER_SIGNATURE_FILE" --confirm "$REVIEWED_SAFE_TX_HASH"
unset SAFE_TX_EXECUTOR_PRIVATE_KEY PRIVATE_KEY
```

These commands assume `app/ethereum/.env` `PRIVATE_KEY` is both a Safe owner and the funded transaction executor. If they are different accounts, export each corresponding private key explicitly under `SAFE_OWNER_PRIVATE_KEY` and `SAFE_TX_EXECUTOR_PRIVATE_KEY`; `safe:batch` does not use `PRIVATE_KEY` as an automatic fallback.

On chains supported by Safe Transaction Builder, upload the generated `preactivation-safe-<safe>.json` unchanged, review it, and sign/execute it in the Safe UI instead of running the CLI `sign` and `execute` commands.

After the Safe transaction confirms, the Coordinator reruns `generate`. Discard the previous `.deployment/current/` outputs and use only the replacements:

```bash
npm run external:rollout -- generate --manifest "$ROLLOUT_DIR/deployment.json"
```

If no preactivation Safe file was generated, no rerun is required. STRATO admins then use the current `preactivation-admin.json` and the same existing `app/contracts/.env` from step 2:

```bash
export ADMIN_APPROVAL_FILE=<ABSOLUTE_CURRENT_ADMIN_JSON_FROM_COORDINATOR>
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- approve \
  --file "$ADMIN_APPROVAL_FILE" \
  --env-file "$REPO_ROOT/app/contracts/.env"
```

### Infra handoff and service startup

**Who:** Coordinator hands off the final generated package; Infra starts the provisioned services.

The Coordinator gives Infra:

- `.deployment/current/services.json`;
- `.deployment/current/service-config.tar.gz`;

Infra must:

1. Verify the archive against `services.json` and distribute the final EAB policy and, when present, native policy to each verifier operator.
2. After the preactivation STRATO and Safe batches have registered every signer, set `Running=Yes`, preview, and deploy each verifier. Confirm every verifier is healthy.
3. Apply `bridge.env.template`:
   - For the first chain in a new Runtime, upload the generated template unchanged.
   - For an existing Runtime, the generated file is a chain-specific input, not a complete replacement. Infra starts from the currently deployed canonical template, merges only the new `CHAIN_<TARGET_CHAIN_ID>_*` rows, and preserves every existing chain row.
   - Compare global rows such as `NODE_URL`, bridge addresses, `TOKEN_ROUTER`, `SAFE_ADDRESS`, proposer, and shared token addresses. Do not overwrite a conflicting global value; stop and return the conflict to the Coordinator.
   - Upload the resulting complete merged template unchanged. Preserve the Runtime data volume, journals, and polling cursors; run only one Runtime for the STRATO environment.
4. Resolve the Runtime secrets, increase `RestartRevision`, then preview and deploy:

   ```bash
   eab-infra/guides/tools/deploy.sh <runtime-folder>/runtime.conf --preview
   eab-infra/guides/tools/deploy.sh <runtime-folder>/runtime.conf
   ```

5. Confirm `LastStart` reports `started <time>, ready`, the Runtime HTTPS health endpoint is ready, and its deployment metadata lists every reviewed verifier.

An `eab-only` package omits native Runtime variables and native verifier policy. A `combined` or `native-extension` package includes them. Infra must not add or remove native configuration independently of the generated package.

Infra then returns the deployed image revisions and confirms that the URLs and identities match `services.json`. Do not activate routes yet; the Coordinator runs step 5 first.

### Rewards poller readiness

Before activating a route that should earn rewards, deploy a rewards-poller release that supports ExternalAssetBridge and TokenRouter events. Configure the poller with:

```bash
EXTERNAL_ASSET_BRIDGE_ADDRESS=<EAB_PROXY>
TOKEN_ROUTER=<TOKEN_ROUTER_PROXY>
```

For a combined or native rollout, also set `STRATO_NATIVE_BRIDGE=<STRATO_NATIVE_BRIDGE_PROXY>`. Preserve the poller's existing state and cursor when restarting it.

If the legacy MercataBridge remains active in parallel, keep its existing rewards activity and mapping; adding ExternalAssetBridge does not replace it. Verify that the intended EAB and routed-trade activities are configured in the Rewards contract, then confirm the poller is healthy before route activation or the first canary.

Do not let the poller process reward-eligible EAB or TokenRouter events with missing or incorrect addresses. Skipped events advance the poller cursor and are not recovered automatically. If rewards are intentionally excluded from a limited test, record that decision and do not expect those test transactions to receive rewards retroactively.

## 5. Verify

```bash
npm run external:rollout -- verify --manifest "$ROLLOUT_DIR/deployment.json"
```

Check: `READY_FOR_ACTIVATION`. Verify performs fresh Cirrus, target RPC, contract identity, Safe, policy, Runtime, and verifier readiness reads. It exits nonzero until preactivation and service readiness are complete.

## 6. Activate

```bash
npm run external:rollout -- activate --manifest "$ROLLOUT_DIR/deployment.json"
```

This re-runs verify gates and replaces `.deployment/current/` with activation-only handoffs. The Coordinator gives the STRATO admin the absolute `activation-admin.json` path. The admin confirms that `app/contracts/.env` contains their credentials and a current `OAUTH_TOTP` when required, then runs:

```bash
export REPO_ROOT=<ABSOLUTE_REPOSITORY_PATH>
export ADMIN_APPROVAL_FILE=<ABSOLUTE_ACTIVATION_ADMIN_JSON_FROM_COORDINATOR>

cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- approve \
  --file "$ADMIN_APPROVAL_FILE" \
  --env-file "$REPO_ROOT/app/contracts/.env"
```

Execute `activation-safe-<safe>.json` with `safe:batch`. Activation is never included in preactivation.

After both activation handoffs execute, run the final read-only verification:

```bash
npm run external:rollout -- verify --manifest "$ROLLOUT_DIR/deployment.json"
```

Check: `ACTIVE_VERIFIED`. Then complete one deposit and one withdrawal canary before declaring the launch complete.

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

`network:deploy-external --manifest` accepts only the reviewed schema-version-0 predeployment manifest. `bootstrap` leaves it at schema version 0; `generate` expands it only after identities and policy are complete. Do not redeploy existing contracts after bootstrap; recover from the deployment checkpoint and live transaction receipts. A separately approved replacement deployment must use the standalone chain-prefixed environment configuration and a new rollout directory.

## `REVIEW_REQUIRED` checkpoints

`REVIEW_REQUIRED` means that the value is not known yet; it does not mean every value must be filled immediately after `init`. Resolve values by the following checkpoint. Values belonging only to excluded routes or to native configuration in an `eab-only` rollout may remain unresolved.

### Before target contract deployment

Resolve the target chain, Safe, Permit2, governance-role addresses, guardian, deployment confirmations, and selected route/token addresses. For a first STRATO EAB deployment, `externalAssetBridge` and `tokenRouter` remain `DEPLOY_REQUIRED` until their STRATO deployment completes.

### Before the first `bootstrap`

Record the external deployment artifact and, for a combined rollout, each native deployment artifact. Select the included routes and review their public token metadata and policy limits. Infra-created settlement verifiers, verifier URLs, signers, Runtime URL, proposer, executors, and Runtime access address may remain `REVIEW_REQUIRED`.

Deployment addresses and blocks contained in referenced artifacts are artifact-derived values, not operator inputs. Do not hand-type `depositRouterDeploymentBlock`, deployed proxy addresses, native bridge addresses, or representation-token addresses.

### Before the second `bootstrap`

Record every value returned by the `foundation-identities` package:

- `discovery.target.settlementVerifiers`;
- `services.safeProposerAddress`, `executorAddress`, `bridgeHealthUrl`, and `runtimeAccessAddress`;
- for a combined rollout, `discovery.target.nativeConfig.executor` and `eabExecutor`.

Resolve every field of each included route using JSON booleans for flags and decimal strings for raw amounts. Verifier URLs, EAB authorization signers, and native attestation signers remain unresolved until Infra applies the second package with `Running=No`.

### Before `preflight`

Record every value returned by the `verifier-identities` package:

- each `services.verifiers[i].url`;
- each corresponding `authorizationSigners[i]`;
- for a combined rollout, each `discovery.target.nativeConfig.attestationSigners[i]`.

Use quoted decimal strings for confirmation counts and unquoted JSON booleans for policy flags. At this checkpoint no `REVIEW_REQUIRED` value may remain in the target, services, authorization signers, included EAB routes, or included native routes.

### Before `generate`

`preflight` must report `PREFLIGHT_PASSED`. No additional manifest values are added between `preflight` and `generate`.

### Before `verify` and `activate`

No manifest values are added. Execute the generated preactivation governance and Safe batches, apply the final Infra package, and start the Runtime and verifiers. `verify` must report `READY_FOR_ACTIVATION` before executing the activation batches.
