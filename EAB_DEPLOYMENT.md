# EAB and Native Bridge: Five-Step Deployment

Use exactly four roles. **Coordinator** prepares the release, deploys external-chain contracts and tracks progress. **Admin 1** initiates STRATO deployments and votes. **Admin 2** supplies the second vote. Both administrators also review/sign Safe transactions. **Infra** provisions identities and deploys workloads. If the live governance threshold requires additional approvals, obtain them before continuing; do not change the threshold to fit this guide.

The coordinator edits **one file: `deployment.json`**. Distribute **one package at a time: `deployment-bundle.json`**. The provisioning package is replaced by the final reviewed package during Step 3. Its checksum changes; every recipient explicitly rejoins the final package. Generated policies, Safe JSON, snapshots, profiles and progress reports stay under `.deployment/`. Never edit them or delete that directory to reset progress. Each person keeps their own credentials locally; credentials are never part of either shared file.

For EAB-only, exclude every native route. For EAB plus native, include the approved native routes. Native-only installations retain their dedicated guide; do not invent an EAB token route just to use this tool. Existing native contracts are upgraded without reinitialization. Legacy backing migration remains a separate operation under `EAB_CUTOVER.md`.

Every command below is a single shell line. Replace every `<PLACEHOLDER>` before execution. **Set** means human input. **Derived** means a previous command supplies it. **Verify** is a mandatory check. No command in `continue` submits a transaction; it reads current state and prints the exact next action and approval hash.

## 1. Prepare the release and identities

**Coordinator — Set:** repository path, environment (`testnet` or `prod`), external network family, STRATO HTTPS host and a new rollout directory. HyperEVM is production-only.

```bash
export REPO_ROOT=<ABSOLUTE_STRATO_PLATFORM_REPOSITORY> DEPLOY_ENV=<testnet-or-prod> NETWORK=<ethereum-or-base-or-linea-or-robinhood-or-hyperevm> STRATO_NODE_URL=https://<STRATO_HOST> ROLLOUT_DIR=<ABSOLUTE_NEW_ROLLOUT_DIRECTORY>
```

**Coordinator — Verify:** reviewed commit, clean checkout and matching immutable contract/runtime/backend/UI image releases. Record the commit; never use a moving branch or image tag for deployment.

```bash
cd "$REPO_ROOT" && test -z "$(git status --porcelain)" && export RELEASE_COMMIT="$(git rev-parse HEAD)" && mkdir -p "$ROLLOUT_DIR/.deployment" && chmod 700 "$ROLLOUT_DIR" "$ROLLOUT_DIR/.deployment"
```

**Derived:** `TARGET_NETWORK`, `TARGET_CHAIN_ID`, `TARGET_RPC_ENV`, `VERIFIER_COUNT`, `VERIFIER_THRESHOLD`. Verify they describe the approved network.

```bash
eval "$(cd "$REPO_ROOT/app/ethereum" && npm run --silent network:environment)"
```

**Every role — Set locally:** its own STRATO OAuth credentials in `app/contracts/.env` when needed. Coordinator sets its read credentials, deployer key and selected RPC in `app/ethereum/.env`. Set both the registry-named RPC variable and `CHAIN_<TARGET_CHAIN_ID>_RPC_URL` to the approved HTTPS RPC. Never distribute these files. Admin 1 and Admin 2 must use different signing accounts. Each account needs STRATO transaction fees.

```bash
cd "$REPO_ROOT/app/contracts" && npm ci
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm ci && npm run compile
```

**Infra — Set/Verify:** reviewed Infra release, AWS account/profile for each workload, DNS, two independent RPC providers per verifier, STRATO attestor identities, operator/relayer accounts, Safe proposer and executors. Return public addresses and endpoints only. Keep KMS ARNs, API tokens and credentials in Infra's private configuration. Native verification needs its native signer/executor configuration as well. Workloads remain stopped.

**Admins — Verify:** the selected Safe's owners and approval threshold. **Coordinator — Set:** the reviewed Safe address, AdminRegistry address and deployment confirmation count.

```bash
export SAFE_ADDRESS=<0x_SAFE_ADDRESS> ADMIN_REGISTRY=<STRATO_ADMIN_REGISTRY_WITHOUT_0X> DEPLOYMENT_CONFIRMATIONS=<POSITIVE_INTEGER>
```

## 2. Deploy contracts and build the deployment file

**Admin 1 — Run:** deploy the fresh TokenRouter and EAB proxies if approved for this rollout. **Admin 2 — Act:** vote on each printed contract-creation issue; never rerun a deployment to cast a vote. After creation, Admin 1 runs the corresponding upgrade; Admin 2 votes on both printed implementation-creation and `setLogicContract` issues. Wait for execution before proceeding.

```bash
cd "$REPO_ROOT/app/contracts" && npm run deployProxy -- --empty --owner "$ADMIN_REGISTRY" --contract-file BaseCodeCollection.sol
```

**Set/Verify:** `<TOKEN_ROUTER_PROXY>` is the proxy returned by that deployment, rather than the implementation.

```bash
cd "$REPO_ROOT/app/contracts" && npm run upgrade -- --proxy-address <TOKEN_ROUTER_PROXY> --contract-name TokenRouter --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

```bash
cd "$REPO_ROOT/app/contracts" && npm run deployProxy -- --empty --owner "$ADMIN_REGISTRY" --contract-file BaseCodeCollection.sol
```

**Set/Verify:** `<EAB_PROXY>` is the second deployed proxy.

```bash
cd "$REPO_ROOT/app/contracts" && npm run upgrade -- --proxy-address <EAB_PROXY> --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

**Native included:** use the reviewed upgrades in `NATIVE_BRIDGE_DEPLOYMENT.md` / the production native runbook. Preserve existing proxies, mappings and custody. Do not initialize existing proxies. Admins review every upgrade and keep native intake paused until the handoff and activation checks are complete.

**Coordinator — Set:** chain-specific deployment roles to the approved Safe. Verify the role addresses and confirmation count in the preflight output before `--execute`.

```bash
export "CHAIN_${TARGET_CHAIN_ID}_DEPLOYMENT_CONFIRMATIONS=$DEPLOYMENT_CONFIRMATIONS" "CHAIN_${TARGET_CHAIN_ID}_SAFE_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_VAULT_DEFAULT_ADMIN_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_VAULT_UPGRADER_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_VAULT_POLICY_ADMIN_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_GUARDIAN_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_VAULT_UNPAUSER_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_VAULT_ATTESTATION_ADMIN_ADDRESS=$SAFE_ADDRESS" "CHAIN_${TARGET_CHAIN_ID}_LARGE_WITHDRAWAL_APPROVER_ADDRESS=$SAFE_ADDRESS"
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR/.deployment/external"
```

**Production only — Set:** explicit authorization for the selected chain.

```bash
export CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$TARGET_CHAIN_ID"
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR/.deployment/external" --execute
```

**Verify:** the generated deployment record reports the approved chain, Safe, distinct proxies/implementations and successful checks. The tool records external addresses; do not retype them. Remove the deployer key from the shell and `.env` after deployment. Admins execute the printed Safe pause transactions before configuration; a fresh vault starts unpaused.

```bash
unset PRIVATE_KEY
```

**Coordinator — Set:** `<EXISTING_EXTERNAL_CHAIN_ID>` is the source of the approved mappings. Discovery is read-only; it does not approve importing every route.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run bridge:prepare -- --discover --node-url "$STRATO_NODE_URL" --chain-id "$TARGET_CHAIN_ID" --source-chain-id <EXISTING_EXTERNAL_CHAIN_ID> --output-dir "$ROLLOUT_DIR/.deployment/discovery"
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- init --discovery "$ROLLOUT_DIR/.deployment/discovery/prepare.json" --manifest "$ROLLOUT_DIR/deployment.json"
```

**Edit only `deployment.json`:** set `discovery.target.externalAssetBridge` to the approved EAB proxy; correct the target native bridge/representation addresses when native is included; set `include=true` only on approved EAB/native routes. Verify source/target networks, original token and representation mappings. The external deployment record under `.deployment/external` is loaded automatically. Exclude all native routes for EAB-only.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- init --manifest "$ROLLOUT_DIR/deployment.json"
```

**Edit the same file after `MANIFEST_CREATED`:** verify/set `settings.tokenRouter`, `settings.externalAssetBridge`, dependencies, operator, guardian and STRATO attestors. Review `policy` permissions and every raw amount. Set Runtime confirmations. Keep liquidity migration zero. Keep withdrawals disabled for an initial deposit-only rollout. Native inputs are embedded under `inputs.nativeRoutes` and `inputs.nativeConfig`; review token pairs, limits, signer threshold, executor, transfer and freeze settings there. Do not edit separate generated files.

For a fresh route with no discoverable mapping, use the detailed preparation reference below to populate that route; do not copy an unrelated token's decimals or limits.

## 3. Provision, review and configure

**Coordinator — Run:** create the single pre-Infra package. This package cannot authorize governance or activation.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment.json" --stage initial
```

**Verify:** `PROVISIONING_PACKAGE_READY`; routes, limits, dependency addresses, attestors and confirmations are decided. Only workload-generated signer/proposer/executor identities or endpoint bindings may remain outstanding. Send the printed bundle and SHA-256 to Infra. Infra saves its local copy as `deployment-bundle.json` in its secured rollout directory.

**Infra — Set:** its own `ROLLOUT_DIR`, `REPO_ROOT`, `INFRA_ENV`, `INFRA_NETWORK` and selected AWS credentials. Verify the received bundle checksum against the coordinator's separately provided value.

```bash
shasum -a 256 "$ROLLOUT_DIR/deployment-bundle.json"
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- join --role infra --bundle "$ROLLOUT_DIR/deployment-bundle.json"
```

**Infra — Use:** the printed managed policies/templates and `.deployment/infra/services.json`; no separate generated files need to be transferred. Fill the corresponding reviewed Infra network profiles, verify policy hashes and immutable image digests, and keep `Running=No`. Native policy paths are supplied only when native routes are selected. Return the actual public KMS signer/proposer/executor addresses and verifier endpoints.

**Coordinator — Edit only `deployment.json`:** enter Infra's returned addresses, verifier URLs and token environment-variable names. For native, resolve `inputs.nativeConfig` signer/executor settings as well. Remove every `REVIEW_REQUIRED` value; never paste secret values into this file.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment.json"
```

**Verify:** `PREPARED_FOR_REVIEW`. Review the printed contract bindings, identities, thresholds, starting block, token pairs, permissions, raw limits and confirmations. This creates the final `deployment-bundle.json`. Distribute that one file and its SHA-256 to both admins and Infra; archive the provisioning copy. Everyone verifies the new checksum and explicitly joins the final package.

**Admin 1 — Run with their own credentials:**

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- join --role admin-1 --bundle "$ROLLOUT_DIR/deployment-bundle.json"
```

**Admin 2 — Run with their own credentials:**

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- join --role admin-2 --bundle "$ROLLOUT_DIR/deployment-bundle.json"
```

**Infra — Rejoin the final package:**

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- join --role infra --bundle "$ROLLOUT_DIR/deployment-bundle.json"
```

**Coordinator — Use throughout the remaining steps:**

```bash
export EAB_ROLLOUT_CONFIG="$ROLLOUT_DIR/.deployment/coordinator.json"
```

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- continue
```

Run only the next printed action. Coordinator imports the pending Safe JSON; admins review/sign/execute it. For STRATO actions, each required administrator uses their local profile and the fresh vote command/hash printed by the tool. After a vote, wait for the other administrator and execution/indexing; never rerun a deployment or reuse an old hash. Coordinator reruns `continue` after the action completes.

**Native included:** follow the printed native route dry-runs, admin votes and external Safe configuration command. Require `0 pending calls` from native configuration before proceeding. Confirm native `bridgeOperator` equals the Runtime's actual STRATO service account; make any required operator/guardian changes through governance. Native attestors and limits must match the generated native verifier policies. EAB-only produces no native configuration steps.

## 4. Start services and verify readiness

**Infra — Verify the handoff first:** pause/drain old intake and account for pending withdrawals, deposits, refunds and Safe proposals. Stop the old native processor; prevent its scheduler from restarting it. Preserve journals/cursors. If sharing a Safe, stop the old proposal writer and reconcile all pending/future nonces before enabling the new writer. Never run both native processors. Do not copy a legacy cursor into a fresh EAB data volume.

**Infra — Set/Verify:** correct AWS account, approved image digests, private RPCs/tokens/KMS settings, final package policy hashes and durable data volume. Use the final `services.json` paths. Preserve other chain bindings when adding a network to an existing Runtime; do not replace its complete template with a single-chain template. For each verifier, select that verifier's AWS credentials and set `VERIFIER_NUMBER` before running the reviewed Infra profile.

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY> && guides/tools/deploy.sh "deployments/$INFRA_ENV/verifier-$VERIFIER_NUMBER/$INFRA_NETWORK.conf" --preview
```

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY> && guides/tools/deploy.sh "deployments/$INFRA_ENV/verifier-$VERIFIER_NUMBER/$INFRA_NETWORK.conf"
```

Repeat for the network-derived verifier count. Start verified workloads only after Step 3 and the handoff gate pass. Preview/apply the Runtime with the reviewed final configuration; increase `RestartRevision` once.

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY> && guides/tools/deploy.sh "deployments/$INFRA_ENV/runtime/runtime.conf" --preview
```

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY> && guides/tools/deploy.sh "deployments/$INFRA_ENV/runtime/runtime.conf"
```

**Verify:** all verifiers and Runtime are healthy; chain, bridge/vault, signer, attestor, confirmations and policy hashes match the final package. Fund operator, relayer, attestors and executors. Register proposer as a Safe delegate, not an owner. Stage the matching backend/UI behind closed public intake and verify `/api/config` and route quotes on the actual public hostname.

**Coordinator — Set locally:** `BRIDGE_HEALTH_URL` to the deployed Runtime's HTTPS health endpoint; RPC/auth/token variables named in the deployment file must be available to the current process or its private environment file. Require a successful readiness result before activation.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- verify
```

## 5. Activate and run canaries

**Coordinator — Run:** obtain the current activation action. Review and execute only the exact printed `activate --approve <HASH>` command; do not construct or reuse the hash.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- continue
```

**Admins — Act:** independently review/sign/execute the generated activation Safe transaction. For native, separately approve the native route enablement votes and representation-bridge activation from the managed native configuration path printed in Step 3. Keep native inactive until both STRATO and external configuration and readiness checks pass. These approvals do not require another human role.

```bash
cd "$REPO_ROOT/app/ethereum" && npm run external:rollout -- continue
```

**Verify before public intake:** plain deposit/redemption; permitted routing success and fallback; below-threshold execution; manual Safe execution; rejection/refund/cancellation; retry after completion without another mint/release/burn. Reconcile user, custody, escrow, representation supply and recipient balances. Native canaries apply only when native is included. A pending Safe proposal is not a completed transfer.

Record canary transaction IDs and results with the release and bundle checksum. Open public intake only after completion. To roll back, pause external intake first, retain workers until accepted operations are settled/reconciled, then stop the affected stack. Preserve journals and the `.deployment` evidence directory. For legacy custody movement, use the separate cutover reconciliation gate.


# Detailed reference

The five steps above are the execution checklist. The material below explains individual operations and legacy/manual invocation options; do not execute it as a second deployment sequence. Generated files in the five-step flow live under `.deployment/`; explicit output paths below remain supported for existing rollouts.


Deploy one External Asset Bridge between one STRATO network and one supported
external EVM chain.

Use separate testnet and production accounts, keys, Safes, contracts, services,
and data directories.

For legacy custody migration, complete `EAB_CUTOVER.md`.

For STRATO-native routing, complete `NATIVE_BRIDGE_DEPLOYMENT.md` after this
EAB deployment.

## Roles

- Coordinator: release, manifest, external deployment, Safe proposals,
  readiness, activation, and canary.
- STRATO administrators: STRATO proxy deployment and AdminRegistry votes.
- Safe owners: external Safe review, signing, and execution.
- Infra: AWS, IAM, KMS, DNS, RPCs, verifier services, Runtime, secrets, images,
  and executor gas.

## Required contracts

Deploy or explicitly approve the reuse of:

### STRATO

- `TokenRouter` proxy and implementation.
- `ExternalAssetBridge` proxy and implementation.

### External EVM chain

- Safe.
- `ExternalBridgeVault` proxy and implementation.
- `ExternalAssetDepositRouter` proxy and implementation.

### Existing dependencies

Record verified addresses for:

- AdminRegistry.
- TokenFactory.
- USDST.
- PriceOracle.
- PoolFactory.
- PoolV3Factory.
- DirectMintPSM.
- MetalForge.
- SaveUSDSTVault.
- Approved yield vaults.
- Permit2.
- External source tokens.
- STRATO destination tokens.

## Stop rules

- Stop on any failed command or mismatched address.
- Wait for each AdminRegistry issue and Safe transaction to execute.
- Never start a second deployment command to vote on an existing issue.
- Never reuse an old approval hash.
- Never put private keys, OAuth secrets, RPC credentials, verifier tokens, or
  KMS ARNs in the manifest or bundle.
- Keep the vault and DepositRouter paused from configuration through readiness.
- Do not activate before all readiness checks pass.
- Do not use native deployment steps for an EAB-only rollout.

## 1. Freeze the release

Use Node.js 22.12 or later and one reviewed commit on every machine.

```bash
cd <STRATO_PLATFORM_REPOSITORY>
test -z "$(git status --porcelain)"
export REPO_ROOT="$PWD"
export RELEASE_COMMIT="$(git rev-parse HEAD)"
```

Record immutable image digests built from `RELEASE_COMMIT`:

```text
BRIDGE_IMAGE_DIGEST=
BRIDGE_NGINX_IMAGE_DIGEST=
BACKEND_IMAGE_DIGEST=
UI_IMAGE_DIGEST=
```

Require successful contract, rollout, `bridge-eab`, backend, and UI builds.

## 2. Select the networks

Set the STRATO environment, external-chain family, and STRATO node:

```bash
cd "$REPO_ROOT"
export DEPLOY_ENV=<testnet|prod>
export NETWORK=<ethereum|base|linea|robinhood>
export STRATO_NODE_URL=https://<STRATO_HOST>
```

Production may also use:

```bash
export DEPLOY_ENV=prod
export NETWORK=hyperevm
```

Do not select HyperEVM with `DEPLOY_ENV=testnet`.

Derive the external network values:

```bash
eval "$(cd "$REPO_ROOT/app/ethereum" && npm run --silent network:environment)"
```

Record the output:

```text
TARGET_NETWORK=
TARGET_CHAIN_ID=
TARGET_RPC_ENV=
VERIFIER_COUNT=
VERIFIER_THRESHOLD=
```

Create the rollout directory:

```bash
export ROLLOUT_DIR="$HOME/bridge-rollouts/${TARGET_NETWORK}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ROLLOUT_DIR"
chmod 700 "$ROLLOUT_DIR"
```

## 3. Prepare local environments

### Every STRATO administrator

```bash
cd "$REPO_ROOT/app/contracts"
[ -f .env ] || cp .env.sample .env
chmod 600 .env
npm install
```

Set that administrator's own values in `app/contracts/.env`:

```text
NODE_URL=<same value as STRATO_NODE_URL>
OAUTH_URL=
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
GLOBAL_ADMIN_NAME=
GLOBAL_ADMIN_PASSWORD=
```

Fund each administrator's STRATO address for deployment and governance fees.

Install the rollout tooling and set the external read-only RPC on every
administrator machine:

```bash
cd "$REPO_ROOT/app/ethereum"
npm install
```

Set `CHAIN_<TARGET_CHAIN_ID>_RPC_URL` in `app/ethereum/.env`. Do not set
`PRIVATE_KEY`.

### Coordinator

Set the coordinator's read-only STRATO credentials in
`app/contracts/.env`. Set `NODE_URL` to the same value as `STRATO_NODE_URL`.

```bash
cd "$REPO_ROOT/app/ethereum"
[ -f .env ] || cp env.example .env
chmod 600 .env
npm install
npm run compile
```

Set the approved external RPC under both required names:

```bash
export "$TARGET_RPC_ENV=https://<EXTERNAL_RPC>"
export "CHAIN_${TARGET_CHAIN_ID}_RPC_URL=${!TARGET_RPC_ENV}"
```

Persist the same two values in `app/ethereum/.env`.

Use the same STRATO host for `STRATO_NODE_URL`, `app/contracts/.env` `NODE_URL`,
and the manifest's `services.nodeUrl`.

Set explorer credentials in `app/ethereum/.env` when verification requires
them.

Keep `PRIVATE_KEY` unset until the external contract deployment.

## 4. Provision base infrastructure and STRATO identities

Coordinator:

- Creates one STRATO/OAuth identity per verifier.
- Creates distinct Runtime operator and relayer STRATO/OAuth identities.
- Funds every identity.
- Records `VERIFIER_COUNT` independent verifier regions and RPC-provider
  allocations.
- Grants each operator access to the reviewed `eab-infra` commit.

Record:

```text
BRIDGE_OPERATOR_STRATO_ADDRESS=
RELAYER_STRATO_ADDRESS=
VERIFIER_<N>_STRATO_ATTESTOR_ADDRESS=
```

Runtime operator deploys the Runtime account base stack and returns:

```text
RUNTIME_ACCOUNT_ID=
RUNTIME_EGRESS_IP=
```

Give `RUNTIME_EGRESS_IP/32` to every verifier operator as `AllowedIp1`.

Each verifier operator deploys only its base stack and returns:

```text
ACCOUNT_ID=
REGION=
STRATO_ATTESTOR_ADDRESS=
EGRESS_IP=
RPC_PROVIDER_NAMES=
```

Coordinator grants:

- Verifier accounts access to `strato/bridge-eab`.
- Runtime account access to `strato/bridge-eab`.
- Runtime account access to `strato/bridge-eab-nginx`.

Keep verifier workloads stopped.

Do not enable the new chain in a running Runtime.

Require:

- Exactly `VERIFIER_COUNT` base-stack outputs.
- Unique verifier regions.
- Unique attestor addresses.
- Approved independent RPC-provider allocation.
- Operator and relayer are distinct from every attestor.

## 5. Deploy or approve the external Safe

Deploy a new Safe for a fresh production EAB deployment.

Record:

```text
SAFE_ADDRESS=
SAFE_OWNERS=
SAFE_THRESHOLD=
SAFE_DEPLOYMENT_TRANSACTION=
```

Verify:

- Safe has bytecode on `TARGET_CHAIN_ID`.
- Safe owners match the approved owners.
- Safe threshold matches the approved threshold.
- Safe Transaction Service recognizes the Safe.
- An executing Safe owner wallet has external-chain gas.

## 6. Deploy the STRATO contracts

Deploy TokenRouter and ExternalAssetBridge once per STRATO environment.

For an additional external chain on the same STRATO environment, reuse the
canonical initialized proxies only after verifying their live implementations,
owners, chain configuration, and routes. Do not deploy duplicate STRATO
proxies per external chain.

For a fresh STRATO environment, complete both deployments below.

### TokenRouter

Admin 1 starts the proxy deployment and leaves it running:

```bash
cd "$REPO_ROOT/app/contracts"
npm run deployProxy -- --empty --owner <ADMIN_REGISTRY_ADDRESS> --contract-file BaseCodeCollection.sol
```

Other administrators vote on the printed creation issue in the STRATO Admin
UI.

Record:

```text
TOKEN_ROUTER_PROXY=
```

Admin 1 starts the implementation upgrade:

```bash
npm run upgrade -- --proxy-address "$TOKEN_ROUTER_PROXY" --contract-name TokenRouter --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

Other administrators vote on the printed implementation and
`setLogicContract` issues.

Record:

```text
TOKEN_ROUTER_IMPLEMENTATION=
```

Verify the proxy's live `logicContract` equals
`TOKEN_ROUTER_IMPLEMENTATION`.

### ExternalAssetBridge

Admin 1 starts the proxy deployment and leaves it running:

```bash
npm run deployProxy -- --empty --owner <ADMIN_REGISTRY_ADDRESS> --contract-file BaseCodeCollection.sol
```

Other administrators vote on the printed creation issue.

Record:

```text
EXTERNAL_ASSET_BRIDGE_PROXY=
```

Admin 1 starts the implementation upgrade:

```bash
npm run upgrade -- --proxy-address "$EXTERNAL_ASSET_BRIDGE_PROXY" --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

Other administrators vote on the printed implementation and
`setLogicContract` issues.

Record:

```text
EXTERNAL_ASSET_BRIDGE_IMPLEMENTATION=
```

Verify the proxy's live `logicContract` equals
`EXTERNAL_ASSET_BRIDGE_IMPLEMENTATION`.

Keep both STRATO proxies uninitialized until the rollout configuration stage.

## 7. Deploy the external vault and DepositRouter

Set the deployment key only on the coordinator machine:

```bash
cd "$REPO_ROOT/app/ethereum"
export PRIVATE_KEY=<EXTERNAL_DEPLOYER_PRIVATE_KEY>
export SAFE_ADDRESS=<EXTERNAL_SAFE_ADDRESS>
```

Verify Permit2 has bytecode at the default address. If the target chain uses a
different reviewed deployment, set
`CHAIN_<TARGET_CHAIN_ID>_PERMIT2_ADDRESS`.

Set deployment confirmations and every external role:

```bash
export "CHAIN_${TARGET_CHAIN_ID}_DEPLOYMENT_CONFIRMATIONS=<APPROVED_COUNT>"
export "CHAIN_${TARGET_CHAIN_ID}_SAFE_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_DEFAULT_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_UPGRADER_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_POLICY_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_GUARDIAN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_UNPAUSER_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_ATTESTATION_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_LARGE_WITHDRAWAL_APPROVER_ADDRESS=$SAFE_ADDRESS"
```

`SAFE_ADDRESS` is only a shell helper. The deployment reads
`CHAIN_<TARGET_CHAIN_ID>_SAFE_ADDRESS` and the chain-scoped role variables.

Persist `DEPLOY_ENV`, `NETWORK`,
`CHAIN_<TARGET_CHAIN_ID>_DEPLOYMENT_CONFIRMATIONS`, and all
`CHAIN_<TARGET_CHAIN_ID>_*_ADDRESS` values in `app/ethereum/.env`. Keep
`DEPLOY_ENV` and `NETWORK` exported for both deployment commands.

Run the read-only preflight:

```bash
npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR"
```

For production:

```bash
export CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$TARGET_CHAIN_ID"
```

Deploy:

```bash
npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR" --execute
```

Remove the deployment key:

```bash
unset PRIVATE_KEY
```

Remove `PRIVATE_KEY` from `app/ethereum/.env`.

Review `$ROLLOUT_DIR/external-deployment.json`.

Require:

- Network equals `TARGET_NETWORK`.
- Chain ID equals `TARGET_CHAIN_ID`.
- Safe address matches `SAFE_ADDRESS`.
- Every vault role matches `SAFE_ADDRESS`.
- Vault proxy, vault implementation, router proxy, and router implementation
  are nonzero and distinct where required.
- DepositRouter points to the deployed vault proxy.
- Deployment blocks are present.
- Every boolean vault-role verification field is `true`.
- DepositRouter version is `1.0.0`.

Read `version()` from the vault proxy and require `1.0.0`.

Verify implementations:

```bash
npm run network:verify -- <VAULT_IMPLEMENTATION>
npm run network:verify -- <DEPOSIT_ROUTER_IMPLEMENTATION>
```

Treat successful explorer verification as sufficient when optional Sourcify
verification fails independently.

## 8. Discover and select routes

Use discovery when migrating or extending existing bridge mappings.

Set the existing source-chain ID:

```bash
export LEGACY_SOURCE_CHAIN_ID=<EXISTING_EXTERNAL_CHAIN_ID>
export DISCOVERY_DIR="$ROLLOUT_DIR/discovery-v1"
test ! -e "$DISCOVERY_DIR"
export "CHAIN_${LEGACY_SOURCE_CHAIN_ID}_RPC_URL=https://<EXISTING_EXTERNAL_CHAIN_RPC>"
```

Generate candidates:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run bridge:prepare -- --discover --node-url "$STRATO_NODE_URL" --chain-id "$TARGET_CHAIN_ID" --source-chain-id "$LEGACY_SOURCE_CHAIN_ID" --output-dir "$DISCOVERY_DIR"
```

Review:

```text
$DISCOVERY_DIR/discovery.json
$DISCOVERY_DIR/prepare.json
```

In `prepare.json`:

- Set `include=true` only for approved routes.
- Set `target.externalDeployment=../external-deployment.json`.
- Resolve any explicitly reported contract selection.
- Confirm every external-token/STRATO-token mapping.
- Keep unapproved native routes excluded.

Generate the route inventory, settings, and policy:

```bash
export PREPARED_DIR="$ROLLOUT_DIR/prepared-v1"
test ! -e "$PREPARED_DIR"
npm run bridge:prepare -- --config "$DISCOVERY_DIR/prepare.json" --output-dir "$PREPARED_DIR"
```

Use:

```text
$PREPARED_DIR/deposit-plan.json
$PREPARED_DIR/settings.json
$PREPARED_DIR/policy.json
```

Require:

- Chain ID equals `TARGET_CHAIN_ID`.
- DepositRouter and deployment block match `external-deployment.json`.
- External token metadata matches the deployed token.
- STRATO token status is ACTIVE (`2`).
- No duplicate token pair exists.
- Only approved routes are present.

For a route with no discoverable source mapping, create
`$ROLLOUT_DIR/deposit-plan.json` with the same schema as the discovered
`deposit-plan.json`. Add only approved routes. Verify each external token
address, STRATO token address, decimals, name, symbol, and ACTIVE status.

## 9. Create and complete the rollout manifest

Initialize from discovered files:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- init --settings "$PREPARED_DIR/settings.json" --policy "$PREPARED_DIR/policy.json" --manifest "$ROLLOUT_DIR/deployment-manifest.json"
```

For a fully fresh rollout with no discoverable settings, create the draft
instead:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- init --manifest "$ROLLOUT_DIR/deployment-manifest.json"
```

Fill the draft settings:

```text
sourceChainId=<STRATO network ID as a decimal string>
externalDeployment=./external-deployment.json
depositPlan=./deposit-plan.json
tokenRouter=
externalAssetBridge=
bridgeOperator=
guardian=
settlementVerifiers=
dependencies.adminRegistry=
dependencies.poolFactory=
dependencies.poolV3Factory=
dependencies.directMintPsm=
dependencies.metalForge=
dependencies.saveUsdstVault=
dependencies.yieldVaults=
dependencies.tokenFactory=
dependencies.usdst=
dependencies.priceOracle=
```

Copy the reviewed manual deposit plan to
`$ROLLOUT_DIR/deposit-plan.json` before expanding the draft.

For production, resize `settlementVerifiers` to five entries. For testnet,
keep three entries. Put the STRATO attestor addresses returned by the
verifier base stacks in verifier-number order.

Expand only the fully fresh draft:

```bash
npm run external:rollout -- init --manifest "$ROLLOUT_DIR/deployment-manifest.json"
```

Do not run `init` again after `schemaVersion: 1` appears.

Fill every `REVIEW_REQUIRED` value except
`services.safeProposerAddress` and `services.executorAddress`.

Set the values known before workload deployment:

```text
services.nodeUrl=<HTTPS STRATO node>
services.rpcUrlEnv=CHAIN_<TARGET_CHAIN_ID>_RPC_URL
services.sourceTokenEnv=ACCESS_TOKEN
services.confirmations=<Runtime confirmations>
services.bridgeHealthUrlEnv=BRIDGE_HEALTH_URL
```

Leave top-level `authorizationSigners` and `services.verifiers` empty. Leave
`services.safeProposerAddress` and `services.executorAddress` as
`REVIEW_REQUIRED` until the stopped workloads return those values.

Set the final reviewed policy:

- Deposit permission per route.
- `withdrawalsEnabled=false` for every route in an initial rollout.
- Rebase requirement per route.
- Automatic-route permission per route.
- Minimum deposit.
- Maximum automatic deposit.
- Maximum per withdrawal.
- Maximum automatic withdrawal.
- Manual-review threshold.
- Withdrawal bucket capacity and refill rate.
- Mint capacity and refill rate.
- `migrateAmount="0"` unless migration has separate approval.
- `lastProcessedBlock` equal to the DepositRouter deployment block.

Require before generating the Infra package:

- Runtime confirmations are positive.
- Testnet uses the network-derived verifier count and threshold.
- Production uses the network-derived verifier count and threshold.
- Operator is not an attestor.

## 10. Generate the Infra package and obtain workload identities

Generate the pre-Infra artifacts:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- plan --manifest "$ROLLOUT_DIR/deployment-manifest.json" --output-dir "$ROLLOUT_DIR/generated-preinfra-v1" --stage activation
```

Required status:

```text
OFFLINE_PLAN_INCOMPLETE
```

Require that the only unresolved fields are workload identities, URLs,
token-environment names, and the proposer/executor addresses. Stop for any
unresolved route, limit, dependency, contract, attestor, threshold, or
confirmation value.

Record the exact printed paths for:

```text
bridgeConfigPath=
bridge.env.template=
verifier-1.json ... verifier-<VERIFIER_COUNT>.json
verifier-1.env.template ... verifier-<VERIFIER_COUNT>.env.template
```

Review every verifier policy:

- STRATO and external chain IDs.
- EAB proxy, vault proxy, and starting block.
- Verifier index and matching STRATO attestor.
- Route token pairs.
- Deposit, withdrawal, rebase, and automatic-route permissions.
- Every raw limit.
- Identical baseline policy hash.
- No credential, RPC URL, API token, KMS ARN, or private key.

Initialize TokenRouter and EAB, including the reviewed settlement attestors.
Give every administrator the printed pre-Infra `bridge-config.json` and its
SHA-256. Each administrator verifies the checksum and runs the same command
with their own `app/contracts/.env`:

```bash
cd "$REPO_ROOT/app/contracts"
npm run configure:external-bridge -- --config <LOCAL_REVIEWED_BRIDGE_CONFIG_PATH> --step initialize --execute
```

After the governance threshold executes:

```bash
npm run configure:external-bridge -- --config <LOCAL_REVIEWED_BRIDGE_CONFIG_PATH> --step verify-initialize
```

Require successful initialization verification before verifier-stack
deployment.

Give each verifier operator:

- Its `verifier-<N>.json`, renamed
  `external-bridge-verifier-policy-<TARGET_CHAIN_ID>-<N>.json`.
- The file's SHA-256.
- `INFRA_NETWORK`, external chain ID, verifier confirmation count, verifier
  image digest, and `Running=No`.
- Its generated `verifier-<N>.env.template`.

Use the `INFRA_NETWORK` slug required by `eab-infra`, such as
`base-sepolia`; do not substitute the Hardhat name such as `baseSepolia`.

Each verifier operator:

1. Checks both independent RPCs with `guides/tools/rpc-probe.sh`.
2. Deploys the network verifier stack with `Running=No`.
3. Returns the complete `ValuesForCoordinator` line.
4. Sends the generated API token once through the secure runtime channel.

Give the Runtime operator:

- `RELEASE_COMMIT`.
- Bridge and nginx image digests.
- The generated `bridge.env.template`.
- Runtime account image-access confirmation.

For a fresh Runtime:

1. Deploy the Runtime stack with `ProposerKeyArn` empty.
2. Deploy the separate proposer account base stack with `CreateNetwork=No`.
3. Deploy the proposer stack using the Runtime `InstanceRoleArn`.
4. Set the returned `ProposerKeyArn` in the Runtime configuration and redeploy.

For an existing multi-network Runtime, preserve the persistent volume,
existing executor keys, proposer key, and every existing network row. Add the
new network without adding a native cursor when no native bridge is enabled.

Infra returns:

```text
VERIFIER_<N>_AUTHORIZATION_SIGNER_ADDRESS=
VERIFIER_<N>_NATIVE_SIGNER_ADDRESS=
VERIFIER_<N>_BASE_URL=
SAFE_PROPOSER_ADDRESS=
EXTERNAL_EXECUTOR_ADDRESS=
RUNTIME_URL=
```

Require:

- Exactly `VERIFIER_COUNT` complete verifier outputs.
- Stack parameters match chain, verifier number, confirmations, image digest,
  policy hash, and `Running=No`.
- Attestors match the manifest order.
- Authorization signers, native signers, URLs, and approved RPC hosts are
  unique.
- Proposer, executor, and authorization signers are distinct.
- Safe owners do not include proposer or executor.
- Verifier authorization signers are excluded from Safe ownership under the
  reviewed ownership policy.

Fill the completed manifest:

```text
authorizationSigners=<top-level array in verifier-number order>
services.verifiers=<URL/tokenEnv/confirmation entries in verifier-number order>
services.safeProposerAddress=<Safe proposer address>
services.executorAddress=<external executor address>
```

Set each verifier `tokenEnv` to an environment-variable name, not a token.
Require each verifier confirmation count to be at least the Runtime
confirmation count.

Run the consolidated preparation:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment-manifest.json"
```

Required status:

```text
PREPARED_FOR_REVIEW
```

Require every mechanical check to pass. Compare each final verifier policy
byte-for-byte with its pre-Infra policy.

Review the printed policy summary:

- STRATO and external chain IDs and starting block.
- TokenRouter, EAB, Safe, vault, and DepositRouter.
- Operator, guardian, attestors, authorization signers, proposer, and executor.
- Signer and attestor thresholds.
- Route token pairs, permissions, and every raw limit.
- Runtime and verifier confirmations.
- Verifier policy hashes.

Send administrators only:

- `deployment-bundle.json`.
- Printed bundle SHA-256.

Do not send:

- Editable manifest.
- `generated/`.
- `.env` files.
- Vote journals.
- Private keys.
- OAuth secrets.
- RPC credentials.
- Verifier tokens.
- KMS ARNs.

## 11. Administrators join

Each administrator verifies the received checksum:

```bash
shasum -a 256 ./deployment-bundle.json
```

Admin 1:

```bash
cd <STRATO_PLATFORM_REPOSITORY>/app/ethereum
npm run external:rollout -- join --role admin-1 --bundle ./deployment-bundle.json
```

Admin 2:

```bash
cd <STRATO_PLATFORM_REPOSITORY>/app/ethereum
npm run external:rollout -- join --role admin-2 --bundle ./deployment-bundle.json
```

Additional administrators join with `--role admin-2` using separate local
directories.

Each administrator:

- Runs `npm install` in `app/ethereum`.
- Uses their own `app/contracts/.env`.
- Sets `CHAIN_<TARGET_CHAIN_ID>_RPC_URL` in `app/ethereum/.env`.
- Does not set or receive `PRIVATE_KEY`.
- Runs the printed `export EAB_ROLLOUT_CONFIG=...` command.

The coordinator runs the export command printed by `prepare`.

Wait until Admin 1 and every required additional administrator have joined
before the coordinator runs `status`.

## 12. Configure the external contracts while paused

Coordinator:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- status
```

For `EXECUTE_SAFE_TRANSACTION`:

1. Import only the printed Safe JSON.
2. Verify Safe chain ID and Safe address.
3. Verify transaction targets.
4. Verify decoded methods and arguments.
5. Collect the required Safe signatures.
6. Execute.
7. Rerun `status`.

Execute pending Safe items only in printed order:

```text
router-pause.json
vault-pause.json
router-tokens-<N>.json
vault-configure.json
```

Require:

- DepositRouter paused.
- Vault paused.
- DepositRouter token mappings match the inventory.
- Vault token policies match the reviewed limits.
- Vault authorization signers and threshold match the manifest.

## 13. Configure STRATO through governance

Continue running:

```bash
npm run external:rollout -- status
```

For `ADMIN_1_VOTE`:

1. Send the exact printed command to Admin 1.
2. Admin 1 runs it unchanged.
3. Coordinator reruns `status`.

For `ADMIN_2_VOTE` or `ADDITIONAL_ADMIN_VOTE`:

1. Send the new exact printed command to a distinct administrator.
2. That administrator runs it unchanged.
3. Coordinator reruns `status`.

For `WAITING_FOR_EXECUTION`:

1. Do not vote again.
2. Wait for execution and indexing.
3. Rerun `status`.

Continue until all pre-activation governance stages are complete.

Require:

- TokenRouter initialized with reviewed dependencies.
- Approved yield vaults configured.
- EAB initialized with TokenFactory, USDST, PriceOracle, TokenRouter, operator,
  guardian, attestors, and threshold.
- Mint policies configured.
- External chain configured with vault, DepositRouter, and starting block.
- Routes configured.
- Rebase settings configured.
- Automatic-route settings configured.
- External vault and DepositRouter remain paused.

## 14. Fund operational identities

Verify existing STRATO funding:

- Every verifier STRATO attestor.

Fund on STRATO:

- Runtime operator.
- Runtime relayer.

Fund on the external chain:

- External executor.
- Safe execution wallet.
- Canary wallet.

Verify indexed balances.

Record:

```text
ACCOUNT=
ADDRESS=
ASSET=
BALANCE=
FUNDING_TRANSACTION=
REFILL_THRESHOLD=
REFILL_OWNER=
```

Do not treat service health as proof of funding.

## 15. Start verifiers

Change only `Running=Yes` in one verifier configuration at a time:

```bash
cd <EAB_INFRA_REPOSITORY>
guides/tools/deploy.sh deployments/<ENV>/verifier-<N>/<NETWORK>.conf --preview
guides/tools/deploy.sh deployments/<ENV>/verifier-<N>/<NETWORK>.conf
```

Require each verifier to become healthy before starting the next.

Verify each `/health` response:

- Correct external chain ID.
- Correct vault.
- Correct verifier index.
- Correct authorization signer.
- Correct STRATO attestor.
- Correct policy digest.
- Shared baseline policy hash.
- Correct confirmation count.
- At least two verification RPC hosts.
- `status="ok"`.

## 16. Complete and start the Runtime

For a fresh Runtime:

- Use the final generated `bridge.env.template`.
- Configure persistent `/app/data`.

For an existing multi-network Runtime:

- Preserve all current template entries.
- Add only the new chain's generated `CHAIN_<ID>_*` bindings.
- Preserve every existing network.
- Preserve the existing data volume.
- Do not add a native cursor for an EAB-only chain.

Set the Runtime stack configuration:

```text
ReleaseCommit=<RELEASE_COMMIT>
BridgeImageDigest=<BRIDGE_IMAGE_DIGEST>
NginxImageDigest=<BRIDGE_NGINX_IMAGE_DIGEST>
EnvTemplateFile=<final bridge.env.template filename>
ProposerKeyArn=<separate proposer stack key ARN>
```

Set all referenced Runtime secret rows:

```text
NODE_URL
EXTERNAL_ASSET_BRIDGE_ADDRESS
TOKEN_ROUTER
USDST_ADDRESS
PRICE_ORACLE_ADDRESS
SAFE_ADDRESS
SAFE_PROPOSER_ADDRESS
CHAIN_<ID>_RPC_URL
CHAIN_<ID>_WS_RPC_URL
CHAIN_<ID>_VERIFICATION_RPC_URLS
CHAIN_<ID>_DEPOSIT_CONFIRMATIONS
CHAIN_<ID>_EXTERNAL_BRIDGE_VERIFIER_URLS
CHAIN_<ID>_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS
CHAIN_<ID>_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS
RELAYER_BA_USERNAME
RELAYER_BA_PASSWORD
RELAYER_CLIENT_ID
RELAYER_CLIENT_SECRET
RELAYER_OPENID_DISCOVERY_URL
SAFE_API_KEY
BRIDGE_ADDRESS
STRATO_APP_API_URL
```

Before startup:

- Record the service responsible for EAB deposits, EAB withdrawals, legacy
  bridge processing, and native bridge processing.
- Require exactly one active processor for each flow.
- Keep the new Runtime's native configuration absent when the legacy service
  remains the native processor.
- Stop any old EAB proposal writer before enabling the new EAB writer.
- Inventory every service that writes proposals to the shared Safe.
- Reconcile pending Safe transactions and the current Safe nonce.
- Assign one proposal writer per bridge flow and record the handoff.
- Register proposer as a Safe delegate, not an owner.
- Record the native-processor handoff as `NOT_APPLICABLE` for EAB-only or
  name the retained native processor.

Preview and deploy:

```bash
cd <EAB_INFRA_REPOSITORY>
guides/tools/deploy.sh deployments/<ENV>/runtime/runtime.conf --preview
guides/tools/deploy.sh deployments/<ENV>/runtime/runtime.conf
```

Increase `RestartRevision` exactly once for the reviewed configuration change.

Remove plaintext secret rows after the secret-manager update.

Require:

- Runtime target healthy.
- Runtime `LastStart` reports `started ..., ready`.
- `/health` returns `status=true` and `ready=true`.
- Configuration validation completed successfully.
- No new error flag was created.

Coordinator exports:

```bash
export BRIDGE_HEALTH_URL=https://<RUNTIME_HOST>/health
```

## 17. Deploy backend and UI

Verify through Cirrus:

- TokenRouter proxy is initialized.
- EAB proxy is initialized.
- EAB `tokenRouter` equals the reviewed TokenRouter proxy.

Set the selected STRATO network's backend defaults:

```text
defaultExternalAssetBridgeFor["<STRATO_NETWORK_ID_DECIMAL>"]="<lowercase EAB proxy without 0x>"
defaultTokenRouterFor["<STRATO_NETWORK_ID_DECIMAL>"]="<lowercase TokenRouter proxy without 0x>"
defaultBridgeServiceFor["<STRATO_NETWORK_ID_DECIMAL>"]="<Runtime URL>"
```

Optional address overrides are `EXTERNAL_ASSET_BRIDGE_ADDRESS` and
`TOKEN_ROUTER`.

Build and deploy backend and UI from `RELEASE_COMMIT`.

Pass optional runtime overrides into the actual backend container, not only a
Compose `.env` file.

Require:

- `/api/config` returns HTTP 200.
- Target network reports the reviewed EAB and TokenRouter proxies.
- Only reviewed token routes are presented.
- Quotes use the new DepositRouter.
- Native routes remain unchanged unless separately approved.

Keep public intake closed until activation and canary approval.

## 18. Run readiness

Coordinator:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- verify
```

Require exit code zero and status `READY_FOR_ACTIVATION_REVIEW`.

Require every reported live check to pass. Successful external RPC
reconciliation reports detailed external checks; the aggregate `external`
check appears only when that RPC reconciliation fails. Stop on any failed,
deferred, or pending check.

## 19. Activate

Request a fresh activation action:

```bash
npm run external:rollout -- status
```

Run the exact full command printed by `status`:

```text
npm run external:rollout -- activate --approve <CURRENT_HASH>
```

Safe owners:

1. Review the generated activation JSON.
2. Verify vault unpause is included only when withdrawals are approved.
3. Verify DepositRouter unpause is included.
4. Sign.
5. Execute.

Verify:

```bash
npm run external:rollout -- verify
```

Required status:

```text
DEPOSITS_ACTIVE_CANARY_REQUIRED
```

## 20. Run canaries

Use small approved amounts.

For every test, record:

- External transaction hash.
- STRATO transaction hash.
- Deposit or withdrawal identity.
- User balance before and after.
- Vault custody before and after.
- STRATO token supply before and after.
- Safe balance before and after where applicable.
- Relevant events.
- Retry result.

Run:

1. Plain ERC-20 deposit.
2. Native-gas EAB deposit when configured.
3. Automatic-route success when configured.
4. Automatic-route fallback when configured.
5. Withdrawal when configured.
6. Manual-review deposit.
7. Rejection and refund.
8. Retry of completed deposit.
9. Retry of completed withdrawal.

Require:

- Exactly one custody increase per deposit.
- Exactly one STRATO mint or routed output per deposit.
- Exactly one external release per withdrawal.
- Exactly one STRATO burn per completed withdrawal.
- No duplicate effect on retries.
- Review and refund preserve user value.
- Automatic-route outcome matches the emitted success or fallback event.

Stop intake on any mismatch.

## 21. Complete or roll back

Complete only after:

- All canaries pass.
- No unresolved Safe transaction remains.
- No unresolved AdminRegistry issue remains.
- Operator, relayer, attestors, executor, and Safe execution wallets remain
  funded.
- Runtime and verifier alarms are clear.
- Backend and UI expose only approved routes.
- Deployment evidence is stored.

To stop new intake:

1. Pause DepositRouter through the Safe.
2. Pause the vault when withdrawals must stop.
3. Disable reviewed STRATO route permissions through AdminRegistry governance.
4. Keep Runtime and verifiers available for in-flight recovery.
5. Reconcile all pending deposits, withdrawals, reviews, and refunds.

Do not:

- Delete durable Runtime data.
- Reset polling cursors.
- Withdraw custody before reconciliation.
- Reuse the EAB bundle to approve native changes.
- Roll back to an image that cannot process already accepted events.

For legacy cutover and custody migration, continue with `EAB_CUTOVER.md`.

For optional STRATO-native routing, continue with
`NATIVE_BRIDGE_DEPLOYMENT.md`.
