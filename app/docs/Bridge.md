## Bridge

Purpose: Cross-system token bridging into and out of STRATO.

Deployment scope: this is a fresh ExternalAssetBridge deployment with new proxies and no legacy deposits, withdrawals, or custody balances to migrate. Legacy cutover/drain procedures are not part of this rollout. Existing deployments, if present on the same network, remain independent.

Key contracts:
- `ExternalAssetBridge`: STRATO coordinator for non-native assets.
- `ExternalBridgeVault`: Pooled custody per external token and threshold-authorized releases on each external chain.
- `DepositRouter`: Emits uniquely numbered external deposits and transfers assets to the route vault.
- `TokenRouter`: Executes validated, bounded STRATO routes after bridge settlement.
- `StratoNativeBridge`: Unchanged native-asset bridge.
- `MercataBridge`: Independent legacy history and operations, outside this fresh deployment.

Non-native bridge-in:
1. The service detects every router event independently, keyed by `(externalChainId, depositRouter, depositId)`.
2. It waits for the configured confirmations, groups router events by external transaction, and verifies the canonical receipt and traces once. Every event must have one distinct sender/token/custody/amount movement in execution order; exact duplicate RPC evidence is deduplicated, while missing, reused, conflicting, or ambiguous evidence quarantines the entire transaction before any STRATO settlement.
3. Three independent verifier services validate the external event and custody movement against their own RPC providers and record STRATO attestations. After any two attest, any relayer may settle a plain deposit; recorded reviews additionally require digest-bound AdminRegistry approval. Routed and reviewed-routed deposits additionally require the bridge operator so an arbitrary relayer cannot select route steps or force source-token fallback. Both operations atomically record and complete the deposit while preserving `DepositInitiated` and `DepositCompleted`. ExternalAssetBridge converts the verified raw external amount to STRATO decimals and applies any required inbound rebase factor on-chain.
4. Save and Forge remain user-facing destinations, but both are TokenRouter routes encoded as `AUTO_ROUTE = 4`. Legacy action ordinals 2 and 3 are not executed by ExternalAssetBridge.
5. Before external submission the UI requires an authenticated STRATO account as recipient, connects the external wallet only as the external-chain signer, switches it to the selected chain, and states the exact STRATO source token and amount the recipient will receive if routing fails. DepositRouter accepts only `AUTO_ROUTE = 4` with a nonzero destination token and positive `minFinalOut`.
6. Deterministic quote or route-execution errors settle through `DepositActionFallback`. Transport errors remain retryable because submission may be ambiguous; RPC conflicts, permanently missing receipts and expired settlement retries enter persistent review/quarantine.
7. Reviewed deposits are re-verified and resolved through `confirmReviewedDepositWithRoute` (or source-token fallback), or owner-governed `abortDeposit`.

`externalTxHash` is metadata, not replay identity. Multiple deposits in one external transaction settle and report action outcomes independently.

Activity history enriches the canonical completion with `AutoRouted` or `DepositActionFallback` final-token data and labels it `Deposit & Trade` or `Deposit (Fallback)`. Direct STRATO routes are recorded from `TokenRouter.RouteExecuted`; Unified Trade displays those recent routes alongside pending and completed bridge deposits. Its STRATO source catalog includes every graph node with an outgoing route, including PSM-only assets, and reserves both STRATO call fees from maximum transferable USDST. Rewards continue to consume only `DepositCompleted` and its bridged source amount; action outcomes are presentation metadata and do not create a second reward.


External action intent is not separately signed by the external wallet; it is emitted by DepositRouter in the externally signed transaction. Each settlement verifier independently binds the deposit identity, STRATO recipient, source route, action, destination token and `minFinalOut` to that canonical event. Route steps are selected by the bridge operator but must execute through TokenRouter's approved dependencies and satisfy the attested destination token and absolute `minFinalOut`. Arbitrary relayers cannot select route steps or force fallback. Contract route allowlists, on-chain rebase accounting, replay protection and source-token fallback remain the execution bounds.

Non-native bridge-out:
1. `requestWithdrawal` escrows the STRATO token.
2. Routine withdrawals receive short-lived authorization from independent KMS/HSM signers.
3. The unprivileged executor reserves and releases route-local vault liquidity.
4. Independent verifier services confirm the exact vault `WithdrawalReleased` event. Multiple withdrawals may share an external transaction; replay protection is per withdrawal/reservation. Any relayer may finalize after two STRATO attestations, and only then is escrow burned.
5. Large withdrawals additionally require Safe review. Expired reservations can be cancelled. Governance refunds additionally require the configured STRATO verifier threshold to attest confirmed external non-payment: no reservation after authorization expiry, or a matching cancelled reservation. A recorded operator cancellation alone cannot authorize a refund or change the withdrawal out of READY. Release finalization remains possible after cancellation metadata is recorded. Refund attestations bind the verifier’s expected source-state digest, and stale submissions revert. The destination vault is captured in each authorization so later chain configuration changes cannot redirect recovery.

Operational controls:
- Deposit and withdrawal pause controls are independent.
- Every mint path consumes a shared bucket for its STRATO representation token, including routed, reviewed and fallback settlement. Missing policies block minting. Governance configures `setMintPolicy(token, capacity, refillRate)` in raw STRATO-token units; refill rate is units per second. Policy updates preserve existing consumption.
- Safe/AdminRegistry owns governance. The bridge operator coordinates detection, review and reservation state but cannot mint deposits or finalize withdrawal burns without the 2-of-3 verifier threshold.
- Every environment requires explicit positive confirmation counts, independent signer RPCs, and authenticated webhook and review-operation endpoints.
- Router rotation preserves prior router identities. A governance-aborted deposit ID remains final until owner governance separately calls `authorizeDepositReuse`. Reuse increments a per-slot generation: old attestations and in-flight submissions for the old generation cannot authorize a new settlement.
- Configure the bridge PriceOracle and mark the route rebase-required before enabling xStock. The flag is canonical for inbound division and outbound multiplication; required routes reject zero/missing factors.
- The service never mutates the observed external amount for rebasing. Missing factors fail only the affected settlement or review-record attempt; the remaining chain batch continues.
- TokenRouter-originated Forge and vault events are excluded from user activity and rewards attribution. The canonical ExternalAssetBridge completion attributes the deposit to its recipient without double counting.
- DepositRouter 3.2 or newer is required for native ETH `AUTO_ROUTE`.


Quote and service boundaries:
- Anonymous trade, route and composite quote responses share a bounded 128-entry, one-second cache, including identical in-flight requests. Failures are not cached. Authenticated quotes bypass it; contract checks remain authoritative if state changes after quoting.
- Anonymous route assets do not query account balances. Composite quotes require deposits enabled on the selected route. The UI binds the quote to selected input/output tokens, amount, slippage and expiry; Permit2 deadlines do not exceed quote expiry, and expiry is checked again before submission. Native deposits have no on-chain quote deadline; the positive minimum output remains enforced.
- Quote calls to the app backend carry no operator bearer token. Verifier, webhook and operations endpoints require bearer tokens of at least 32 characters and compare their hashes in constant time before parsing request bodies. Each authentication scope allows 120 authenticated requests per minute and 30 failed authentication attempts per peer per minute; rate-limited requests return 429. Peer addresses come from the socket, not forwarded headers. Deploy upstream connection limits as well.
- Safe review proposals are journaled under `data/safe-reviews` before publication. Keep this directory on the persistent service volume. Restart recovery checks the recorded Safe hash and republishes the same signed payload only on a 404; outages fail closed. Expired approvals allow a new proposal. Nonce allocation is serialized per chain/Safe and includes journaled proposals not yet indexed by Safe. Run one proposing bridge instance per shared state directory; this is not a distributed lock. Preserve corrupt journals and restore verified payloads from backup/Safe evidence before retrying.
- The bridge image runs as `node`; persistent data mounts must be writable by that user. Generated `scripts/output/` plans are ignored by Git; retain reviewed copies outside the repository.
- Backing-invariant monitoring and governance-event alerting are deferred and are not supplied by this deployment tooling.


Follow-up TODO:
- Deploy three isolated verifier instances per external chain with distinct RPC providers and STRATO identities. Complete production key isolation, scoped credentials, rotation, monitoring and incident-recovery procedures for verifier, executor and governance authorities.

### Fresh deployment prerequisites

Use reviewed addresses and chain IDs for the target environment. Deploy new TokenRouter and ExternalAssetBridge proxies under AdminRegistry, then install their implementations; creation and upgrades require the votes listed below. Deploy a new ExternalBridgeVault (version 2.0.0) and DepositRouter (3.2 or newer) using the external deployment tool and retain its deployment JSON.

Run legacy route discovery without `--apply` and retain the resulting audit JSON as inventory only. Do not execute its discovery-time Safe batches: minimum deposits must come from the reviewed rollout policy. Keep the new DepositRouter paused until configuration, KMS/verifiers, live verification and activation gates pass. Existing legacy custody remains independent; every migration amount stays zero.

Run the contract, backend, bridge and rollout test suites before generating production artifacts. Use the resumable command below for the initial deposit-only activation. Withdrawal enablement and AUTO_ROUTE enablement require separate reviewed configuration and governance after their canaries pass.

Legacy MercataBridge incident operations remain available independently: owner-governed `cancelAndSweepWithdrawal` and its batch variant move INITIATED/PENDING_REVIEW escrow to a triage wallet and mark it SWEPT. Never whitelist these operations for the relayer; reject any associated external Safe proposal before sweeping pending-review escrow. These operations do not apply to ExternalAssetBridge.

### Refund evidence and RPC identity

Verifier startup reads the external RPC's actual `eth_chainId` and STRATO metadata `networkID` and requires exact matches to `DESTINATION_CHAIN_ID` and `SOURCE_CHAIN_ID`. Network IDs are compared as integers without conversion to JavaScript Number. Each `/v1/attest-refund` request repeats the identity checks and reads the original vault at a block with `VERIFIER_CONFIRMATIONS` confirmations. Current expiry and signer-set checks are not used to invalidate historical release evidence.

`npm --prefix app/contracts run refund:external-withdrawal -- --bridge-address <bridge> --withdrawal-id <id>` now performs read-only evidence checks even without `--execute`. Supply STRATO OAuth settings, `NODE_URL`, `SOURCE_CHAIN_ID`, `CHAIN_<id>_RPC_URL`, and a positive `CHAIN_<id>_DEPOSIT_CONFIRMATIONS`. The output includes the original authorization, vault, reservation state and confirmed block. With `--execute`, also supply the chain's HTTPS verifier URLs and API tokens; the tool first collects refund attestations, then submits the governance vote. The contract independently enforces the configured attestation threshold at execution. A reserved or released vault reservation is never acceptable refund evidence.

### Withdrawal token buckets

Each external vault token policy uses `bucketCapacity` (raw token units) and `refillRate` (raw token units per second). Both must be positive; `refillRate` and a nonzero `maxPerWithdrawal` must not exceed capacity. The limit applies equally to routine and Safe-approved withdrawals. Safe approval remains an additional requirement for large withdrawals and cannot bypass capacity checks.

Reservations hold capacity and liquidity until release or cancellation. Only released consumption decays over time; pending reservations never replenish. Release converts a hold into consumption, while cancellation frees the hold exactly once. Capacity checks and holds are atomic in the vault.

`withdrawalCapacity(token, amount)` returns available capacity and estimated retry seconds assuming no competing withdrawals. A retry of `uint256.max` means outstanding reservations must release or cancel first. A request above the maximum capacity is rejected rather than assigned a misleading wait time. The bridge service checks capacity before marking a new withdrawal ready and logs the retry estimate while leaving it pending. Existing authorized withdrawals retain their expiry and recovery rules; capacity races are still enforced by the vault, and an expired unpaid authorization follows the existing attested-refund flow.

Safe policy changes and emergency pause remain immediate; no timelock is added. Policy updates first accrue refill under the old rate, preserve remaining consumption, and cannot lower capacity below outstanding reservations. A reduction below already-consumed capacity blocks new reservations until sufficient capacity returns; existing holds remain executable subject to pause, token enablement, and authorization expiry.

This configuration is for new vault deployments. Replace old `windowLimit`/`windowSeconds` settings with reviewed bucket values; the refill rate is not a duration. The example rate is illustrative, and generated rollout policies require explicit review. No live limits or deployments are changed by updating these files.

### Resumable deposit-only deployment command

Use `external:rollout` to coordinate the existing configuration tools from one
manifest. It starts from deployed contracts and the existing legacy-route discovery
JSON; AWS provisioning, contract deployment, and Safe execution remain separate.
No command provisions cloud resources, migrates liquidity, or submits a deposit.

#### Approval requirements by deployment step

For an AdminRegistry-owned deployment, use the following approval gates.
**Admin votes** means distinct STRATO administrators voting on the same target,
function, and arguments until that issue's configured threshold executes it.
**Safe approvals** means external-chain Safe owner signatures meeting its threshold,
followed by successful execution. Neither a local `--approve` hash nor a successful
vote receipt substitutes for either governance threshold.

| Step | Approval required | Completion gate |
| --- | --- | --- |
| A1–A2: tests and identity preparation | No on-chain votes for tests or recording identities. Any change to AdminRegistry membership requires its own admin votes. | Tests pass; identities and permissions are established. |
| A3: create TokenRouter proxy (`deployProxy --empty`) | **Admin votes — contract creation.** Retain the create-contract issue ID. | Creation issue executes and the proxy address is recovered from its execution receipt. |
| A3: install TokenRouter (`upgrade`) | **Admin votes — implementation creation, then separate admin votes — proxy `setLogicContract`.** | Implementation exists, then the proxy's live logic address matches that implementation. |
| A4: create ExternalAssetBridge proxy (`deployProxy --empty`) | **Admin votes — contract creation.** Retain this separate issue ID. | Creation issue executes and the proxy address is recovered. |
| A4: install ExternalAssetBridge (`upgrade`) | **Admin votes — implementation creation, then separate admin votes — proxy `setLogicContract`.** | Implementation exists, then the proxy's live logic address matches that implementation. |
| A5: initial external-chain vault/router deployment | Deployer transaction authorization; no STRATO admin votes or Safe signatures for initial deployment. Subsequent upgrades of Safe-controlled proxies require **Safe approvals**. | Deployment receipts, confirmations, code and ownership checks pass. |
| A6–A9: route discovery, policy review and artifact generation; `init` / `plan` | No on-chain votes. Risk policy still requires operator review. | Validated artifacts match the reviewed manifest. |
| A10: pause/configure DepositRouter | **Safe approvals** for the pause transaction and each token/route configuration batch. | Each batch executes successfully; paused-state verification passes. |
| A11: initialize STRATO contracts | **Admin votes for every call:** TokenRouter `initialize`, each `setYieldVault`, ExternalAssetBridge `initialize`, `setPriceOracle`, `setTokenRouter`, each `setSettlementVerifier`, and `setSettlementVerifierThreshold`. | Respect dependencies and wait for each issue to execute; initialization verification passes. |
| A11: grant token permissions | **Admin votes for every generated AdminRegistry `addWhitelist` call**, including required mint/burn permissions. | Live permission verification passes before route configuration. |
| A11: configure STRATO chains/routes | **Admin votes for each `setMintPolicy`, each `setChain`, each `setRoute`, and each `setRouteRebaseRequired`**, including an explicit `false`. | Route verification passes; withdrawals remain disabled. |
| A11: deposit actions, if a setter is needed | **Admin votes for every `setDepositAction` submitted.** Verification alone needs no vote; already-disabled actions are skipped. | Action verification passes; actions remain disabled for this rollout. |
| A12: pre-KMS verification | No votes. | All required reports pass. |
| B: AWS/KMS, secrets and workload provisioning | AWS/IAM deployment authorization; no on-chain votes for provisioning alone. | Infrastructure and workload checks pass. |
| B/C: add the proposer as a Safe owner or change Safe threshold, if needed | **Safe approvals.** | Live Safe owners and threshold match the reviewed configuration. |
| C: pause/configure external vault after KMS binding | **Safe approvals** for the generated vault pause/configuration transactions: source bridge, signer registrations, threshold, authorization validity and token policies. | Transactions execute; live vault verification passes. Keep the vault paused in this deposit-only rollout. |
| C: deploy service configuration; `resume` / `verify` | Workload deployment authorization; no on-chain votes for configuration files or read-only checks. Any changed STRATO setter still requires **admin votes**; changed Safe-controlled settings require **Safe approvals**. | Services and consolidated live checks pass. |
| C: `activate` and execute DepositRouter unpause | `activate --approve` only generates the file. **Safe approvals and execution are required to unpause.** | Unpause receipt succeeds, then live verification observes the expected active router. |
| C: canary deposit and reconciliation | Depositor transaction authorization; no admin votes for the normal deposit. | Custody and STRATO issuance reconcile before declaring launch complete. |

For A3/A4, creation itself may wait for governance before the script can proceed.
The deployment helpers print the creation issue ID and wait for `IssueExecuted`.
Other administrators must approve that same pending proposal using their own
credentials. Preserve the exact source and constructor arguments. Do not rerun a
completed creation to obtain another vote: that can create another contract.
For the second upgrade gate, all administrators must approve `setLogicContract`
with the **same recorded implementation address**; do not rerun the entire upgrade
script after implementation creation merely to cast this vote. A timeout while
waiting for quorum is not proof that the proposal failed or was cancelled.

Deployment and upgrade votes remain outside `external:rollout`. Its `vote` command
handles the initialization, permissions, routes and action calls listed above.
Each participating administrator runs it with their own token and a freshly
reviewed report. Rerun `resume` after quorum executes a dependency to reveal the
next READY calls. The required number of admin votes comes from the live
AdminRegistry policy, not the bridge's two-of-three settlement verifier threshold.

Before generating artifacts, set `sourceChainId` explicitly and add `bridgeTemplate` to the settings JSON. It must point to a reviewed environment-specific template containing the STRATO dependencies, including `externalAssetBridge.tokenFactory`, `externalAssetBridge.usdst`, and `externalAssetBridge.priceOracle`. No template or node URL is selected automatically. Set `services.nodeUrl` explicitly in the manifest. Execution and verification check live network metadata, dependency contract types, and the active USDST token’s factory association.

Complete `policy.mintPolicies` for every STRATO representation token:

```json
{
  "mintPolicies": {
    "0x<STRATO_TOKEN_ADDRESS>": {
      "capacity": "<RAW_STRATO_TOKEN_UNITS>",
      "refillRate": "<RAW_STRATO_TOKEN_UNITS_PER_SECOND>"
    }
  }
}
```

**AdminRegistry votes required:** the route plan includes `setMintPolicy` calls. Complete these votes before deposit activation; `verify-routes` checks the live policies. Use the same policy for a STRATO token shared by multiple external chains.

All generator modes enforce rollout validation. The default `--stage initial` keeps withdrawals and AUTO_ROUTE disabled. For the fresh guide’s withdrawal-enabled configuration, explicitly use `--stage activation`; this allows withdrawal routes while retaining the zero-migration and disabled-AUTO_ROUTE checks. Generate configuration before activation and retain the pause/canary sequence. Regenerate artifacts after these contract/configuration changes.

Run each command from the repository root. Import your existing settings and
reviewed policy once; omit `--policy` to create policy placeholders for review:

```bash
(cd app/ethereum && npm run external:rollout -- init \
  --settings /secure/eab-settings.json \
  --policy /secure/external-bridge-rollout-policy-11155111.json \
  --manifest /secure/eab-deployment.json)
```

Edit **only the deployment manifest**, not generated artifacts. It contains the
existing settings, inline token/route policy, `authorizationSigners` (empty before
KMS, then three addresses), and these service bindings:

```json
{
  "nodeUrl": "https://<STRATO_NODE_HOST>",
  "rpcUrlEnv": "CHAIN_11155111_RPC_URL",
  "sourceTokenEnv": "ACCESS_TOKEN",
  "confirmations": 64,
  "safeProposerAddress": "<KMS_PROPOSER_ADDRESS>",
  "executorAddress": "<KMS_EXECUTOR_ADDRESS>",
  "bridgeHealthUrl": "https://<BRIDGE_HOST>/health",
  "verifiers": [
    { "url": "https://<VERIFIER_1_HOST>", "tokenEnv": "VERIFIER_1_API_TOKEN" },
    { "url": "https://<VERIFIER_2_HOST>", "tokenEnv": "VERIFIER_2_API_TOKEN" },
    { "url": "https://<VERIFIER_3_HOST>", "tokenEnv": "VERIFIER_3_API_TOKEN" }
  ]
}
```

The example confirmation count is illustrative: approve it independently of
contract-deployment confirmations. The order of endpoints, KMS signer addresses,
and STRATO settlement verifiers must match. `sourceChainId` remains a decimal
string. Importing an old window-based policy does not convert its risk limits:
replace those fields with reviewed bucket capacity/refill values first.

Set the named access-token/RPC/verifier-token environment variables through your
secret manager. Only variable **names**, never secret values, go in the manifest.
The source token used for `vote` must belong to the administrator casting that
vote; each administrator authenticates independently. An empty verifier list is
allowed for pre-KMS planning, but cannot pass activation verification.

```bash
# Offline generation is the default; no chain/RPC calls or votes.
(cd app/ethereum && npm run external:rollout -- plan --manifest /secure/eab-deployment.json)

# Fresh live reconciliation: completed, ready, blocked, and failed checks.
(cd app/ethereum && npm run external:rollout -- resume --manifest /secure/eab-deployment.json)

# ADMIN VOTES REQUIRED: each participating administrator uses their own token.
# Submit only READY calls; wait for quorum execution, then rerun resume.
(cd app/ethereum && npm run external:rollout -- vote \
  --manifest /secure/eab-deployment.json --approve <APPROVAL_HASH>)

# Consolidated read-only verification; nonzero exit while gates are unmet.
(cd app/ethereum && npm run external:rollout -- verify --manifest /secure/eab-deployment.json)

# SAFE APPROVALS REQUIRED after export; this command does not unpause.
# Recheck gates, then export the Safe unpause transaction.
(cd app/ethereum && npm run external:rollout -- activate \
  --manifest /secure/eab-deployment.json --approve <APPROVAL_HASH>)
```

Use the `approvalHash` printed by `resume`, after inspecting its full report and
exact READY calls. A vote is not proof that quorum executed the governed call.
Rerun `resume` after each administrator/Safe approval round; only the live state
marks calls complete. Initialization conflicts and changed existing chain bindings
require explicit corrective governance rather than replay. An advanced polling
cursor is accepted and preserved; it is never reset by resumption.

The command generates:

- STRATO/vault JSON, three identity-bound verifier policies, and service environment
  templates with derived addresses and unresolved secret references. Resolve these
  templates through the existing deployment secret renderer; they are not a new
  Secrets Manager integration and must not be deployed with unresolved references.
- Safe pause, token configuration, and (after KMS binding) vault configuration files.
  Review their targets/arguments and execute only pending configuration. Safe files
  may contain already-applied setters after a partial batch; compare the live report
  before executing. No unpause file is generated by ordinary planning.
- Revision-scoped artifacts, immutable hashes, per-administrator vote journals,
  timestamped reports, and a `deployment/latest.json` pointer beside the manifest.
  `--output-dir` selects another directory. Keep it outside the repository and
  retain it across operator sessions.

For later AUTO_ROUTE enablement, update the reviewed manifest policy and pass `--stage activation` to each helper command (`plan`, `resume`, `vote`, `verify`, and `activate`). This regenerates bridge and verifier policies under a new approval revision; deploy those verifier policies before voting. Keep the external router and vault paused during configuration. Enable votes require matching initialization/routes/permissions, a fresh pre-enable action check (remaining actions disabled), and verified external configuration and service policies. After quorum, `verify-actions` checks the desired enabled state before the helper can export the router unpause transaction. The standalone policy generator also requires `--stage activation`. Migration amounts must remain zero.

Changing inputs, discovery/deployment files, or orchestration code produces a new
revision and invalidates approvals. Editing generated files is rejected even if
someone edits the stored hash index. Review and correct the manifest instead.
Do not independently modify contracts while a voting round is in progress.

Transaction hashes are journaled immediately after broadcast. After interruption,
recorded receipts are checked before another vote; successful receipts wait for
quorum instead of resubmitting. An uncertain submission without a returned hash,
or a failed/unavailable receipt, stops automatic retry and requires reconciliation.
Preserve the journal and use node transaction/administrator vote evidence; never
clear an uncertain entry merely to bypass the stop. A stale `.lock` similarly
requires confirming the previous orchestration process is no longer running before
removing that lock alone. The lock is local to the selected output directory;
coordinate operators rather than assuming it is a distributed deployment lock.

Verification checks STRATO chain identity, initialization, ACTIVE tokens, mint/burn
permissions, routes/actions and cursors; current external implementation bytecode
against local Hardhat artifacts; vault pause/configuration/roles; Safe proposer and
threshold; router configuration; verifier identity/file digests/baseline/finality;
and bridge health. Compile the approved external contracts before a live check.
Reconciliation understands an already-unpaused DepositRouter without weakening the
existing standalone scanner's default paused-state requirement.

Health metadata does not independently prove AWS account separation, IAM controls,
KMS availability, source-code provenance on STRATO, or ongoing dependency health.
Retain those infrastructure/startup checks and the canary balance reconciliation.
`DEPOSITS_ACTIVE_CANARY_REQUIRED` deliberately does not mean launch complete.
`activate` never executes Safe or submits the canary, and withdrawals/actions remain
disabled. Unpausing opens every permitted route in the reviewed policy.

Tests:

```bash
(cd app/ethereum && npm run external:orchestration:test)
```

### Deployment checks for this security revision

1. Deploy the updated EAB and vault for this fresh deployment. Use only 18-decimal STRATO representation tokens.
2. Set each verifier's `VERIFIER_RPC_URL` and `VERIFIER_INDEPENDENT_RPC_URLS` to at least two distinct HTTPS hosts. Every endpoint must support receipts, contract reads and native-deposit traces. Startup verifies network identity; conflicting or unavailable evidence stops signing. `/health` must report `verificationRpcHostCount >= 2`.
3. Generate fresh verifier policies; startup recomputes the baseline hash from the actual policy fields. Set STRATO and vault authorization validity to the same value, at most 1800 seconds. STRATO abort delay cannot exceed 172800 seconds.
4. Complete the generated **AdminRegistry votes** for `mint` and `burn` permissions before enabling routes. Unpause the token before processing withdrawal refunds; token pause intentionally blocks escrow transfers. Retain the persistent Safe-review journal across restarts.
5. Set unique verifier, webhook and operations bearer tokens with at least 32 characters. Their authentication runs before request-body parsing and is rate limited.

For each pending deposit requiring review: inspect the recorded deposit, read `getReviewedDepositDigest(chainId, depositRouter, depositId)`, then obtain **AdminRegistry quorum** for `approveReviewedDeposit(chainId, depositRouter, depositId, expectedDigest)`. After execution, run the existing deposit-confirm operation to obtain verifier attestations and settle. PENDING_REVIEW alone never grants approval; reuse or verifier-set changes require a fresh digest approval. Withdrawal verifier review dissent always routes to the existing Safe approval flow.
