# External Asset Bridge Deployment

One EAB between one STRATO network and one supported external EVM chain. Same
reviewed commit on every machine. No liquidity migration. Do not upgrade an old
vault.

ExternalBridgeVault `1.0.0`. DepositRouter `3.2.0`.

For an existing MercataBridge network, also follow [EAB_CUTOVER.md](EAB_CUTOVER.md)
for intake cutoff, pending transactions, custody, application rollout, and rollback.

Wait for each AdminRegistry issue or Safe transaction to execute. Stop on
failure. Run the command `status` prints; do not invent flags.

## Files

After `bundle`, the only shared file is `deployment-bundle.json` plus its
SHA-256. Do not copy `generated/`, `.env` files, vote journals, or private keys.

| Who | Keep |
| --- | --- |
| Coordinator, before bundle | Editable `deployment-manifest.json`. Deploy and discovery write `external-deployment.json` and `deposit-plan.json` beside it. |
| After bundle, every persona | `deployment-bundle.json`, `<role>.json`, and that persona’s `.env` |
| Coordinator only | Safe Transaction Builder JSON under `generated/`. Import the paths printed in `safeChecklist` and the activation command. Other Safe owners sign in the Safe app. |
| Infra only | The env/policy template paths printed by `plan`. Render them through the secret manager. |

Never edit `generated/`. Use `generated/latest.json` only to find the current
report.

## Roles

**Coordinator** owns the manifest, bundle, Safe proposals, readiness, canary,
and evidence. Read-only STRATO credentials, external deploy key, RPC, and Safe
submit access. No administrator credentials, AWS credentials, verifier tokens,
or KMS signing.

**Administrator 1** is the first STRATO admin voter (`setup --role admin-1`).
**Administrator 2 and every later administrator** each use `setup --role admin-2`
with their own `--config` and `--env-file`. The CLI has no `admin-3` role; the
profile only labels that machine. Live AdminRegistry threshold is the source of
truth. If coordinator `status` prints `ADDITIONAL_ADMIN_VOTE`, another distinct
admin identity votes with a separate `admin-2` profile. Do not assume Admin 2 is
last.

**Infra deployer** owns AWS/IAM/KMS, DNS/TLS, images, secrets, three verifiers,
Runtime, and executor gas. Procedure:
[eab-infra](https://github.com/strato-net/eab-infra).

Safe owners are not a persona. Anyone with a Safe owner key signs independently
when a threshold is required.

## Rules

- Production: clean working tree, immutable image digests.
- Share only the bundle, its checksum, and printed commands.
- Both contracts start **unpaused**. Pause them in step 5 and keep them paused
  until the activation batch.
- The KMS proposer is a Safe delegate, not a Safe owner. Do not
  `addOwnerWithThreshold` for the proposer. The executor is not a Safe owner or
  verifier.
- AdminRegistry is the vote source of truth. Do not copy vote journals.
  Coordinator `status` counts live `IssueCreated` / `IssueVoted` events.
- The `--approve` hash binds the current rollout revision (manifest, policy,
  embedded deployment/plan, and rollout code), each READY call id and status,
  overall check readiness, and whether DepositRouter is paused. It has no
  wall-clock expiry. It does not by itself bind vault pause, verifier health,
  or vote counts. Never reuse a hash from an older `status` report.
- `autoRouteEnabled` stays `false` on every route. `migrateAmount` stays `"0"`
  unless migration has a separate approval.

## 0. Approve numbers

Amounts are raw token units. Verifier confirmations ≥ Runtime confirmations.
`maxPerWithdrawal`, `maxAutoWithdrawalAmount`, and `refillRate` must not exceed
`bucketCapacity`. `maxAutoWithdrawalAmount` must not exceed
`manualReviewThreshold`.

- STRATO network ID (decimal string) and external chain ID
- Safe
- STRATO guardian (EAB; a STRATO address)
- Vault pauser (Ethereum `PAUSER_ROLE`; default the Safe, not the STRATO guardian)
- Bridge operator and three settlement attestors (operator is not an attestor)
- STRATO dependencies and, after step 2, TokenRouter and EAB proxy addresses
- Routes, deposit/withdrawal/rebase flags (`autoRouteEnabled=false`)
- Min deposit, max auto deposit, max withdrawal, auto withdrawal, manual-review
  threshold, bucket capacity, refill, mint capacity/refill
- Confirmations, verifier threshold, authorization validity (1–1800s, match
  STRATO and vault)
- Canary route, amounts, success criteria, and whether withdrawals are in scope

Supported external networks:
`app/ethereum/scripts/lib/externalBridgeNetworks.js`.

## 1. Prepare

Owner: Coordinator, Infra, each administrator on their own machine

Node.js v22.12+. Same reviewed commit on every machine.

```bash
mkdir -p <ROLLOUT_DIRECTORY>
chmod 700 <ROLLOUT_DIRECTORY>
cd <STRATO_PLATFORM_REPOSITORY>
git rev-parse HEAD
git status --short

cd app/contracts
[ -f .env ] || cp .env.sample .env
# Fill NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
# GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD for *this* identity.
chmod 600 .env
npm install

cd ../ethereum
[ -f .env ] || cp env.example .env
# Fill the Hardhat RPC for the selected network, ETHERSCAN_API_KEY,
# ALCHEMY_API_KEY (only if using Mercata discovery), and the CHAIN_<ID>_*
# deployment addresses. Leave PRIVATE_KEY empty until the external deploy,
# then clear it.
chmod 600 .env
npm install
npm run compile
```

`app/contracts/.env` is required for `deployProxy`, `upgrade`, Cirrus inventory,
and rollout votes. `app/ethereum/.env` is required for Hardhat deploy and
explorer verification.

Testnet and production use separate accounts, keys, Safe, contracts, services,
and data directories.

Infra provisions five `ECC_SECG_P256K1` / `SIGN_VERIFY` keys (proposer,
executor, three verifiers) per eab-infra. Runtime uses workload identity.
Each verifier has its own role, key, RPCs, and STRATO attestor.

Before submitting STRATO deployment or governance transactions, fund each
administrator's STRATO address with vouchers or USDST for transaction fees.
External deployment gas is funded separately on the external chain.

Infra returns only:

```text
SAFE_PROPOSER_ADDRESS
EXTERNAL_EXECUTOR_ADDRESS
VERIFIER_1_AUTHORIZATION_SIGNER_ADDRESS
VERIFIER_2_AUTHORIZATION_SIGNER_ADDRESS
VERIFIER_3_AUTHORIZATION_SIGNER_ADDRESS
VERIFIER_1_BASE_URL
VERIFIER_2_BASE_URL
VERIFIER_3_BASE_URL
```

KMS ARNs, tokens, and AWS credentials stay with infra.

## 2. Deploy contracts

Owners: Coordinator, Administrator 1, additional administrators as required

Skip STRATO proxies only if reviewed proxies and implementations already exist.

From `app/contracts`. Each `deployProxy` / `upgrade` has two AdminRegistry
gates: contract creation, then (for `upgrade`) `Proxy.setLogicContract`. The
first administrator starts the command and **leaves that process running**. It
prints `Create-contract governance issue created: <issueId>` and waits for
`IssueExecuted`. Additional administrators open the STRATO Admin tab and vote
**that printed issue ID**. Same source and constructor arguments. Do not start a
second `deployProxy` or `upgrade` to cast a vote. Do not rerun a completed
creation or upgrade.

```bash
npm run deployProxy -- --empty --owner <ADMIN_REGISTRY_ADDRESS> --contract-file BaseCodeCollection.sol
npm run upgrade -- --proxy-address <TOKEN_ROUTER_PROXY> --contract-name TokenRouter --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS

npm run deployProxy -- --empty --owner <ADMIN_REGISTRY_ADDRESS> --contract-file BaseCodeCollection.sol
npm run upgrade -- --proxy-address <EXTERNAL_ASSET_BRIDGE_PROXY> --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

A successful `upgrade` submission is not a completed upgrade. After the
implementation address is printed, `setLogicContract` is submitted and still
needs quorum. Additional administrators vote that issue in the Admin tab for
the **recorded** implementation. If the process times out after implementation
creation, do not rerun `upgrade`; finish the create-implementation issue, then
submit `Proxy.setLogicContract` for that implementation in the Admin tab.

Before the next step, verify the live proxy `logicContract` equals the recorded
implementation. Do not proceed while it still points at the previous logic.

Coordinator deploys the vault and router. Permit2 defaults to the canonical
address if unset. Vault pauser is `CHAIN_<ID>_GUARDIAN_ADDRESS` (Ethereum
`PAUSER_ROLE`).

Hardhat RPC is the network’s `rpcEnv` from
`app/ethereum/scripts/lib/externalBridgeNetworks.js` (`SEPOLIA_RPC_URL`,
`MAINNET_RPC_URL`, `BASE_RPC_URL`, `LINEA_RPC_URL`, …).

```bash
<NETWORK_RPC_ENV>=<HTTPS_RPC>
PRIVATE_KEY=<DEPLOYER_PRIVATE_KEY>
CHAIN_<CHAIN_ID>_DEPLOYMENT_CONFIRMATIONS=<APPROVED_COUNT>
CHAIN_<CHAIN_ID>_SAFE_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_VAULT_DEFAULT_ADMIN_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_VAULT_UPGRADER_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_VAULT_POLICY_ADMIN_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_GUARDIAN_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_VAULT_UNPAUSER_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_VAULT_ATTESTATION_ADMIN_ADDRESS=<SAFE>
CHAIN_<CHAIN_ID>_LARGE_WITHDRAWAL_APPROVER_ADDRESS=<SAFE>
```

From `app/ethereum`:

```bash
npm run deployExternalBridge:<NETWORK> -- --rollout-dir <ROLLOUT_DIRECTORY>
# Production: CONFIRM_EXTERNAL_BRIDGE_DEPLOY=<CHAIN_ID>
npm run deployExternalBridge:<NETWORK> -- --rollout-dir <ROLLOUT_DIRECTORY> --execute
```

Writes `external-deployment.json`. Check `version()` is `1.0.0` (vault) and
`3.2.0` (router). Clear `PRIVATE_KEY`. Both contracts are unpaused until step 5.

Verify the **implementation** addresses from that JSON (`ETHERSCAN_API_KEY` in
`app/ethereum/.env`):

```bash
npm run verify:<NETWORK> -- <VAULT_IMPLEMENTATION>
npm run verify:<NETWORK> -- <ROUTER_IMPLEMENTATION>
```

### Inventory

Prefer a hand-written `deposit-plan.json` when there are no Mercata mappings, or
when you must not use Alchemy / the discovery `NODE_URL` override. One enabled
item per route. Status `2` is ACTIVE.

```json
{
  "operations": [
    {
      "chainId": 11155111,
      "transactions": [
        {
          "meta": {
            "items": [
              {
                "token": "0x<EXTERNAL_TOKEN>",
                "target": "0x<STRATO_TOKEN>",
                "isPermitted": true,
                "externalDecimals": "6",
                "externalName": "USD Coin",
                "externalSymbol": "USDC",
                "stratoTokenStatus": 2
              }
            ]
          }
        }
      ]
    }
  ]
}
```

Mercata discovery is optional. It **requires** `ALCHEMY_API_KEY` in
`app/ethereum/.env` even if chain RPCs are already set. `--env testnet` forces
`NODE_URL=https://node1.testnet.strato.nexus` (Helium). `--env prod` forces
`NODE_URL=https://app.strato.nexus`. It also needs `app/contracts/.env` OAuth
fields. You cannot point discovery at another STRATO host.

```bash
npm run router:ops:<testnet-or-prod> -- --step setters --chains <CHAIN_ID> --router-address <DEPOSIT_ROUTER> --safe-address <SAFE> --rollout-dir <ROLLOUT_DIRECTORY>
```

Ignore the script’s “re-run with `--apply`” line.

## 3. Freeze the bundle

Owner: Coordinator

```bash
cd <STRATO_PLATFORM_REPOSITORY>/app/ethereum
npm run external:rollout -- init --manifest <ROLLOUT_DIRECTORY>/deployment-manifest.json
```

First `init` copies the settings example. Fill STRATO settings and point
`externalDeployment` / `depositPlan` at the two files. Rerun the same `init`
command to expand. After `schemaVersion: 1`, do not run `init` again.

Then fill every `REVIEW_REQUIRED` value in the manifest: policy (including
`autoRouteEnabled=false`), three authorization signers, confirmations, three
verifier URLs and token **variable names**, proposer and executor addresses,
`bridgeHealthUrlEnv: "BRIDGE_HEALTH_URL"`. Never put token values in the
manifest. `BRIDGE_HEALTH_URL` itself is set later in `coordinator.env`.

```bash
npm run external:rollout -- plan --manifest <ROLLOUT_DIRECTORY>/deployment-manifest.json --output-dir <ROLLOUT_DIRECTORY>/generated --stage activation
npm run external:rollout -- bundle --manifest <ROLLOUT_DIRECTORY>/deployment-manifest.json --bundle <ROLLOUT_DIRECTORY>/deployment-bundle.json
```

Send the bundle and printed checksum to both administrators and infra. Keep the
editable manifest on the coordinator machine only.

## 4. Each persona sets up locally

Owner: Each persona

```bash
shasum -a 256 <LOCAL>/deployment-bundle.json
```

`setup` writes only the profile JSON. Create the env file **before** `chmod`.
Coordinator and each administrator need:

```text
CHAIN_<ID>_RPC_URL=<HTTPS_RPC>
OAUTH_URL=<DISCOVERY>
OAUTH_CLIENT_ID=<ID>
OAUTH_CLIENT_SECRET=<SECRET>
GLOBAL_ADMIN_NAME=<THIS_IDENTITY>
GLOBAL_ADMIN_PASSWORD=<PASSWORD>
```

Coordinator uses a read-only STRATO identity. After Runtime, add
`BRIDGE_HEALTH_URL=https://<RUNTIME_HOST>/health`. Infra does not need a rollout
`.env`.

From `app/ethereum`:

```bash
npm run external:rollout -- setup --role coordinator --config <LOCAL>/coordinator.json --manifest <LOCAL>/deployment-bundle.json --output-dir <LOCAL>/generated --env-file <LOCAL>/coordinator.env
npm run external:rollout -- setup --role admin-1 --config <LOCAL>/admin-1.json --manifest <LOCAL>/deployment-bundle.json --output-dir <LOCAL>/generated --env-file <LOCAL>/admin-1.env
npm run external:rollout -- setup --role admin-2 --config <LOCAL>/admin-2.json --manifest <LOCAL>/deployment-bundle.json --output-dir <LOCAL>/generated --env-file <LOCAL>/admin-2.env
# Each additional administrator:
npm run external:rollout -- setup --role admin-2 --config <LOCAL>/admin-<N>.json --manifest <LOCAL>/deployment-bundle.json --output-dir <LOCAL>/generated --env-file <LOCAL>/admin-<N>.env
npm run external:rollout -- setup --role infra --config <LOCAL>/infra.json --manifest <LOCAL>/deployment-bundle.json --output-dir <LOCAL>/generated
```

```bash
chmod 600 <LOCAL>/<ROLE>.json
# Skip if this persona has no env file (infra).
chmod 600 <LOCAL>/<ROLE>.env
export EAB_ROLLOUT_CONFIG=<LOCAL>/<ROLE>.json
```

Later printed commands run unchanged.

## 5. Pause and configure (Safe JSON)

Owners: Coordinator and required Safe owners

```bash
npm run external:rollout -- status
```

Coordinator imports **only** `safeChecklist` items still `PENDING`, in printed
order, into Safe Transaction Builder. Typical order:

1. `router-pause.json`
2. `vault-pause.json`
3. `router-tokens-N.json` (numeric)
4. `vault-configure.json`

Safe owners review and execute in the Safe app. They do not need the JSON
files. Coordinator reruns `status` until every Safe configuration item is
`DONE`. Keep both contracts paused.

## 6. Start verifiers and Runtime

Owner: Infra

### Fund STRATO transaction senders before starting services

Owners: Infra supplies the addresses; the STRATO funding-account owner sends
vouchers or USDST; Coordinator records the balance checks.

1. Resolve the STRATO address of each configured OAuth identity. Check these
   against the operator, relayer, and settlement-attestor addresses in the
   deployment configuration. Do not use their external KMS signer addresses.
2. Transfer vouchers or USDST on the **target STRATO network** to every address
   below. Each account needs its own fee reserve; the operator does not pay fees
   for the relayer or verifiers.

| STRATO account | Runtime credentials | Transactions requiring fees |
| --- | --- | --- |
| Operator | Bridge `BA_USERNAME` | Cursor updates and operator bridge operations |
| Relayer | Bridge `RELAYER_BA_USERNAME` | Settlement and other relayed contract calls |
| Verifier 1 attestor | Verifier 1 STRATO/OAuth identity | On-chain settlement attestations |
| Verifier 2 attestor | Verifier 2 STRATO/OAuth identity | On-chain settlement attestations |
| Verifier 3 attestor | Verifier 3 STRATO/OAuth identity | On-chain settlement attestations |

3. Verify the credited balances in Cirrus on the target network. For each bare
   STRATO address, query `BlockApps-Voucher-_balances` using the configured
   `VOUCHER_CONTRACT_ADDRESS`, and `BlockApps-Token-_balances` using the configured
   `USDST_ADDRESS`: filter `address=eq.<TOKEN_CONTRACT>` and
   `key=eq.<STRATO_ACCOUNT>`, with `select=balance:value::text`. Confirm funding
   is indexed before proceeding. Record each account, funding transaction,
   balances, and the agreed refill threshold in the deployment evidence.
4. Budget for repeated attestations, retries, and cursor updates, not just one
   canary. Confirm the network's current fee schedule; at 0.01 USDST per contract
   call, 1 USDST covers 100 calls. Check voucher coverage using the network's
   voucher fee rate separately.
5. Assign an owner to monitor and replenish **all five** STRATO accounts. Fund
   the external executor with external-chain native gas separately. KMS keys
   and AWS permissions do not provide STRATO transaction fees.

This is a **manual activation gate**. Current health checks do not prove all
five accounts are funded. The existing operator balance check does not cover
the relayer or attestors and runs with legacy withdrawal polling; do not rely
on it when that polling is disabled.

### Start services

```bash
npm run external:rollout -- plan
```

Render the **printed** verifier policy/env templates and `bridge.env.template`.
Each verifier: own KMS key, two distinct HTTPS RPCs, own STRATO attestor,
confirmations ≥ Runtime, unique token ≥ 32 characters. No `NODE_ENV`. `/health`
is public; signing requires the bearer token. Runtime: operator and relayer
OAuth, proposer/executor KMS, RPC/WS, `USDST_ADDRESS`, persistent `/app/data`.
Coordinator never receives verifier tokens.

Return only `BRIDGE_HEALTH_URL`. Coordinator adds it to `coordinator.env`.

Gate: three `/health` responses with matching chain/vault/index/signer/attestor,
policy digest, shared baseline hash, `verificationRpcHostCount >= 2`; Runtime
`status: true`.

## 7. STRATO governance

Owners: Coordinator and administrators

```bash
npm run external:rollout -- status
```

Status prints the current stage (`N/12`) and the next vote command. Coordinator
sends that command. The named administrator runs it unchanged. Coordinator
reruns `status`. Coordinator `status` reads live AdminRegistry events; it does
not need a copy of the voter’s `generated/` journal. When waiting for execution
or indexing, nobody votes again.

This path does not call `EAB.setPause`. Route flags come from the reviewed
policy.

## 8. Activate and canary

Confirm the five STRATO fee-balance checks from step 6 are recorded and still
sufficient before executing activation. Do not activate with an unfunded
relayer or verifier attestor, even if every `/health` response passes.

### Backend configuration gate

After STRATO governance completes, verify in Cirrus that the TokenRouter proxy
is initialized and `ExternalAssetBridge.tokenRouter` matches that proxy. Record
both verified **proxy** addresses under the target STRATO network ID in
`app/backend/src/config/config.ts`: `defaultExternalAssetBridgeFor` and
`defaultTokenRouterFor` (Helium `114784819836269`, Upquark `33056204878082667`).
Do not copy addresses between networks or release with empty target entries.

Build and deploy the backend image containing these defaults before the canary.
`EXTERNAL_ASSET_BRIDGE_ADDRESS` and `TOKEN_ROUTER` remain optional backend
overrides; if used, pass them into the backend container explicitly. A Compose
`.env` entry alone does not inject them. Bridge-service env configuration is
still required separately. Verify `/api/config` returns HTTP 200 on the app
hostname; `/health` alone checks node health and does not prove backend readiness.

Owners: Coordinator and required Safe owners

```bash
npm run external:rollout -- verify
```

Fix the named FAILED check. Live checks are `strato`, `external`,
`external-identity`, `deposit-router`, `withdrawal-pause`,
`safe-runtime-identities`, `vault-configuration`, `verifiers`, and
`bridge-health`. `verifiers` and `bridge-health` stay `DEFERRED` until
pre-activation governance completes; that is not a failure. When status prints
`COORDINATOR_GENERATE_ACTIVATION_TRANSACTION`, run that command unchanged.
Import the generated activation JSON.

**Withdrawals in the reviewed policy:** one batch, vault unpause then router
unpause. After execution, both external contracts are unpaused. Run the deposit
canary, then the withdrawal canary.

**Deposit-only:** router unpause only. The vault stays paused. Run the deposit
canary only. Do not send a withdrawal.

Representation tokens have 18 decimals. For a route with `externalDecimals` `D`
and `rebaseRequired=false`:

- STRATO amount `S = X * 10^(18-D)`
- External amount `X = S / 10^(18-D)` (truncates toward zero)

If `rebaseRequired=true`, stop and use a reviewed oracle conversion; do not
improvise.

Deposit of raw external `X`:

1. Record external user, vault custody, and STRATO user balances.
2. External user down by `X` plus gas; vault custody up by `X`.
3. STRATO user up by `S`. Verifier threshold met; one mint; retries do not mint
   again.

AUTO_ROUTE activation requires separate native-token and ERC-20 canaries
(ETH and USDC on Sepolia). Use the
deployed app, bridge, and verifiers; retain the external and STRATO transaction
hashes and balance changes for each test:

| Test | Required result |
|---|---|
| Plain deposit | Recipient receives the bridged source token in amount `S`, exactly once. |
| AUTO_ROUTE success | One `AutoRouted` event for the deposit identity; `finalToken` matches the requested token and `finalAmount >= minFinalOut`. Verify that token's recipient balance increase. |
| AUTO_ROUTE fallback | In a controlled testnet test, use a minimum above the executable quote. One `DepositActionFallback` event; recipient receives `fallbackToken` and `fallbackAmount`, with no successful `AutoRouted` event. |
| Reviewed recovery | After governance approval, confirm the existing deposit through the operations endpoint. Verify its routed or fallback outcome and recipient balance; retry must not mint twice. |

`DepositCompleted`, status `4`, and a successful `settleDepositWithRoute` call
also occur on fallback. They do not prove AUTO_ROUTE succeeded. Match
`AutoRouted` / `DepositActionFallback` by chain, router, and deposit ID. Missing
Cirrus metadata or unavailable quote dependencies must retry, then enter review
after the settlement grace period; they must not immediately trigger fallback.

Withdrawal of raw STRATO `S` under auto and bucket limits (withdrawals-on only):

1. Record STRATO user, escrow, supply, vault custody, recipient, and the vault
   reservation.
2. STRATO escrow of `S` (or the truncated equivalent that maps to whole
   external units). External recipient up by `X`. Vault custody down by `X`.
3. One `WithdrawalReleased` of `X`. Reservation remains `RELEASED` (status `2`);
   it is not deleted. `totalReserved` decreases by `X`. One STRATO burn. Retries
   do not pay or burn twice.

Unit tests and read-only quotes do not replace these deployed-API canaries.
Do not mark an unexecuted or fallback-only AUTO_ROUTE test as passed.

Pause on any mismatch.

## Existing EAB: remove the unused settlement proof argument

This interface update requires a matching EAB implementation and bridge image.
Do not deploy only the service. Keep the existing EAB proxy and storage.

1. Record pending deposit/withdrawal identities and the current implementation
   and image digests. Have infra stop the EAB runtime for the interface update.
2. From `app/contracts`, run the upgrade below. Complete both AdminRegistry
   gates described in step 2; additional administrators vote the printed issues.

```bash
npm run upgrade -- --proxy-address <EXTERNAL_ASSET_BRIDGE_PROXY> --contract-name ExternalAssetBridge --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

3. Verify the proxy points to the new implementation and its five settlement
   entrypoints have no `attestationProof` parameter. Storage, attestation digests,
   and verifier quorum must remain unchanged.
4. Deploy the matching bridge image, then start the runtime. No Sepolia contract
   or verifier-policy update is required for this interface change.
5. Verify a pending plain deposit reaches STRATO settlement through the real API.
   Deposits already in review require the reviewed-deposit recovery flow. Test
   AUTO_ROUTE, reviewed settlement, and withdrawal finalization before declaring
   the interface update complete. Do not re-deposit to recover a pending transfer.

## Failure handling

- Stale approval: `status`, use the new command.
- Waiting on another admin: the previous admin does not vote again.
- Waiting for indexing: nobody votes.
- Bundle checksum or tooling revision mismatch: stop; take the coordinator
  bundle / reviewed commit.
- Safe configuration `DONE` and services fail: fix services only.
- Verifier attestation or relayer submission fails with HTTP 422: inspect the
  downstream STRATO error and the submitting account's voucher/USDST balance.
  Fund that specific account if insufficient and verify the existing operation
  retries successfully. A generic 422 alone does not prove a funding failure;
  do not submit a second deposit or bypass attestations.
- Verifier token leak: rotate that verifier and Runtime secret; pause if more
  than one token or unexpected signatures appear.
- Identity mismatch: stop; do not override.
- Hard crash leaves `generated/.lock`: confirm no rollout command is still
  running, then `rm` that lock and rerun `status`.

## Completion

- Status shows governance complete and activation executed.
- STRATO and external state match the bundle.
- Verifier and Runtime health pass.
- Operator, relayer, and all three STRATO attestors have verified fee reserves
  and an assigned refill owner; successful canaries include on-chain attestation
  and relayer transaction hashes.
- Required canaries reconcile (deposit always; withdrawal only if enabled).
- Temporary credentials and allowlists removed.
- Retain bundle hash, tooling revision, addresses, policy hashes, issue IDs,
  transactions, image digests, and canary evidence.
