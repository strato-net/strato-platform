# EAB and native bridge rollout

This is the operator runbook for adding an external EVM chain to an existing
STRATO EAB/native deployment. Commands below target Base Sepolia (`84532`).
Use the same sequence for another supported chain by changing the network
variables in [Adaptation and production](#adaptation-and-production).

Use a rollout directory outside the repository. Never reuse a rollout directory,
generated Safe JSON, approval hash, or credentials between environments.

Detailed references:

- [EAB_DEPLOYMENT.md](EAB_DEPLOYMENT.md) — EAB roles, governance and failure handling
- [NATIVE_BRIDGE_DEPLOYMENT.md](NATIVE_BRIDGE_DEPLOYMENT.md) — fresh native STRATO deployments and upgrades

## Owners

- **Coordinator:** discovers state, deploys external contracts, freezes the
  reviewed package, drives status and records evidence.
- **STRATO admins:** deploy or upgrade STRATO contracts and execute
  AdminRegistry votes.
- **Safe owners:** review and execute generated Safe Transaction Builder JSON.
- **Infra:** provisions identities and policies, deploys `bridge-eab`, verifiers,
  backend/UI, and funds runtime accounts.

## 0. Set the environment

Use the same reviewed commit on every machine. Node.js v22.12.x (`<23`) is
required.

```bash
cd <STRATO_PLATFORM_REPOSITORY>
export REPO_ROOT="$PWD"
git rev-parse HEAD
git status --short

export TARGET_NETWORK=baseSepolia
export TARGET_CHAIN_ID=84532
export STRATO_NODE_URL=https://<STRATO_TESTNET_HOST>
export ROLLOUT_DIR="$HOME/bridge-rollouts/base-sepolia-$(date -u +%Y%m%dT%H%M%SZ)"
export PREPARED_DIR="$ROLLOUT_DIR/prepared-v1"

test ! -e "$ROLLOUT_DIR"
mkdir -p "$(dirname "$ROLLOUT_DIR")"
```

Configure `app/contracts/.env` for the target STRATO network:

```dotenv
NODE_URL=<same value as STRATO_NODE_URL>
OAUTH_URL=<discovery URL>
OAUTH_CLIENT_ID=<client ID>
OAUTH_CLIENT_SECRET=<client secret>
GLOBAL_ADMIN_NAME=<this operator's username>
GLOBAL_ADMIN_PASSWORD=<this operator's password>
```

Do not keep conflicting OAuth values in `app/ethereum/.env`; that file is loaded
before `app/contracts/.env`. Configure the external deployer and RPC in
`app/ethereum/.env`, or export them:

```bash
export BASE_SEPOLIA_RPC_URL=https://<BASE_SEPOLIA_RPC>
export CHAIN_84532_RPC_URL="$BASE_SEPOLIA_RPC_URL"
export CHAIN_11155111_RPC_URL=https://<SEPOLIA_RPC> # if copying Sepolia routes
export PRIVATE_KEY=<FUNDED_EXTERNAL_DEPLOYER_KEY>
```

`CHAIN_<ID>_RPC_URL` is used by preparation and EAB rollout. The named network
RPC (`BASE_SEPOLIA_RPC_URL` here) is used by Hardhat and native Safe generation.
Set both for every target. Also set `CHAIN_<SOURCE_CHAIN_ID>_RPC_URL` for every
source route selected during discovery.

Install and compile:

```bash
cd "$REPO_ROOT/app/contracts" && npm install
cd "$REPO_ROOT/app/ethereum" && npm install && npm run compile
```

Validate the three endpoints before discovery. This catches OAuth/login HTML,
wrong node ingress URLs and non-RPC target URLs:

```bash
cd "$REPO_ROOT/app/ethereum"
node - <<'NODE'
const path = require("node:path");
require("dotenv").config({ quiet: true });
require("dotenv").config({
  path: path.resolve("../contracts/.env"),
  quiet: true,
  override: false,
});

async function readJson(name, url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`${name} returned non-JSON (${response.status} ${response.headers.get("content-type")}): ${text.slice(0, 80)}`); }
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}`);
  return body;
}

(async () => {
  const oauth = await readJson("OAuth discovery", process.env.OAUTH_URL);
  if (!oauth.token_endpoint) throw new Error("OAuth discovery has no token_endpoint");
  const metadata = await readJson("STRATO metadata", `${process.env.STRATO_NODE_URL.replace(/\/$/, "")}/strato-api/eth/v1.2/metadata`);
  if (!metadata.networkID) throw new Error("STRATO metadata has no networkID");
  const rpc = await readJson("Target RPC", process.env.CHAIN_84532_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (BigInt(rpc.result) !== 84532n) throw new Error(`Target RPC returned chain ${BigInt(rpc.result)}`);
  console.log(`Endpoint check passed: STRATO ${metadata.networkID}, target ${BigInt(rpc.result)}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
```

## 1. Discover and select routes

From `app/ethereum`:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run bridge:prepare -- --discover \
  --node-url "$STRATO_NODE_URL" \
  --chain-id "$TARGET_CHAIN_ID" \
  --source-chain-id 11155111 \
  --output-dir "$ROLLOUT_DIR"
```

The output directory must not already exist. Review:

- `discovery.json`: the legacy `MercataBridge` source and native bridge
  candidates. EAB baselines come from legacy assets and each source chain's
  `DepositRouter`.
- `prepare.json`: discovered routes, all initially `include: false`.

The standard legacy bridge is `0x0000000000000000000000000000000000001008`.
Use `--eab-address` only for a nonstandard legacy deployment. If the native
bridge is ambiguous, preserve the first output and rerun discovery into a new
directory with `--source-chain-id` and `--native-address` from
`discovery.json`.

Edit `prepare.json`:

1. Set `include: true` only for approved routes.
2. Review target tokens prefilled from the legacy target-chain configuration.
   For unresolved ERC-20 routes, enter only the target token address; metadata
   is read during preparation.
3. Keep only one target `externalToken + stratoToken` pair; duplicates fail.
4. Leave deployment artifact fields until step 3.

## 2. Decide whether STRATO contracts change

Adding another external chain does **not** by itself require new STRATO proxies,
a new custody vault, or an implementation upgrade.

Before changing STRATO, record the live proxy and implementation addresses for:

- `TokenRouter`
- `ExternalAssetBridge`
- `StratoNativeBridge`
- `StratoNativeCustodyVault`

Reuse them when they already contain the reviewed release. Never redeploy or
reinitialize native custody for a chain addition.

If an implementation upgrade is required, run one contract at a time from
`app/contracts`:

```bash
cd "$REPO_ROOT/app/contracts"
npm run upgrade -- \
  --proxy-address <PROXY_ADDRESS> \
  --contract-name <CONTRACT_NAME> \
  --contract-file BaseCodeCollection.sol \
  +OVERRIDE-CHECKS
```

Keep the initiating process running. Other admins vote on the existing
AdminRegistry issue; they do not start another deployment. Complete both
implementation creation and `Proxy.setLogicContract`, then verify the proxy's
live `logicContract`.

For a missing proxy:

```bash
npm run deployProxy -- --empty \
  --owner <ADMIN_REGISTRY_ADDRESS> \
  --contract-file BaseCodeCollection.sol
```

Use [NATIVE_BRIDGE_DEPLOYMENT.md](NATIVE_BRIDGE_DEPLOYMENT.md) for a genuinely
fresh native bridge/vault pair. Use a separate EAB proxy; never repurpose
`MercataBridge`.

## 3. Deploy external contracts

### 3.1 EAB vault and deposit router

Set the approved deployment confirmation count and role addresses. On a standard
Safe-owned deployment these role addresses are normally the Safe, but review
them individually:

```bash
cd "$REPO_ROOT/app/ethereum"
export SAFE_ADDRESS=0x<SAFE>
export CHAIN_84532_DEPLOYMENT_CONFIRMATIONS=<COUNT>
export CHAIN_84532_SAFE_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_VAULT_DEFAULT_ADMIN_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_VAULT_UPGRADER_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_VAULT_POLICY_ADMIN_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_GUARDIAN_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_VAULT_UNPAUSER_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_VAULT_ATTESTATION_ADMIN_ADDRESS="$SAFE_ADDRESS"
export CHAIN_84532_LARGE_WITHDRAWAL_APPROVER_ADDRESS="$SAFE_ADDRESS"
```

Run the non-mutating preflight, review it, then execute:

```bash
npm run deployExternalBridge:baseSepolia -- \
  --rollout-dir "$ROLLOUT_DIR"

npm run deployExternalBridge:baseSepolia -- \
  --rollout-dir "$ROLLOUT_DIR" --execute
```

This writes `$ROLLOUT_DIR/external-deployment.json`. Verify the vault and
`ExternalAssetDepositRouter` implementations; both are version `1.0.0` in this
release:

```bash
npm run verify:baseSepolia -- <VAULT_IMPLEMENTATION>
npm run verify:baseSepolia -- <ROUTER_IMPLEMENTATION>
```

### 3.2 Native representation bridge and tokens

Deploy one representation bridge for the target chain:

```bash
cd "$REPO_ROOT/app/ethereum"
CONTRACT_NAME=StratoNativeRepresentationBridge \
INIT_PARAMS='["0x<SAFE_ADDRESS>"]' \
npm run deployWithProxy:baseSepolia

cp "deployments/StratoNativeRepresentationBridge_${TARGET_NETWORK}_latest.json" \
  "$ROLLOUT_DIR/native-bridge.json"
```

Deploy one representation token per approved native route and copy its artifact
immediately so the next token does not overwrite `_latest.json`:

```bash
CONTRACT_NAME=StratoNativeRepresentationToken \
INIT_PARAMS='["<TOKEN_NAME>","<TOKEN_SYMBOL>","0x<SAFE_ADDRESS>"]' \
npm run deployWithProxy:baseSepolia

cp "deployments/StratoNativeRepresentationToken_${TARGET_NETWORK}_latest.json" \
  "$ROLLOUT_DIR/native-<TOKEN_SYMBOL>.json"
```

Verify every implementation and confirm the proxy, Safe and chain ID in each
artifact before continuing. This release expects representation bridge version
`3.0.0` and representation token version `1.0.0`. Native deployment is not
checkpointed: inspect the receipt and on-chain proxy before retrying a failed
command.

Clear the deploy key:

```bash
unset PRIVATE_KEY
```

Update `$ROLLOUT_DIR/prepare.json` with paths relative to that file:

```json
{
  "target": {
    "nativeDeployment": "native-bridge.json"
  },
  "nativeRoutes": [
    {
      "deployment": "native-<TOKEN_SYMBOL>.json"
    }
  ]
}
```

`external-deployment.json` is loaded automatically from the rollout directory.

## 4. Generate and review configuration

From `app/ethereum`:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run bridge:prepare -- \
  --config "$ROLLOUT_DIR/prepare.json" \
  --output-dir "$PREPARED_DIR"
```

Every preparation run requires a new output directory. Review
`$PREPARED_DIR/review-required.json`, then resolve every corresponding
`REVIEW_REQUIRED` value in:

- `settings.json` and `policy.json` — EAB/TokenRouter configuration.
- `native-routes.json` — STRATO native routes and limits.
- `native.json` — external native bridge Safe, executor, EAB executor,
  distinct attestation signers, threshold, validity and token controls.

Required native constraints:

- At least two distinct attestation signers and threshold `>= 2`.
- Native executor differs from the EAB executor, Safe and signers.
- Every token has explicit `freezeRoute` and `transfersEnabled`.
- Preserve approved token-wide limits; do not infer them from a route.

New EAB and native routes default auto-routing to `true`; use `false` only when
explicitly approved.

Do not proceed while an input file still contains `REVIEW_REQUIRED`.

## 5. Freeze the EAB package

Create the EAB manifest:

```bash
npm run external:rollout -- init \
  --settings "$PREPARED_DIR/settings.json" \
  --policy "$PREPARED_DIR/policy.json" \
  --manifest "$ROLLOUT_DIR/deployment-manifest.json"
```

Resolve every review field in `deployment-manifest.json`, including three
verifier URLs/token variable names, authorization signers, confirmations,
runtime identities and `bridgeHealthUrlEnv`. Keep secrets out of the manifest.

Validate the offline plan and freeze the bundle:

```bash
npm run external:rollout -- plan \
  --manifest "$ROLLOUT_DIR/deployment-manifest.json" \
  --output-dir "$ROLLOUT_DIR/generated" \
  --stage activation

npm run external:rollout -- bundle \
  --manifest "$ROLLOUT_DIR/deployment-manifest.json" \
  --bundle "$ROLLOUT_DIR/deployment-bundle.json"

shasum -a 256 "$ROLLOUT_DIR/deployment-bundle.json"
```

Each persona runs `setup` on its own machine using the reviewed bundle. Example
for the coordinator:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run external:rollout -- setup \
  --role coordinator \
  --config "$ROLLOUT_DIR/coordinator.json" \
  --manifest "$ROLLOUT_DIR/deployment-bundle.json" \
  --output-dir "$ROLLOUT_DIR/generated" \
  --stage activation \
  --env-file "$ROLLOUT_DIR/coordinator.env"

export EAB_ROLLOUT_CONFIG="$ROLLOUT_DIR/coordinator.json"
```

Admins use `--role admin-1` or `--role admin-2` with their own config, output
directory, env file and credentials. Additional admins also use the `admin-2`
profile label. Infra uses `--role infra` without an env file. See
[EAB_DEPLOYMENT.md](EAB_DEPLOYMENT.md#4-each-persona-sets-up-locally).

Each coordinator/admin env file contains the matching STRATO OAuth credentials
and `CHAIN_84532_RPC_URL`. The coordinator adds `BRIDGE_HEALTH_URL` after Infra
deploys the runtime.

## 6. Configure while disabled

### 6.1 EAB

The coordinator runs:

```bash
npm run external:rollout -- status
```

Follow only the command printed by `status`. In order:

1. Safe owners execute pending pause/configuration JSON from `safeChecklist`.
2. Each STRATO admin executes the printed vote command using its own profile.
3. Rerun `status` after each Safe execution or vote.
4. Stop after Safe configuration and STRATO governance are complete. If service
   health is still pending, continue with step 7. Do not activate yet.

Approval hashes are state-specific. Never reuse one from an older report.

### 6.2 Native route on STRATO

For each zero-based route index, first dry-run:

```bash
cd "$REPO_ROOT/app/contracts"
npm run configure:native-route -- \
  --config "$PREPARED_DIR/native-routes.json" \
  --route 0 \
  --enabled false \
  --auto-route-enabled false
```

Review the exact calls. Every required admin reruns the same command with
`--execute`. Do not change arguments between voters.

`sharedTokenSettings` in `native-routes.json` are not applied automatically.
When approved settings are missing or changing, add all three flags to one
reviewed route command:

```text
--deposits-disabled <true|false>
--withdrawals-disabled <true|false>
--max-outstanding-withdrawal <RAW_AMOUNT>
```

Likewise, configure settlement verifiers/threshold and `--token-router` only
when the live bridge does not already match the reviewed values.

### 6.3 Native bridge on the external chain

From `app/ethereum`, generate a new Safe file:

```bash
cd "$REPO_ROOT/app/ethereum"
npm run native:configure -- \
  --config "$PREPARED_DIR/native.json" \
  --stage configure \
  --output "$ROLLOUT_DIR/native-configure.safe.json"
```

Safe owners review and execute it. It pauses the bridge when needed, configures
signers, executor permissions, token mappings and transfer controls. Output
files are immutable; use a new filename if configuration must be regenerated.

## 7. Deploy services and pass readiness

Infra deploys the same reviewed commit:

- `app/services/bridge-eab` runtime and all verifiers — not the legacy
  `app/services/bridge`.
- Target-chain EAB/native addresses, RPC/WS endpoints and reviewed policies.
- Backend/UI with the verified STRATO EAB, TokenRouter, native bridge and
  custody-vault addresses.
- Existing persistent runtime journals and cursors; never reset them during an
  upgrade.

Fund and verify:

- STRATO operator, relayer and each verifier's STRATO attestor account.
- External EAB/native executor gas account.

Coordinator readiness:

```bash
cd "$REPO_ROOT/app/ethereum"
# EAB: nonzero exit until the rollout reaches an allowed activation state.
npm run external:rollout -- verify

# Native: regenerate after Safe configuration and require 0 pending calls.
npm run native:configure -- \
  --config "$PREPARED_DIR/native.json" \
  --stage configure \
  --output "$ROLLOUT_DIR/native-readiness.safe.json"
```

Require three healthy verifiers with matching policy/baseline hashes, healthy
runtime, correct contract identities, funded transaction senders and zero
pending native configuration calls.

## 8. Activate in a controlled window

Keep UI/API intake closed. Cross-chain activation is not atomic.

1. Enable each reviewed STRATO native route by rerunning its step 6 command with
   `--enabled true`, the approved `--auto-route-enabled` value and `--execute`.
   Omit one-time verifier, router and token-wide flags:

   ```bash
   cd "$REPO_ROOT/app/contracts"
   npm run configure:native-route -- \
     --config "$PREPARED_DIR/native-routes.json" \
     --route 0 \
     --enabled true \
     --auto-route-enabled <APPROVED_TRUE_OR_FALSE> \
     --execute
   ```

   Every required admin submits the exact same reviewed call.
2. Generate native activation:

   ```bash
   cd "$REPO_ROOT/app/ethereum"
   npm run native:configure -- \
     --config "$PREPARED_DIR/native.json" \
     --stage activate \
     --output "$ROLLOUT_DIR/native-activate.safe.json"
   ```

3. Safe owners execute `native-activate.safe.json`.
4. Run EAB `status`, execute its exact printed `activate --approve <hash>`
   command, then have Safe owners execute the generated
   `activation-unpause-<hash>.json`.
5. Open intake only after both systems verify.

Final checks:

```bash
npm run native:configure -- \
  --config "$PREPARED_DIR/native.json" \
  --stage verify

npm run external:rollout -- verify
```

Run small, pre-approved live tests before wider use:

- EAB: ERC-20 and native ETH deposit; direct route; routed success and fallback;
  withdrawal; review/reject/refund.
- Native: plain and routed redemption; fallback; manual and instant withdrawal;
  cancellation and refund.
- Reconcile source, custody, STRATO and destination balances; confirm final
  statuses and idempotent retries.

Store the commit, bundle hash, policy hashes, contract/proxy/implementation
addresses, Safe transactions, governance issue IDs, service image digests and
test evidence with the rollout directory.

## Adaptation and production

Supported network aliases and RPC variables:

- Base Sepolia: `baseSepolia`, `84532`, `BASE_SEPOLIA_RPC_URL`
- Sepolia: `sepolia`, `11155111`, `SEPOLIA_RPC_URL`
- Linea Sepolia: `lineaSepolia`, `59141`, `LINEA_SEPOLIA_RPC_URL`
- Base: `base`, `8453`, `BASE_RPC_URL`
- Ethereum: `mainnet`, `1`, `MAINNET_RPC_URL`
- Linea: `linea`, `59144`, `LINEA_RPC_URL`

For another chain, change `TARGET_NETWORK`, `TARGET_CHAIN_ID`, the named RPC
variable, `CHAIN_<TARGET_CHAIN_ID>_RPC_URL`, role variables and deployment
artifacts. The scripts reject unsupported chains.

Production adds these mandatory gates:

1. Complete this rollout and all recovery scenarios on testnet first.
2. Use a clean reviewed commit, immutable image digests, production-only
   credentials, Safe, policies and rollout directory.
3. Before EAB `--execute`, export:

   ```bash
   export CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$TARGET_CHAIN_ID"
   ```

4. Record and reconcile all in-flight bridge operations before upgrades.
5. Require independent admin/Safe review of every raw amount, role, signer,
   threshold and activation transaction.
6. Keep intake closed until production readiness and canaries pass. Pause on
   any identity, balance, event or status mismatch.
