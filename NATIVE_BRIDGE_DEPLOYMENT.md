# Native Bridge Deployment

This is the canonical end-to-end install guide for a new non-production native bridge deployment. For production, use `NATIVE_BRIDGE_MAINNET_RUNBOOK.md`. For contract lifecycle and audit workflow details, use `NATIVE_BRIDGE_CONTRACT_WORKFLOWS.md`.

Follow the numbered sections in order:
1. `Naming`
2. `STRATO`
3. `Ethereum Sepolia`
4. `Fresh Deployment Sequence`
5. `Command Runbook`

The `STRATO` and `Ethereum Sepolia` sections are the canonical fresh-deploy flow. The `Command Runbook` repeats the same operations with placeholder commands and includes upgrade/recovery commands for existing deployments.

The native bridge is split across:
- STRATO: `StratoNativeBridge` and `StratoNativeCustodyVault`
- Ethereum Sepolia: `StratoNativeRepresentationBridge` and `StratoNativeRepresentationToken`

## Rejected deposit recovery update

Native refund completion requires a separate governance vote on `finalizeDepositRefund(depositId, refundTxHash)` after the operator records confirmed external evidence. Verify the bridge is owned by AdminRegistry (not the hot operator), its finalization voting threshold is correct, the operator has no whitelist bypass for `finalizeDepositRefund`, and `depositRefundEvidence` is indexed. Deploy backend/UI with the Confirm refund action; keep the item pending until that vote executes.

Before enabling **Complete delivery** or **Return funds** in Admin, upgrade StratoNativeBridge and StratoNativeRepresentationBridge and follow the [deposit recovery upgrade gate](app/services/bridge-eab/README.md#deposit-delivery-and-source-network-refunds). Native refunds restore representations to the original external sender and retain STRATO backing. They use the native KMS identities configured in the shared EAB verifier fleet and execute through the authorized refund executor or Safe. Preserve `data/native-refunds/` across service replacements and test Safe expiry/retry if execution requires Safe approval.

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

From `app/contracts`, make sure your `.env` has:
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

Deploy `app/contracts/concrete/Proxy/Proxy.sol` and record the proxy address.

Use:
- `_initialOwner = ADMIN_REGISTRY`
- `_logicContract = <temporary logic address>`

The point of this step is just to create the proxy address first.

### Step 2: Upgrade that proxy to `StratoNativeBridge`

Run from `app/contracts`:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_BRIDGE_PROXY> \
  --contract-name StratoNativeBridge \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

### Step 3: Deploy a `Proxy` for `StratoNativeCustodyVault`

Again deploy `app/contracts/concrete/Proxy/Proxy.sol` and record the proxy address.

Use:
- `_initialOwner = ADMIN_REGISTRY`
- `_logicContract = <temporary logic address>`

### Step 4: Upgrade that proxy to `StratoNativeCustodyVault`

Run from `app/contracts`:

```bash
npm run upgrade -- \
  --proxy-address <STRATO_NATIVE_CUSTODY_VAULT_PROXY> \
  --contract-name StratoNativeCustodyVault \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"initialOwner":"<ADMIN_REGISTRY_WITHOUT_0X>"}' \
  +OVERRIDE-CHECKS
```

### Step 5: Initialize bridge + vault

Run from `app/contracts`:

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
- if `owner = ADMIN_REGISTRY`, `configure:native-route` submits these owner-only calls through `AdminRegistry.castVoteOnIssue`; each required administrator must run the same `--execute` command

### Step 6: Configure the STRATO native route

Run this after the Sepolia representation token and bridge proxies exist, because this route points at those Sepolia addresses.

Run from `app/contracts`:

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
  --settlement-verifiers <STRATO_ATTESTOR_1>,<STRATO_ATTESTOR_2>,<STRATO_ATTESTOR_3> \
  --settlement-verifier-threshold 2 \
  --enabled true
```

Notes:
- `external-chain-id` is Sepolia for now: `11155111`
- `external-bridge` must be the Sepolia `StratoNativeRepresentationBridge` proxy
- `representation-token` must be the Sepolia `StratoNativeRepresentationToken` proxy
- review the dry-run plan, then append `--execute`; every required STRATO administrator must submit the same votes

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

From `app/ethereum`, make sure your `.env` has:
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

Run from `app/ethereum`:

```bash
npm ci
npm run compile
```

### Step 2: Deploy the Sepolia representation token proxy

Run from `app/ethereum`:

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

Run from `app/ethereum`:

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

Create the environment-specific Safe Transaction Builder batch locally from the
call template in this runbook. Do not commit signer addresses or a stale batch.

This batch does:
- on `StratoNativeRepresentationToken`, `grantRole(BRIDGE_ROLE, <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>)`
- on `StratoNativeRepresentationToken`, keep `transfersEnabled = false` until the sale/release condition is met
- on `StratoNativeRepresentationToken`, `setTransferEndpoint(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>, true)` so redemptions can occur while peer-to-peer transfers are blocked
- on `StratoNativeRepresentationBridge`, optionally split operational roles with `grantRole` / `revokeRole`
- on `StratoNativeRepresentationBridge`, `setAttestationSigner(<NATIVE_VERIFIER_KMS_SIGNER>, true)` for each independent native verifier
- on `StratoNativeRepresentationBridge`, `setAttestationThreshold(<native mint attestation threshold>)`
- when replacing an existing signer set, identify all currently enabled signers and include `setAttestationSigner(<RETIRED_SIGNER>, false)` for every signer outside the intended set. Adding the new verifiers does not remove the old signer. Add replacements before removals and order threshold changes so each intermediate signer count satisfies the threshold; execute the replacement as one atomic Safe batch. Signer/threshold changes invalidate outstanding attestations, which must be regenerated.
- on `StratoNativeRepresentationBridge`, grant `MINT_EXECUTOR_ROLE` to the dedicated instant executor; do not grant it admin permissions
- on `StratoNativeRepresentationBridge`, optionally `setMaxAttestationValiditySeconds(<seconds>)` if the default 7 day maximum validity should change
- on `StratoNativeRepresentationBridge`, `registerTokenMapping(<STRATO_TOKEN>, <SEPOLIA_REPRESENTATION_TOKEN_PROXY>, false)`

Generate the signer portion with `npm run native:signers -- --config /path/to/native-signers.json --output /path/to/native-signers-safe.json` from `app/ethereum`. The local JSON configuration must contain `chainId` (number), `bridgeAddress`, `safeAddress`, `attestationSigners` (the complete intended address list), `disabledAttestationSigners` (an explicit list of retired addresses, or `[]` for a fresh bridge), and `attestationThreshold` (number). RPC selection uses the existing network environment variables, such as `SEPOLIA_RPC_URL`.

The generator reads signer state at one block, requires the Safe's attestation-admin role, and refuses to generate a batch if the configured lists do not account for the on-chain enabled signer count. Identify any missing legacy signer rather than ignoring this error. Calls add replacements, set the threshold, then remove retired signers. Execute as one atomic Safe batch; regenerate if signer state changes before execution. This command only writes JSON and never submits transactions.

After execution, run `npm run native:signers -- --config /path/to/native-signers.json --verify`. Verification fails unless the signer count, intended signers, retired signers, and threshold all match.

V1 minting is removed. Every V2 verifier signature binds `useInstantPath`. Manual V2 mints require the custody Safe's `DEFAULT_ADMIN_ROLE`; instant V2 mints require `MINT_EXECUTOR_ROLE` on the dedicated executor. Verifier EOAs must hold neither role.

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
- on the token proxy, `transfersEnabled()` returns the intended launch value
- on the token proxy, `transferEndpoints(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>)` returns `true`
- on the bridge proxy, operational role holders match the deployment role plan
- on the bridge proxy, `attestationSigners(<STRATO_VAULT_BACKED_SIGNER>)` returns `true`
- on the bridge proxy, `attestationThreshold()` returns the configured native mint attestation threshold
- `attestationSignerCount()` equals the intended signer count (for example, exactly `3` for a 2-of-3 setup), every intended signer returns `true`, and every retired signer returns `false` from `attestationSigners(address)`
- on the bridge proxy, `maxAttestationValiditySeconds()` returns the configured maximum attestation validity
- on the bridge proxy, `stratoToRepresentation(<STRATO_TOKEN>)` returns `<SEPOLIA_REPRESENTATION_TOKEN_PROXY>`

### Step 7: Update bridge service config

Before running the native flow end to end, update the bridge service environment/config with:
- `STRATO_NATIVE_BRIDGE_ADDRESS=<STRATO_NATIVE_BRIDGE_PROXY>`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>`
- `CHAIN_11155111_RPC_URL=<sepolia-rpc-url>` if it is not already configured
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_ADDRESS=<gas-paying-executor-address>`
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_KEY_ID=<full-key-arn>`
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_REGION=<aws-region>`
- `CHAIN_11155111_NATIVE_VERIFIER_URLS=<comma-separated-independent-verifiers>`
- `CHAIN_11155111_NATIVE_VERIFIER_API_TOKENS=<matching-comma-separated-tokens>`

Confirm that `StratoNativeBridge` has the bridge service STRATO address configured as its bridge operator before starting native withdrawals. The operator must be the STRATO address for the same `BA_USERNAME` account running the service.

Native withdrawal authorization is immediately valid when the withdrawal becomes pending, matching EAB. The attestation maximum validity window is configured on `StratoNativeRepresentationBridge` with `setMaxAttestationValiditySeconds`.

The native runtime is `bridge-eab`; the legacy `/bridge` service remains unchanged. If `bridge-eab` is deployed through `docker-compose.bridge-eab.tpl.yml`, these values must be present in its runtime env file. The template forwards:
- `STRATO_NATIVE_BRIDGE_ADDRESS`
- `CHAIN_11155111_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_ADDRESS`
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_KEY_ID`
- `CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_REGION`
- `CHAIN_11155111_NATIVE_VERIFIER_URLS`
- `CHAIN_11155111_NATIVE_VERIFIER_API_TOKENS`

The bridge service now has a native mint path:
- instant withdrawals move to `PENDING_REVIEW`, wait until `nativeMintNotBefore`, collect lane-bound V2 signatures from independent verifiers, execute directly through the authorized instant executor, verify destination confirmations and event fields, then finalize on STRATO
- approval-lane withdrawals collect only native mint signatures, propose the mint directly to the Safe, persist the Safe tx hash on STRATO, verify execution, and then finalize

Native redemption recovery policy:
- external-to-STRATO redemptions burn representation tokens on Sepolia before STRATO unlock
- `abortDeposit` on STRATO is an operator rejection/escalation marker and does not automatically re-mint representation tokens on Sepolia
- if a valid external burn cannot be completed on STRATO, Safe/admin operators must intervene manually by fixing and confirming the STRATO deposit or by performing a controlled compensating action on the external chain

Native verifier rollout order:
1. Keep native routes disabled while configuration is incomplete.
2. Add at least two independent representation-bridge attestation signers, then set `attestationThreshold` to at least `2`. The contract rejects `0` and `1`.
3. Through STRATO governance, enable each verifier's settlement-attestor STRATO account with `setSettlementVerifier(account, true)`, then set `settlementVerifierThreshold` to at least `2`.
4. Grant `MINT_EXECUTOR_ROLE` only to the dedicated instant executor; retain `DEFAULT_ADMIN_ROLE` on the custody Safe.
5. Configure independent native verifier KMS signers, the native policy baseline, verifier URLs, API tokens, and each verifier's `SETTLEMENT_ATTESTOR_*` credentials.
6. Deploy the verifier and bridge services and confirm their health checks.
7. Exercise one manual Safe withdrawal, then one capped instant withdrawal.
8. Enable the native route only after both verifier quorums and service health checks pass.

The native verifier policy must bind the source/destination chain IDs, source native bridge, destination representation bridge, enabled token routes, instant-lane cap, and policy baseline hash. Use separate KMS keys and IAM policy from EAB signing. Keep the Safe's admin permissions for manual settlement and recovery.

The existing bridge service still also requires its normal Safe envs:
- `SAFE_ADDRESS`
- `SAFE_PROPOSER_ADDRESS`
- `SAFE_PROPOSER_KMS_KEY_ID`
- `SAFE_PROPOSER_KMS_REGION`

### Step 8: Restart or redeploy the bridge service

After env/config changes, restart the bridge service so it picks up:
- the STRATO native bridge address
- the Sepolia native representation bridge address
- the relayer/operator credentials and RPC settings

## Fresh Deployment Sequence

For a new deployment, run these in order. Each item is covered by the detailed sections above and by concrete commands in the runbook below.

1. Collect STRATO and Sepolia admin addresses from `Naming`.
2. Prepare the STRATO `.env` in `app/contracts`.
3. Deploy the STRATO `StratoNativeBridge` proxy.
4. Upgrade the STRATO bridge proxy to `StratoNativeBridge`.
5. Deploy the STRATO `StratoNativeCustodyVault` proxy.
6. Upgrade the STRATO vault proxy to `StratoNativeCustodyVault`.
7. Initialize the STRATO bridge and vault.
8. Prepare the Sepolia `.env` in `app/ethereum`.
9. Run `npm ci` and `npm run compile` in `app/ethereum`.
10. Deploy the Sepolia `StratoNativeRepresentationToken` proxy.
11. Deploy the Sepolia `StratoNativeRepresentationBridge` proxy.
12. Verify the Sepolia bridge proxy EIP-712 domain returns `StratoNativeRepresentationBridge` and version `1`.
13. Execute the Sepolia Safe admin batch: token bridge role, transfer endpoint setup, attestation signer, threshold, optional attestation validity, and token mapping.
14. Confirm the Sepolia Safe batch worked.
15. Configure at least two destination attestation signers and a threshold of at least two.
16. Through STRATO governance, configure the corresponding settlement-attestor accounts and a threshold of at least two.
17. Configure the STRATO native route to point at the Sepolia representation bridge and token proxies.
18. Whitelist the STRATO custody vault for paused-token `transferFrom` and `transfer`.
19. Update verifier and bridge service config/env.
20. Restart or redeploy the verifiers and bridge service.
21. Run the native bridge smoke check.

## Command Runbook

The examples below are templates. Keep environment-specific addresses, amounts, Safe payloads, and saved deployment outputs in local deployment notes outside this committed runbook.

### STRATO: Deploy or Update Native Bridge Contracts

Run from `app/contracts`.

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
  --settlement-verifiers <STRATO_ATTESTOR_1>,<STRATO_ATTESTOR_2>,<STRATO_ATTESTOR_3> \
  --settlement-verifier-threshold 2 \
  --enabled true
```

The command is a dry run unless `--execute` is supplied. Review the generated
AdminRegistry calls, then have every required STRATO administrator run the same
command with `--execute`. The verifier accounts are the STRATO addresses derived
from each verifier's `SETTLEMENT_ATTESTOR_BA_USERNAME`; they are not the external
chain KMS signer addresses.

Use `--enabled false` to disable the STRATO-side route without changing the rest
of the route metadata.

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

### Sepolia: Deploy New Representation Contracts

Run from `app/ethereum`.

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

New representation tokens deploy with general transfers disabled. Include these token calls in the first Sepolia Safe admin batch:

```text
StratoNativeRepresentationToken.grantRole(<BRIDGE_ROLE>, <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>)
StratoNativeRepresentationToken.setTransferEndpoint(<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>, true)
```

Do not call `setTransfersEnabled(true)` until the sale or release condition is met. Keeping `transfersEnabled = false` blocks peer-to-peer transfers while `setTransferEndpoint` still lets users redeem through the representation bridge.

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

The V2 lane-bound implementation removes the V1 mint entry point. Grant `MINT_EXECUTOR_ROLE` to the dedicated instant executor in the same Safe upgrade batch; the Safe uses `DEFAULT_ADMIN_ROLE` for manual V2 mints:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: upgradeToAndCall(address newImplementation, bytes data)
args:
  newImplementation: <NEW_IMPLEMENTATION_ADDRESS>
  data: grantRole(MINT_EXECUTOR_ROLE, <NATIVE_MINT_EXECUTOR>)
```

After the upgrade, a manual V2 attestation submitted by the executor reverts with `AccessControlUnauthorizedAccount`, and changing `useInstantPath` invalidates the verifier signatures. The Safe may retain `MINT_EXECUTOR_ROLE` for recovery, but normal Safe proposals use the manual lane.

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

Representation token transfer gate:

Transfers are disabled by default. Keep them disabled until the sale or release condition is met. When ready to make the representation token transferable:

```text
target: <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
method: setTransfersEnabled(bool enabled)
args:
  enabled: true
```

Before enabling general transfers, mark the representation bridge as a transfer endpoint so users can redeem back to STRATO while peer-to-peer transfers remain blocked:

```text
target: <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
method: setTransferEndpoint(address account, bool allowed)
args:
  account: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
  allowed: true
```

If transfer control should be managed by a different address than the admin Safe, grant and optionally revoke `TRANSFER_ADMIN_ROLE` through the Safe.

```text
target: <SEPOLIA_REPRESENTATION_TOKEN_PROXY>
method: grantRole(bytes32 role, address account)
args:
  role: <TRANSFER_ADMIN_ROLE>
  account: <TRANSFER_ADMIN>
```

Representation bridge signer and threshold config:

```text
target: <SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
method: setAttestationSigner(address signer, bool enabled)
args:
  signer: <native-verifier-kms-signer-address>
  enabled: true
```

Each signer must be the address of a separately operated native verifier's KMS key. The bridge service holds no attestation private keys. The gas-paying executor must not be enabled as a signer.

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
CHAIN_11155111_NATIVE_MINT_EXECUTOR_ADDRESS=<gas-paying-executor-address>
CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_KEY_ID=<full-key-arn>
CHAIN_11155111_NATIVE_MINT_EXECUTOR_KMS_REGION=<aws-region>
CHAIN_11155111_NATIVE_VERIFIER_URLS=https://verifier-1.example,https://verifier-2.example,https://verifier-3.example
CHAIN_11155111_NATIVE_VERIFIER_API_TOKENS=<token-1>,<token-2>,<token-3>
```

Each verifier process additionally needs:

```bash
STRATO_NODE_URL=<eab-strato-node-url>
NATIVE_STRATO_NODE_URL=<native-strato-node-url>
NATIVE_VERIFIER_POLICY_PATH=/run/secrets/native-verifier-policy.json
NATIVE_REPRESENTATION_BRIDGE_ADDRESS=<SEPOLIA_NATIVE_REPRESENTATION_BRIDGE_PROXY>
NATIVE_ATTESTATION_SIGNER_ADDRESS=<this-verifier-kms-address>
NATIVE_KMS_KEY_ID=<this-verifier-kms-key-id>
NATIVE_KMS_REGION=<aws-region>
```

The bridge service validates that enough verifier endpoints are configured for `attestationThreshold()` and that its executor is not an enabled signer. Each verifier validates that its own KMS signer is enabled before serving requests.

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

## Native solver separation

The primary `StratoNativeBridge.sol` and `StratoNativeRepresentationBridge.sol`
implement standard native bridging, routing/fallback, cancellation/refunds, and
verifier authorization. They do not expose solver fills, announcements, claims,
or fee-bearing requests. `bridge-eab` does not read solver fee records.

The `.sol.solver` copies and `.test.js.solver`/`.test.sol.solver` tests preserve
develop solver source from `3bc358c78b` outside the normal build. They are not
deployment artifacts. The active Mercata solver tests and legacy `bridge` service remain
separate; do not point that service's solver flows at these native implementations.

Native V2 mint signatures bind the execution lane and signer-set version but no
solver fee fields. Upgrade the destination contract and update native verifiers
and `bridge-eab` together while native processing is stopped. Discard/rebuild
unexecuted proposals signed for a different ABI after verifying their on-chain
status. Do not replay old signed payloads against the new implementation.

On the checked testnet deployment, the active implementations are non-solver;
STRATO retains historical solver storage, including enabled flags and a completed
claim. This source must not reintroduce methods that consume those flags. Before
any other deployment, check for outstanding solver claims and bonds: this upgrade
does not migrate or settle them. Ethereum upgrade validation covers the
pre-solver layout; it does not authorize replacing a deployed solver layout.

## Native security activation checks

- Native executor signing uses AWS KMS for both instant mints and direct redemption
  refunds. Use an asymmetric `ECC_SECG_P256K1` / `SIGN_VERIFY` key. Grant the
  runtime role signing/public-key access to that exact key; keep key management
  separate. The public address must match the KMS public key. Do not configure
  `CHAIN_<id>_NATIVE_MINT_EXECUTOR_PRIVATE_KEY`; startup rejects it.
- Grant the executor only `MINT_EXECUTOR_ROLE` on the representation bridge.
  Startup rejects bridge administrative, pause, mapping, attestation and
  cancellation roles on the executor, and token admin/upgrade/transfer-admin/
  `BRIDGE_ROLE` permissions on configured representation tokens. Never grant
  direct token minting permission to an executor or verifier.
- The custody Safe must hold `DEFAULT_ADMIN_ROLE` for manual mints and
  `MINT_CANCELLER_ROLE` for cancellation. Existing proxies require an explicit
  `grantRole(MINT_CANCELLER_ROLE, <SAFE>)` governance transaction; upgrading does
  not rerun initialization. New deployments grant both during initialization.
- Each token must grant `BRIDGE_ROLE` to the representation bridge proxy.
  Verify role assignments again after any governance permission change.
- Every native refund verifier independently checks the original confirmed
  redemption event and policy route, in addition to the STRATO refund decision.
  Missing, disputed, immature or mismatched evidence cannot receive signatures.
- `STRATO_NODE_URL` serves EAB reads and attestation submissions;
  `NATIVE_STRATO_NODE_URL` serves all native reads, digest calls, submissions and
  receipt polling. If omitted, native uses `STRATO_NODE_URL`. Both must serve
  the configured STRATO network and the same OAuth account identity. Independent
  URLs support independent nodes; a shared upstream remains a common dependency.
- Upgrade/configure contracts and roles, then verifiers, then the bridge runtime.
  Do not restart the new runtime until KMS configuration and role checks pass.
  Run native plain/routed deposit and fallback, instant/manual withdrawal,
  cancellation-vs-mint, and refund acceptance tests before production activation.

### Native settlement digest RPC compatibility

The four STRATO native settlement/cancellation/refund getters use
`keccak256(abi.encode(...))`, matching the EAB pattern. This returns actual
32-byte data for `eth_call`; the previous variadic hash returned a SolidVM hex
string that the RPC encoder emitted as empty `0x` despite the `bytes32` return
type. Deposit IDs and storage layout are unchanged.

Upgrade the STRATO `StratoNativeBridge` implementation. No Sepolia or platform
upgrade is required for this correction. Verifiers must already contain the
native digest ABI fix; they read the digest from the contract. Existing
attestations use the old digest and do not satisfy the new quorum. Allow
verifiers to re-attest pending operations; do not resubmit deposits or copy old
attestation counts. Confirm the pending deposit's `getDepositSettlementDigest`
RPC result is exactly `0x` plus 64 hex characters, then verify fresh attestations
and the final routed/fallback event. A live post-upgrade check is still required;
local contract tests do not exercise the deployed RPC server.
