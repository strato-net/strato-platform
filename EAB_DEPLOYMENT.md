# EAB and Native Bridge Deployment

Default scope: EAB + native. Follow every **EAB-only** instruction when native is excluded. Use section 8 to add native later.

Roles:

- **Coordinator:** deploys external contracts, owns `deployment.json` and `.deployment/`, and runs `prepare`/`continue`.
- **STRATO admins:** deploy or upgrade STRATO contracts and run generated approval files.
- **Safe owners:** execute generated Safe Transaction Builder files.
- **Infra:** provisions identities and deploys Runtime and verifiers.

Keep credentials local to each role. Admins receive only the current approval JSON and short command. Infra receives only the service archive and checksum.

## 1. Set up

Coordinator:

```bash
export REPO_ROOT=<ABSOLUTE_STRATO_PLATFORM_REPOSITORY>
export DEPLOY_ENV=<testnet-or-prod>
export NETWORK=<ethereum-or-base-or-linea-or-robinhood-or-hyperevm>
export STRATO_NODE_URL=https://<STRATO_HOST>
export ROLLOUT_DIR=<ABSOLUTE_NEW_ROLLOUT_DIRECTORY>
cd "$REPO_ROOT"
test -z "$(git status --porcelain)"
mkdir -p "$ROLLOUT_DIR/.deployment"
chmod 700 "$ROLLOUT_DIR" "$ROLLOUT_DIR/.deployment"
eval "$(cd "$REPO_ROOT/app/ethereum" && npm run --silent network:environment)"
```

Verify the selected network before continuing:

```bash
printf '%s\n' \
  "TARGET_NETWORK=$TARGET_NETWORK" \
  "TARGET_CHAIN_ID=$TARGET_CHAIN_ID" \
  "TARGET_RPC_ENV=$TARGET_RPC_ENV" \
  "VERIFIER_COUNT=$VERIFIER_COUNT" \
  "VERIFIER_THRESHOLD=$VERIFIER_THRESHOLD"
```

Confirm that the network, chain ID and RPC variable name match the intended target. Testnet must show `VERIFIER_COUNT=3` and `VERIFIER_THRESHOLD=2`; production must show `VERIFIER_COUNT=5` and `VERIFIER_THRESHOLD=3`. `TARGET_RPC_ENV` is the variable name to populate in `app/ethereum/.env`, not the RPC URL itself.

STRATO admins keep their STRATO credentials in `app/contracts/.env`.

Coordinator keeps rollout OAuth and RPC credentials in `$ROLLOUT_DIR/deployment.env`:

```dotenv
OAUTH_URL=<STRATO_OPENID_DISCOVERY_URL>
OAUTH_CLIENT_ID=<STRATO_CLIENT_ID>
OAUTH_CLIENT_SECRET=<STRATO_CLIENT_SECRET>
GLOBAL_ADMIN_NAME=<COORDINATOR_STRATO_USER>
GLOBAL_ADMIN_PASSWORD=<COORDINATOR_STRATO_PASSWORD>
# OAUTH_TOTP=<CURRENT_TOTP_IF_REQUIRED>
CHAIN_<TARGET_CHAIN_ID>_RPC_URL=<TARGET_HTTPS_RPC>
```

These are the Coordinator's own STRATO credentials. Do not copy a STRATO approval admin's credentials into this file. An existing `ACCESS_TOKEN` may be supplied instead of `GLOBAL_ADMIN_NAME` and `GLOBAL_ADMIN_PASSWORD`, but it can expire during the rollout.

Coordinator configures the temporary external deployer and selected Hardhat RPC in `app/ethereum/.env`:

```dotenv
PRIVATE_KEY=<TEMPORARY_EXTERNAL_DEPLOYER_KEY>
<TARGET_RPC_ENV>=<TARGET_HTTPS_RPC>
```

Safe owners provide `SAFE_OWNER_PRIVATE_KEY` only while signing. The funded Safe executor provides `SAFE_TX_EXECUTOR_PRIVATE_KEY` only while executing. Infra stores Runtime, verifier, KMS and API secrets in the deployment platform. Never copy credentials between roles.

Install and compile:

```bash
cd "$REPO_ROOT/app/contracts" && npm ci
cd "$REPO_ROOT/app/ethereum" && npm ci && npm run compile
```

Set governance values:

```bash
export SAFE_ADDRESS=<0x_SAFE_ADDRESS>
export ADMIN_REGISTRY=<STRATO_ADMIN_REGISTRY_WITHOUT_0X>
export DEPLOYMENT_CONFIRMATIONS=<POSITIVE_INTEGER>
```

Infra provisions:

- one Runtime for a new environment, or a staged update for the existing shared Runtime;
- the network-required verifier count;
- independent verifier RPC providers;
- STRATO attestor identities;
- Safe proposer and EAB executor;
- DNS, KMS keys, API tokens and durable storage;
- native signer/executor identities unless **EAB-only**.

Return only public addresses and endpoints. Run the infrastructure deployment for every new verifier with `Running=No`. This creates its stack, KMS identity, endpoint and ECS service, but starts no verifier task. For a new environment, create Runtime without starting it. When adding a chain to an existing environment, keep the shared Runtime running its current configuration; do not install the new chain binding yet.

### 1.1 Safe and gas readiness

Before deployment:

1. Verify the Safe is deployed on `TARGET_CHAIN_ID` with the approved owners and threshold.
2. Fund every external-chain transaction sender with the chain's native gas token. This includes the EAB executor and the account that will execute generated Safe transactions.
3. Record each funded address and verify its balance through the selected RPC.
4. Select one Safe submission mode:
   - Hosted Safe Transaction Service: a Safe owner registers `services.safeProposerAddress` as a delegate of `SAFE_ADDRESS` and verifies the delegate through that service.
   - Direct script: skip proposer delegation; Safe owners sign and the funded executor submits through `safe:batch`.
5. Compare the legacy bridge Safe with `SAFE_ADDRESS`:
   - Different Safes: record both addresses and proposal writers.
   - Same Safe: designate one proposal writer and drain or reconcile every pending legacy and EAB proposal before switching writers. Do not run competing proposal writers against the same Safe nonce; use separate Safes if both writers must operate concurrently.

Do not continue until funding, submission mode and shared-Safe ownership are recorded in the rollout review.

## 2. Deploy STRATO contracts

### 2.1 TokenRouter and ExternalAssetBridge

Admin 1 deploys each fresh proxy. Other required admins vote on the printed creation issue.

```bash
cd "$REPO_ROOT/app/contracts"
npm run deployProxy -- --empty --owner "$ADMIN_REGISTRY" --contract-file BaseCodeCollection.sol
```

Upgrade the returned TokenRouter proxy:

```bash
npm run upgrade -- --proxy-address <TOKEN_ROUTER_PROXY> --contract-name TokenRouter --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

Deploy the second proxy:

```bash
npm run deployProxy -- --empty --owner "$ADMIN_REGISTRY" --contract-file BaseCodeCollection.sol
```

Upgrade the returned ExternalAssetBridge proxy:

```bash
npm run upgrade -- --proxy-address <EAB_PROXY> --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

For each upgrade, required admins vote on the implementation-creation and `setLogicContract` issues. Do not rerun deployment commands merely to vote.

### 2.2 Native STRATO contracts

**EAB-only: skip this subsection.**

Reuse existing `StratoNativeBridge` and `StratoNativeCustodyVault` proxies when present. Never initialize an existing proxy.

For fresh proxies, run the proxy command once for each contract:

```bash
cd "$REPO_ROOT/app/contracts"
npm run deployProxy -- --empty --owner "$ADMIN_REGISTRY" --contract-file BaseCodeCollection.sol
```

Upgrade the bridge:

```bash
npm run upgrade -- --proxy-address <STRATO_NATIVE_BRIDGE_PROXY> --contract-name StratoNativeBridge --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' +OVERRIDE-CHECKS
```

Upgrade the custody vault:

```bash
npm run upgrade -- --proxy-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> --contract-name StratoNativeCustodyVault --contract-file BaseCodeCollection.sol --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' +OVERRIDE-CHECKS
```

Initialize fresh proxies only:

```bash
npm run initialize:native-bridge -- --bridge-address <STRATO_NATIVE_BRIDGE_PROXY> --vault-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> --token-factory <TOKEN_FACTORY> --bridge-operator <BRIDGE_OPERATOR> --guardian <GUARDIAN>
```

Verify proxy implementations, AdminRegistry ownership, TokenFactory, custody binding, operator and guardian.

## 3. Deploy external contracts

### 3.1 Native destination contracts

**EAB-only: skip this subsection.**

Deploy one destination bridge:

```bash
cd "$REPO_ROOT/app/ethereum"
CONTRACT_NAME=StratoNativeRepresentationBridge INIT_PARAMS='["<0x_NATIVE_SAFE_ADDRESS>"]' npx hardhat run scripts/deployWithProxy.js --network "$TARGET_NETWORK"
```

Deploy one representation token per selected native token:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken INIT_PARAMS='["<REPRESENTATION_NAME>","<REPRESENTATION_SYMBOL>","<0x_NATIVE_SAFE_ADDRESS>"]' npx hardhat run scripts/deployWithProxy.js --network "$TARGET_NETWORK"
```

For an existing proxy requiring upgrade, deploy its implementation:

```bash
CONTRACT_NAME=StratoNativeRepresentationBridge npx hardhat run scripts/deployImplementationOnly.js --network "$TARGET_NETWORK"
CONTRACT_NAME=StratoNativeRepresentationToken npx hardhat run scripts/deployImplementationOnly.js --network "$TARGET_NETWORK"
```

Safe owners execute `upgradeToAndCall(<MATCHING_IMPLEMENTATION>, 0x)`. Verify implementation, ownership, mappings and balances.

### 3.2 EAB vault and router

Set all external governance roles to the reviewed Safe:

```bash
export "CHAIN_${TARGET_CHAIN_ID}_DEPLOYMENT_CONFIRMATIONS=$DEPLOYMENT_CONFIRMATIONS"
export "CHAIN_${TARGET_CHAIN_ID}_SAFE_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_DEFAULT_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_UPGRADER_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_POLICY_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_GUARDIAN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_UNPAUSER_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_VAULT_ATTESTATION_ADMIN_ADDRESS=$SAFE_ADDRESS"
export "CHAIN_${TARGET_CHAIN_ID}_LARGE_WITHDRAWAL_APPROVER_ADDRESS=$SAFE_ADDRESS"
```

Run preflight:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR/.deployment/external"
```

Production only:

```bash
export CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$TARGET_CHAIN_ID"
```

Deploy:

```bash
npm run network:deploy-external -- --rollout-dir "$ROLLOUT_DIR/.deployment/external" --execute
```

Verify chain ID, Safe, proxies, implementations, deployment block and receipts. Then remove the deployer key:

```bash
unset PRIVATE_KEY
```

## 4. Create and review the deployment

Run discovery:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- init --node-url "$STRATO_NODE_URL" --chain-id "$TARGET_CHAIN_ID" --source-chain-id <EXISTING_EXTERNAL_CHAIN_ID> --manifest "$ROLLOUT_DIR/deployment.json"
```

`--chain-id` is the destination being deployed. `--source-chain-id` is an existing configured external chain whose routes seed the new manifest; every imported address, token and limit remains subject to review.

Edit only `deployment.json`:

- set the reviewed TokenRouter, EAB, dependencies, operator and guardian;
- set `include=true` only for approved EAB routes;
- review token decimals, starting block, mint buckets and all raw limits;
- set per-chain Runtime and verifier confirmation floors;
- keep migration amounts zero;
- keep withdrawals disabled initially;
- set verifier endpoints, attestors, proposer and executor;
- add native bridge, Safe, token, signer and executor inputs unless **EAB-only**;
- **EAB-only:** set every native route to `include=false` and omit native configuration.

Use [EAB Production Configuration Guidelines](EAB_PRODUCTION_CONFIG_GUIDELINES.md) to review finality, automatic deposit exposure, mint refill exposure, withdrawal limits, quorum, RPC independence, authorization validity and Safe ownership.

Run:

```bash
npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment.json"
```

Handle the result:

- `MANIFEST_CREATED`: finish reviewing `deployment.json`, then rerun `prepare`.
- `PROVISIONING_PACKAGE_READY`: send Infra the archive and SHA-256; enter returned public identities/endpoints in `deployment.json`; rerun `prepare`.
- `OFFLINE_PLAN_INCOMPLETE`: fix the named values; rerun `prepare`.
- `PREPARED_FOR_REVIEW`: review `details`; send Infra the final archive/checksum; proceed.

Infra verifies `services.json`:

- `chain-install`: deploy the new verifier infrastructure with `Running=No`; no verifier task runs in this state. Do not install the new chain binding into Runtime yet. Preserve all existing Runtime bindings, journals, cursors and durable volumes.
- `native-extension`: follow section 8; preserve EAB settings, journals, cursors and active workloads.

## 5. Configure

Coordinator runs:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- continue --manifest "$ROLLOUT_DIR/deployment.json"
```

Execute only the returned action:

- Admin action: send the exact `file` under its existing basename and the short `run` command to each required admin.
- Safe action: use the generated file with the Safe owner flow below.
- Infra action: apply or repair the named service configuration.
- Failed check: fix it and rerun `continue`.

`START_OR_REPAIR_SERVICES` is the service-start boundary. Before that action, new verifiers remain `Running=No`, a new Runtime remains stopped, and an existing shared Runtime remains on its previous configuration. When it appears, follow section 6.

For an admin action, each admin:

1. Places the received JSON in `app/ethereum` under its original basename.
2. Uses their own STRATO credentials.
3. Runs the printed `approve --file` command.
4. Reviews every decoded target, method, argument and vote count.
5. Types `APPROVE <approvalId>`.

The default combined rollout produces one EAB+native STRATO configuration file per admin. Safe transactions remain separate. Coordinator reruns `continue` after each external action.

If a batch is interrupted, stop. Coordinator reruns `continue`; live governance evidence excludes completed calls and generates a reduced replacement file.

For each Safe action, `continue` prints bound `commands.inspect`, `commands.sign` and `commands.execute` values.

1. Coordinator runs `commands.inspect` and records the displayed `safeTxHash` as `REVIEWED_SAFE_TX_HASH`.
2. Each required owner independently reviews the same chain, Safe, calls, nonce and hash, then runs `commands.sign` with a unique `OWNER_SIGNATURE_FILE`:

```bash
read -rsp "Safe owner private key: " SAFE_OWNER_PRIVATE_KEY; export SAFE_OWNER_PRIVATE_KEY; echo
export OWNER_SIGNATURE_FILE=<ABSOLUTE_OWNER_SIGNATURE_FILE>
<RUN commands.sign EXACTLY>
unset SAFE_OWNER_PRIVATE_KEY
```

3. A funded external-chain account collects the threshold, adds one `--signature` argument per owner file to `commands.execute`, and runs it:

```bash
read -rsp "Safe executor private key: " SAFE_TX_EXECUTOR_PRIVATE_KEY; export SAFE_TX_EXECUTOR_PRIVATE_KEY; echo
export REVIEWED_SAFE_TX_HASH=<HASH_FROM_INSPECT>
<RUN commands.execute WITH EVERY OWNER SIGNATURE FILE>
unset SAFE_TX_EXECUTOR_PRIVATE_KEY
```

The executor checks its gas balance, simulates the transaction, and requires the Safe `ExecutionSuccess` event. The first generated Safe action is the live direct-execution canary; stop if it fails. This direct flow does not require a hosted Safe Transaction Service. If execution is interrupted or the Safe nonce changes, do not reuse or resubmit the signatures; the Coordinator reruns `continue`, reconciles live state and supplies the current Safe file.

## 6. Start verifiers, then Runtime

Start or update services only after:

- `continue` returns `START_OR_REPAIR_SERVICES`;
- every preceding STRATO admin and Safe action is complete;
- new external contracts remain paused and the new chain remains disabled.

If replacing an existing bridge processor:

- close and drain old intake;
- reconcile pending deposits, withdrawals, refunds and Safe proposals;
- stop the old native processor when native is selected;
- preserve journals, cursors and durable volumes;
- keep one proposal writer per shared Safe.

For an existing fleet adopting finalized-head enforcement:

1. Stop old Runtime settlement submitters and verifier endpoints.
2. While settlement remains stopped, make a real signer membership or threshold change on each affected source bridge and external vault; an unchanged setter does not rotate the version.
3. Restore the intended signer set and threshold.
4. Verify every resulting on-chain version before starting the updated services or re-attesting pending work.

### 6.1 Start verifiers

To start each new verifier, change its configuration from `Running=No` to `Running=Yes`, preview the change and deploy it:

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY>
guides/tools/deploy.sh "deployments/$INFRA_ENV/verifier-$VERIFIER_NUMBER/$INFRA_NETWORK.conf" --preview
guides/tools/deploy.sh "deployments/$INFRA_ENV/verifier-$VERIFIER_NUMBER/$INFRA_NETWORK.conf"
```

The verifiers may be started in parallel. Verify the required count is healthy with the reviewed signer, policy hash, destination, RPC-host count and confirmation floor. Do not update Runtime until all required verifiers are healthy.

### 6.2 Start or update Runtime

For a new environment, start Runtime with the reviewed service configuration. When adding a chain to an existing environment, install the new chain binding only now, preserve every existing binding and durable file, and increase `RestartRevision` once.

```bash
cd <ABSOLUTE_EAB_INFRA_REPOSITORY>
guides/tools/deploy.sh "deployments/$INFRA_ENV/runtime/runtime.conf" --preview
guides/tools/deploy.sh "deployments/$INFRA_ENV/runtime/runtime.conf"
```

Never start a second Runtime for the same bridge operator. Verify effective chain bindings, identities, confirmation floors, persistent storage and one proposal writer.

### 6.3 Pass readiness

Coordinator supplies the deployed Runtime health URL and reruns `continue`:

```bash
export BRIDGE_HEALTH_URL=https://<RUNTIME_HOST>/health
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- continue --manifest "$ROLLOUT_DIR/deployment.json"
```

Runtime performs the private verifier health queries. Coordinator needs no direct verifier network access or verifier API tokens.

Proceed only when readiness passes and `continue` returns an activation action.

## 7. Activate and test

Execute only the current action returned by:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- continue --manifest "$ROLLOUT_DIR/deployment.json"
```

Order:

1. Native destination Safe activation, when selected.
2. Combined EAB+native STRATO activation approval file.
3. EAB Safe activation file.
4. Verify the external chain is enabled on STRATO and the external vault and deposit router are unpaused.
5. Deposit canaries.

After each action, rerun `continue`. Do not reuse an earlier approval or Safe file.

With public intake closed, test:

- EAB deposit through finalized settlement;
- native representation mint unless **EAB-only**;
- approved routing and fallback;
- rejection and retry;
- retry after completion without another mint or release.

Reconcile external custody, STRATO custody, representation supply and recipient balances. Open deposit intake only after reconciliation.

### Enable withdrawals

Withdrawals remain disabled through initial activation.

1. Close intake and reconcile accepted work.
2. Pause affected routes using the generated Safe handoff.
3. Set reviewed withdrawal enablement and limits in `deployment.json`.
4. Run `prepare`.
5. Follow `continue` actions through configuration, service update and activation.
6. Test routine release/redemption, manual Safe review, rejection, cancellation/refund and replay-safe retry.
7. Reconcile escrow, custody, supply and recipient balances before opening withdrawal intake.

## 8. Add native after EAB-only deployment

Use the existing `deployment.json` and `.deployment/`. Do not redeploy, reinitialize or alter EAB.

1. Complete native contract deployment from sections 2.2 and 3.1.
2. Set top-level `"scope": "native"`.
3. Add reviewed `inputs.nativeRoutes` and `inputs.nativeConfig`.
4. Preserve all EAB addresses, routes, policies and service identities.
5. Run:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment.json"
```

6. Send Infra the native-extension archive/checksum.
7. Infra merges native settings into existing Runtime/verifiers with `Running=Yes`.
8. Run `continue` and execute only its current admin, Safe or Infra action.
9. Run native mint and EAB deposit regression canaries.
10. Use the separate withdrawal procedure before enabling native redemptions.

## 9. Resume and recovery

Use the existing manifest and `.deployment/`:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- prepare --manifest "$ROLLOUT_DIR/deployment.json"
npm run external:rollout -- continue --manifest "$ROLLOUT_DIR/deployment.json"
```

Rules:

- Never restart a rollout because tooling changed.
- Never select an arbitrary generated artifact.
- Never retry an uncertain admin submission before live reconciliation.
- Never reuse expired approval files.
- Keep Coordinator `.deployment/` history.
- Admins keep no deployment history or activity trace.
- Completed AdminRegistry calls are removed from replacement approval files.
- Failed Safe MultiSend batches are regenerated against the current Safe nonce.
