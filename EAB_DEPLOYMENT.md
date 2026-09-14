# External Asset Bridge Deployment

## Scope

Deploy one External Asset Bridge between STRATO and an external EVM network.

Assumptions:

- Safe, KMS, and three verifier services already exist.
- Verifier threshold is normally two of three.
- Legacy custody is not migrated; every `migrateAmount` is `"0"`.
- Automatic routing remains disabled for the first launch.

## Files

Use one directory:

```text
<ROLLOUT>/
  external-deployment.json
  deposit-plan.json
  deployment-manifest.json
  deployment.env
  generated/
```

After initialization, edit only:

```text
deployment-manifest.json   non-secret source of truth
deployment.env             local secrets
```

The script manages `generated/`. Use `generated/latest.json`; never select or edit
a revision directory manually.

## Inputs

### 1. Business inputs

Approve before deployment.

Per route:

- External token and STRATO token
- Deposits enabled
- Withdrawals enabled
- Rebase required
- Maximum automatic deposit
- Automatic routing enabled; use `false` for the first launch

Per external token, in raw token units:

- Minimum deposit
- Maximum withdrawal
- Manual-review threshold
- Maximum automatic withdrawal
- Withdrawal bucket capacity
- Withdrawal refill rate per second

Per STRATO token:

- Mint capacity
- Mint refill rate per second

Global:

- Runtime confirmation count
- Confirmation count for each verifier
- Verifier threshold
- Authorization validity
- Canary routes, amounts, and success criteria

Each verifier confirmation count must be at least the Runtime count. Maximum
withdrawal and refill rate must not exceed bucket capacity.

### 2. Deployment-specific inputs

Network:

- STRATO node URL and network ID
- External network name, chain ID, HTTPS RPC, and deployment confirmations
- External WebSocket and independent verification RPCs

STRATO dependencies:

- AdminRegistry
- PoolFactory and PoolV3Factory
- DirectMintPsm and MetalForge
- SaveUSDSTVault and approved YieldVaults
- TokenFactory, USDST, and PriceOracle

Identities and infrastructure:

- Bridge operator and guardian
- Three STRATO settlement attestors
- Three verifier KMS authorization signers
- Three verifier HTTPS URLs
- Safe
- Safe proposer address and KMS alias/region
- External executor address and KMS alias/region
- Permit2, if the network does not use canonical Permit2

The proposer, executor, and authorization signers must be distinct. The proposer
and executor must not be Safe owners.

### 3. Credentials

STRATO administrator, one set per administrator:

```text
GLOBAL_ADMIN_NAME
GLOBAL_ADMIN_PASSWORD
OAUTH_URL
OAUTH_CLIENT_ID
OAUTH_CLIENT_SECRET
NODE_URL
```

External deployer:

```text
<NETWORK>_RPC_URL
PRIVATE_KEY
```

`<ROLLOUT>/deployment.env`:

```bash
CHAIN_<CHAIN_ID>_RPC_URL=<HTTPS_RPC>
OAUTH_URL=<OPENID_DISCOVERY_URL>
OAUTH_CLIENT_ID=<CLIENT_ID>
OAUTH_CLIENT_SECRET=<CLIENT_SECRET>
GLOBAL_ADMIN_NAME=<CURRENT_ADMIN>
GLOBAL_ADMIN_PASSWORD=<CURRENT_ADMIN_PASSWORD>

# Needed only for final verification
VERIFIER_1_API_TOKEN=<TOKEN>
VERIFIER_2_API_TOKEN=<TOKEN>
VERIFIER_3_API_TOKEN=<TOKEN>
```

The rollout loads this file automatically. Keep it outside version control with
mode `0600`.

Service deployment also needs Safe owner access, AWS workload roles, Runtime
operator and relayer credentials, Safe API key, image registry access, backend
URL, and webhook/operations tokens.

### 4. Values recorded during deployment

STRATO:

- TokenRouter and ExternalAssetBridge proxy/implementation addresses
- Creation and upgrade issue IDs and transaction hashes

External chain:

- Safe, vault, and DepositRouter addresses
- Vault and DepositRouter implementations
- Deployment blocks, confirmations, and transaction hashes

Configuration:

- Route-discovery output
- Final manifest revision and artifact hashes
- Admin vote issues and receipts
- Safe transaction hashes
- Verifier policy digests and shared baseline hash
- Runtime image digest and health URL
- Activation transaction
- Canary IDs, transactions, and before/after balances

The deployment and rollout scripts record most of these automatically.

## Deployment

Set:

```bash
export REPO=<REPOSITORY>
export ROLLOUT=<ROLLOUT_DIRECTORY>
export NETWORK=<SUPPORTED_EXTERNAL_NETWORK>
export CHAIN_ID=<EXTERNAL_CHAIN_ID>
export ADMIN_REGISTRY=<ADMIN_REGISTRY_ADDRESS>
```

Use `--stage activation` for all rollout commands.

Supported external networks are defined once in
`app/ethereum/scripts/lib/externalBridgeNetworks.js`.

### Step 1 — Deploy STRATO proxies

Skip if reviewed proxies and implementations already exist.

```bash
cd "$REPO/app/contracts"

# Run once for TokenRouter and once for ExternalAssetBridge.
npm run deployProxy -- \
  --empty \
  --owner "$ADMIN_REGISTRY" \
  --contract-file BaseCodeCollection.sol

npm run upgrade -- \
  --proxy-address <TOKEN_ROUTER_PROXY> \
  --contract-name TokenRouter \
  --contract-file BaseCodeCollection.sol

npm run upgrade -- \
  --proxy-address <EXTERNAL_ASSET_BRIDGE_PROXY> \
  --contract-name ExternalAssetBridge \
  --contract-file BaseCodeCollection.sol
```

For each creation or upgrade:

1. Administrator 1 submits once and records the issue.
2. Administrator 2 approves the same issue.
3. Wait for execution and record the result.

Never rerun a completed creation to cast the second vote.

### Step 2 — Deploy the external contracts

Set:

```text
CHAIN_<CHAIN_ID>_DEPLOYMENT_CONFIRMATIONS
CHAIN_<CHAIN_ID>_SAFE_ADDRESS
CHAIN_<CHAIN_ID>_VAULT_DEFAULT_ADMIN_ADDRESS
CHAIN_<CHAIN_ID>_VAULT_UPGRADER_ADDRESS
CHAIN_<CHAIN_ID>_VAULT_POLICY_ADMIN_ADDRESS
CHAIN_<CHAIN_ID>_GUARDIAN_ADDRESS
CHAIN_<CHAIN_ID>_VAULT_UNPAUSER_ADDRESS
CHAIN_<CHAIN_ID>_VAULT_ATTESTATION_ADMIN_ADDRESS
CHAIN_<CHAIN_ID>_LARGE_WITHDRAWAL_APPROVER_ADDRESS
```

Run preflight, then execute:

```bash
cd "$REPO/app/ethereum"
HARDHAT_NETWORK="$NETWORK" npm run deployExternalBridge -- \
  --rollout-dir "$ROLLOUT"
HARDHAT_NETWORK="$NETWORK" npm run deployExternalBridge -- \
  --rollout-dir "$ROLLOUT" \
  --execute
```

Production execution additionally requires:

```bash
export CONFIRM_EXTERNAL_BRIDGE_DEPLOY="$CHAIN_ID"
```

The execute command records `<ROLLOUT>/external-deployment.json`.

### Step 3 — Build the manifest

Discover routes without `--apply`:

```bash
npm run router:ops:<testnet-or-prod> -- \
  --step setters \
  --chains "$CHAIN_ID" \
  --router-address <DEPOSIT_ROUTER> \
  --safe-address <SAFE> \
  --rollout-dir "$ROLLOUT"
```

Create and initialize the draft manifest:

```bash
npm run external:rollout -- init \
  --manifest "$ROLLOUT/deployment-manifest.json"
```

The first run creates the draft. Fill all business and deployment inputs, then
rerun the same `init` command to validate and expand it. Resolve every
`REVIEW_REQUIRED` value, then create the non-secret administrator handoff bundle:

```bash
npm run external:rollout -- bundle \
  --manifest "$ROLLOUT/deployment-manifest.json" \
  --bundle "$ROLLOUT/deployment-bundle.json"
```

Give `deployment-bundle.json` and its printed SHA-256 checksum to both
administrators. Do not send `deployment.env`. Use the bundle—not the original
manifest—for every remaining rollout command:

```bash
npm run external:rollout -- plan \
  --manifest "$ROLLOUT/deployment-bundle.json" \
  --output-dir "$ROLLOUT/generated" \
  --stage activation
```

### Step 4 — Execute Safe configuration

Use the printed `safeChecklist`. Safe owners review and execute:

1. Router pause
2. Vault pause
3. Router token configuration
4. Vault signer and policy configuration

Keep both contracts paused.

### Step 5 — Complete STRATO governance

On the technician's machine, configure the bundle and read-only environment once:

```bash
npm run external:rollout -- technician-setup \
  --config /secure/eab/local/technician.json \
  --manifest /secure/eab/deployment-bundle.json \
  --output-dir /secure/eab/generated \
  --env-file /secure/eab/local/technician.env
```

Run the printed `export EAB_ROLLOUT_CONFIG=...` once in the technician terminal.

On each administrator's machine, perform this once using that administrator's
own local OAuth environment file:

```bash
npm run external:rollout -- admin-setup \
  --admin <1-or-2> \
  --manifest /secure/eab/deployment-bundle.json \
  --output-dir ~/.local/state/strato/eab \
  --env-file ~/.config/strato/eab-admin.env
```

This stores local paths and the immutable bundle checksum in
`~/.config/strato/eab-admin.json`. It does not copy or share credentials.
Each admin's private `eab-admin.env` contains either `ACCESS_TOKEN`, or that
admin's `GLOBAL_ADMIN_NAME` and `GLOBAL_ADMIN_PASSWORD` plus `OAUTH_URL`,
`OAUTH_CLIENT_ID`, and `OAUTH_CLIENT_SECRET`. Set its mode to `0600`.
Each admin runs their printed `export EAB_ROLLOUT_CONFIG=...` once in their own
terminal. When testing all roles on one machine, use three separate terminals.

```bash
npm run external:rollout -- status \
  --manifest "$ROLLOUT/deployment-bundle.json" \
  --output-dir "$ROLLOUT/generated" \
  --stage activation
```

Follow the printed action:

1. The technician sends the printed Admin 1 command.
2. Admin 1 runs it. The script prints the Admin 2 handoff command.
3. Admin 2 runs that command using their local configuration and credentials.
4. Admin 2's output hands control back to the technician, who reruns `status`
   with their own local technician profile.
5. Repeat for the next stage.

The script reports:

```text
FIRST_ADMIN_VOTE_REQUIRED
WAITING_ON_SECOND_ADMIN
WAITING_FOR_EXECUTION
```

No generated directory or vote journal is transferred between machines. Do not
calculate stages or reuse approval hashes manually.

### Step 6 — Deploy services and activate

Deploy the generated verifier policies. Verify each `/health` response against the
generated chain, vault, identity, confirmation, policy digest, and baseline hash.

Deploy Runtime from the generated environment template at the health URL already
recorded in the immutable bundle.

Run:

```bash
npm run external:rollout -- verify \
  --manifest "$ROLLOUT/deployment-bundle.json" \
  --output-dir "$ROLLOUT/generated" \
  --stage activation
```

When status is `READY_FOR_ACTIVATION_REVIEW`, run the exact printed activation
command. Safe owners review and execute the generated batch:

- Withdrawal-enabled: unpause vault, then DepositRouter.
- Deposit-only: unpause DepositRouter only.

Rerun `resume`.

## Canary

Deposit the smallest approved amount on one route. Record user, vault, and STRATO
balances before and after. Confirm one custody increase and one STRATO mint.

Then withdraw below the automatic limit and available bucket capacity. Confirm
STRATO escrow, one external release, final burn, and no remaining reservation.

Pause if balances, identities, or statuses do not reconcile.

## Complete when

- AdminRegistry calls are complete.
- Safe configuration and activation batches executed.
- Live state matches the manifest.
- Verifier and Runtime health checks pass.
- Deposit and withdrawal canaries reconcile.
- Temporary credentials and allowlists are removed.
- Final addresses, revisions, policies, transactions, and canary evidence are
  retained.
