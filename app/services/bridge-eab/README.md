# STRATO EAB and Native Routing Service

This package runs EAB deposits and withdrawals, native bridge routing, and the independent EAB verifier entry point. Legacy MercataBridge processing lives in `../bridge` and is not started by this service.

## Service separation and deployment

- `app/services/bridge` is the legacy service, restored unchanged from `origin/develop` at `9b07be8f06`.
- `app/services/bridge-eab` owns this branch's EAB, verifier, and native routing implementation.
- Build from the repository root with `make bridge-eab bridge-eab-nginx`; the legacy targets remain `make bridge bridge-nginx`.
- `make docker-compose-bridge-eab` renders the EAB runtime and verifier templates. `BRIDGE_IMAGE` and `BRIDGENGINX_IMAGE` can still override images by digest, including images published to existing ECR repositories.
- Verifiers use the EAB image with `node dist/signer/index.js`. The runtime uses `node dist/index.js`.
- Keep the existing compose project/service names, `/app/data` mount, and persisted cursors when replacing an EAB image. Do not copy legacy cursors into the EAB data directory. This source split requires no cursor reset or contract upgrade.
- Local `.env`, data directories, and credentials are not moved. Configure this package explicitly; never use a legacy private-key proposer configuration for its KMS proposer.
- Only one runtime should process native transfers for each network. This package does not implement develop's solver/fast-path protocol. Contract compatibility and any native ownership switch are separate release decisions.
- Infrastructure build/provenance checks must use `app/services/bridge-eab` (including `src/signer`) and its Dockerfile. The `eab-infra` scripts and deployment records are not changed by this source-only split.

## Features

* **Dynamic Chain Support**: Automatically detects and configures RPC endpoints for all enabled chains from the bridge contract
* **Safe Governance Integration**: Uses Safe governance for large-withdrawal approval and reviewed-deposit aborts
* **External Vault Releases**: Reserves and releases routine non-native withdrawals using threshold-signed vault authorizations
* **Real-time Monitoring**: Polls blockchain events and transaction statuses across all supported chains
* **Bridge Out Flow**: STRATO → external-chain transfers through route-local vaults, with manual review for large withdrawals
* **Bridge In Flow**: External-chain → STRATO settlement with optional one-click TokenRouter execution
* **Dynamic Asset Management**: Fetches enabled assets and chain information from on-chain bridge contract
* **Email Notifications**: Sends transaction alerts to configured email addresses
* **Comprehensive Logging**: Secure and contextual logging using Winston
* **OAuth Integration**: Secure authentication with STRATO using OpenID Connect

## Prerequisites

- Node.js 18 or higher
- Access to Alchemy API for Ethereum networks
- Gnosis Safe multisig wallet
- Safe owner private key
- STRATO OAuth credentials

## Installation

1. Clone the repository
2. Navigate to the bridge service:
```bash
cd app/services/bridge-eab
```

3. Install dependencies:
```bash
npm install
```

4. Copy the example environment file and update the values:
```bash
cp .env.example .env
```

## Configuration

### Required Environment Variables

#### Authentication
- `BA_USERNAME` - BlockApps username
- `BA_PASSWORD` - BlockApps password
- `CLIENT_SECRET` - OAuth client secret
- `CLIENT_ID` - OAuth client ID
- `OPENID_DISCOVERY_URL` - OpenID discovery endpoint
- `RELAYER_BA_USERNAME`, `RELAYER_BA_PASSWORD` - Separate unprivileged STRATO settlement relayer account
- `RELAYER_CLIENT_ID`, `RELAYER_CLIENT_SECRET`, `RELAYER_OPENID_DISCOVERY_URL` - OAuth client configuration for the relayer account

The operator account records reviews, marks withdrawals ready and submits routed settlements. The relayer account can only submit threshold-attested plain deposit settlements and withdrawal finalizations. Startup rejects use of the same STRATO account for both roles or use of a settlement verifier as the relayer.

#### Blockchain
- `ALCHEMY_API_KEY` - Alchemy API key (used for all chains)
- `EXTERNAL_ASSET_BRIDGE_ADDRESS` - ExternalAssetBridge proxy address used for non-native deposits
- `EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS` - Safe approval validity for large withdrawals (defaults to seven days)
- `STRATO_APP_API_URL` - Backend base URL used to refresh executable `AUTO_ROUTE` quotes
- `TOKEN_ROUTER` - Initialized TokenRouter address; startup requires it to match `ExternalAssetBridge.tokenRouter`

#### Chain RPC URLs (Dynamically Validated)
The service automatically validates that RPC URLs are configured for all enabled chains from the bridge contract:

- `CHAIN_11155111_RPC_URL` - Sepolia RPC URL (e.g., `https://eth-sepolia.g.alchemy.com/v2`)
- `CHAIN_1_RPC_URL` - Ethereum mainnet RPC URL (if using mainnet)
- `CHAIN_${chainId}_RPC_URL` - RPC URL for any additional enabled chains

#### Safe Wallet
- `SAFE_ADDRESS` - Gnosis Safe wallet address
- `SAFE_PROPOSER_ADDRESS` - Safe Proposer address
- `SAFE_PROPOSER_KMS_KEY_ID` - AWS KMS key ID or alias for the Safe proposer
- `SAFE_PROPOSER_KMS_REGION` - AWS region containing the Safe proposer key

The bridge workload calls AWS KMS directly with its IAM role. No AWS access key, bearer-authenticated signing adapter, or Safe proposer private key is loaded by the service. The KMS public key and every returned signature are checked against `SAFE_PROPOSER_ADDRESS`.

The same proposer is used for native-bridge and ExternalAssetBridge Safe proposals
on a combined Runtime. Register it as a Safe Transaction Service delegate; it must
not be an on-chain Safe owner. Safe owners still review, sign, and execute proposals.

The separately run Ethereum `depositRouterSafeOps.js` deployment and upgrade tooling still accepts `SAFE_PROPOSER_PRIVATE_KEY`. This is an offline operational exception and must not share the bridge-service runtime or environment.

#### Native Bridge Minting
MercataBridge withdrawals are handled only by the legacy service. `BRIDGE_ADDRESS` and `LEGACY_WITHDRAWAL_POLLING_ENABLED` are not used by this package.

- `STRATO_NATIVE_BRIDGE_ADDRESS` - STRATO native bridge proxy address
- `CHAIN_${chainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS` - External representation bridge address for each native route chain
- `CHAIN_${chainId}_NATIVE_BRIDGE_PRIVATE_KEY` - Destination-chain key used to pay gas and sign native mint attestations
- `CHAIN_${chainId}_NATIVE_BRIDGE_PRIVATE_KEY_1`, `_2`, ... - Optional additional destination-chain signer keys when the destination bridge attestation threshold is raised

Native withdrawal review delay and attestation validity are enforced by the native bridge contracts, not bridge-service environment variables.

#### External Vault Releases
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS` - Unprivileged destination-chain gas executor address
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID` - AWS KMS key ID or alias for executor signing
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION` - AWS region containing the executor key
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS` - Comma-separated HTTPS URLs for three independent verifier services
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS` - Comma-separated distinct tokens in the same order as the verifier URLs

The executor workload calls AWS KMS directly through workload identity and verifies each signature against `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS` before broadcasting.

Run each verifier independently with `npm run start:verifier`. Each process must use its own `VERIFIER_RPC_URL` plus comma-separated `VERIFIER_INDEPENDENT_RPC_URLS` (at least two distinct HTTPS hosts in total), AWS workload identity (`KMS_KEY_ID`, `KMS_REGION`, `VAULT_AUTHORIZATION_SIGNER_ADDRESS`), local `VERIFIER_POLICY_PATH`, inbound `EXTERNAL_BRIDGE_VERIFIER_API_TOKEN`, and STRATO settlement-attestor OAuth account (`SETTLEMENT_ATTESTOR_OPENID_DISCOVERY_URL`, `SETTLEMENT_ATTESTOR_CLIENT_ID`, `SETTLEMENT_ATTESTOR_CLIENT_SECRET`, `SETTLEMENT_ATTESTOR_BA_USERNAME`, `SETTLEMENT_ATTESTOR_BA_PASSWORD`). The read-only `/health` endpoint is public for deployment verification; all signing and attestation endpoints require the bearer token. Register three independent STRATO accounts with `ExternalAssetBridge.setSettlementVerifier` and configure threshold 2 before starting the bridge service. Each verifier independently validates chain evidence, source state, contract limits, and its local policy. Amounts above a local automatic limit require the existing on-chain review approval before signing. Decision logs include the local policy version and SHA-256 digest.

Verifier deployments use `docker-compose.bridge-signer.tpl.yml`. Deploy one isolated stack per verifier organization with a distinct RPC provider, AWS account or role, KMS key, policy file, API token, and HTTPS endpoint. Finalization generates `external-bridge-verifier-policy-<chainId>-1.json` through `-3.json`, each bound to one STRATO settlement attestor and one shared baseline hash. Each organization may tighten its local limits but must not raise them above the contract policy.

`VERIFIER_CONFIRMATIONS` controls the external-chain confirmation depth independently enforced by that verifier. Configure it per chain and risk policy. Deposit minting and withdrawal finalization require the on-chain verifier threshold; after that threshold is present, any STRATO account may submit plain settlement, with separate AdminRegistry approval required for recorded reviews.

For native ETH deposits, each verifier calls `trace_transaction` to prove the DepositRouter-to-vault custody movement. Every RPC endpoint used by a verifier must support this method. At least two independent verifiers must pass both-provider verification; configure all three for fault tolerance. Verify trace support with a real DepositRouter ETH transaction before enabling the route.

Routine non-native withdrawals clear a verifier policy pre-flight, are marked ready on STRATO, reserved in the route-local vault, released externally, and only then finalized and burned on STRATO. A verifier-demanded manual review is recorded while the withdrawal is still initiated, so the authorization clock only starts after the Safe approval executes. Large withdrawals require an executed Safe approval over their stable review digest before receiving a fresh release authorization.
Expired reservations are cancelled on the original destination vault and recorded on STRATO. Refunds additionally require threshold verifier attestations of confirmed external non-payment; an operator cancellation record alone is insufficient. `npm run refund:external-withdrawal` from `app/contracts` verifies evidence in dry-run mode, and collects `/v1/attest-refund` attestations before submitting a governance vote in execute mode. Configure `SOURCE_CHAIN_ID`, the external RPC URL and positive confirmation count for the refund tool, plus HTTPS verifier URLs/API tokens when executing. Verifier startup checks actual external and STRATO RPC network identities; mismatches fail closed.

Release confirmation waits return HTTP 409 with `decision: "pending_confirmations"`. The bridge retries on the next withdrawal poll and logs one informational line instead of per-verifier errors and a quorum error. It also recognizes older verifiers' exact HTTP 422 confirmation-wait response, so update the bridge first, then the verifiers to remove their rejection logs. Other proof, RPC and transaction failures remain errors; confirmation waits never authorize finalization.

#### Optional
- `CHAIN_${chainId}_WS_RPC_URL` - WebSocket RPC used for immediate deposit detection
- `CHAIN_${chainId}_VERIFICATION_RPC_URLS` - Independent verification RPCs; configure at least one in addition to the primary. Startup requires two distinct HTTPS provider hosts, matching chain IDs, and a successful `trace_transaction` probe for a real mined transaction on each endpoint (searching up to 20 recent blocks). An unsupported method, unavailable trace, or absence of a probe transaction fails startup. Receipts and native ETH traces must agree across every configured provider; all must support `trace_transaction` for native ETH deposits.
- `CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS` - Per-chain confirmation count (an explicit positive value is required in every environment)
- `DEPOSIT_MISSING_RECEIPT_GRACE_MS` - Elapsed time from deposit detection before unavailable receipt or native trace evidence is sent to review (defaults to `300000`). Trace errors/disagreements are isolated by transaction; healthy transactions continue, and no deposit is settled without matching evidence from every configured RPC.
- `DEPOSIT_SETTLEMENT_RETRY_GRACE_MS` - Time a verified deposit settlement may retry before terminal quarantine/review (defaults to `900000`)
- `DEPOSIT_REVIEW_RECORD_RETRY_MS` - Minimum interval between STRATO review-recording attempts (defaults to `60000`; persisted reviews retry independently of log reconciliation)
- `DEPOSIT_WEBHOOK_TOKEN` - Required in every environment for deposit webhook authentication
- `DEPOSIT_OPERATIONS_TOKEN` - Required in every environment to confirm reviewed deposits through the operator endpoint
- `VOUCHER_CONTRACT_ADDRESS` - Voucher contract address (defaults to `0x000000000000000000000000000000000000100e`)
- `TRANSACTION_APPROVER_EMAILS` - Comma-separated list of emails for transaction alerts
- `SENDGRID_API_KEY` - SendGrid API key for sending emails

### Deposit cache recovery

`data/pendingExternalDeposits.json` is a single-writer cache. Writes use atomic replacement. Pending deposits and reviews not yet recorded on STRATO hold the scan cursor before their external block, so their events can be replayed after cache loss. Retry grace periods restart when observations are reconstructed.

Each chain poll reconciles STRATO pending reviews through Cirrus. Missing observations are reconstructed from external receipts and checked against the recorded identity, amounts, recipient and action. Recovered records remain in review; they are never automatically approved. Automatic and manual confirmation can perform the same reconstruction and still require current STRATO review status, a digest-bound AdminRegistry approval, custody verification and verifier attestations. Unavailable or inconsistent receipts are retried without approving the deposit.

This does not recover old unrecorded reviews if an earlier service version already advanced the cursor beyond them. Preserve existing cache files during rollout; those cases need an explicit historical replay. A corrupt committed JSON file still fails closed and must be preserved for investigation before recovery. No additional database is required.

### Processing blockers, retries, and operational emails

The EAB runtime records per-transfer failures in `data/processingIssues.json`. This covers EAB settlement (including approved reviews), review recording, and withdrawal processing, plus native deposit recording/confirmation and withdrawal execution/proposals. Each record identifies the bridge, chain, transfer, and operation, with reason codes, first/last occurrence, attempt count, next retry time, and resolution. This is operational state, not approval or settlement evidence.

| Reason | Operator action |
| --- | --- |
| `MINT_CAPACITY` | Check the token's mint bucket and refill rate; wait for refill or have governance change the policy. |
| `WITHDRAWAL_CAPACITY` | Check available vault capacity, refill, and outstanding reservations. |
| `FUNDING_REQUIRED` | Fund the named submitting account with external gas or STRATO USDST/vouchers, as indicated. |
| `DEPENDENCY_UNAVAILABLE` | Check RPC/verifier availability and authentication. |
| `CONFIRMATIONS_PENDING` | Wait for the required external confirmations. |
| `POLICY_RESTRICTED`, `PAUSED` | Check token/route permissions, pause state, and the reported verifier policy version/digest. |
| `CONFIGURATION`, `UNKNOWN` | Investigate the referenced operation and verifier logs; these failures retain the existing review safeguards. |
| `MANUAL_REVIEW` | Use the existing governance review queue and its emails. |

Amounts remain integer strings in the stated token's base units. Mint diagnostics are explicitly **indexed snapshots** at `observedAt`, not current spendable capacity or a new authorization. Missing diagnostics are omitted. Verifier failures retain the verifier index (one-based order in the configured URL list), policy version/digest, and available limit/confirmation details. Unknown verifier responses remain failures. No signatures, credentials, RPC URLs, or raw HTTP response bodies are stored in this journal.

- Eligible failed submissions retry with a 30-second exponential delay, capped at five minutes with jitter. Capacity/funding/pause waits use up to five minutes; a reported refill wait can shorten that interval. Actual retries occur on the next regular poll after the scheduled time. Retry state survives restarts; unrelated transfers continue.
- READY EAB withdrawals and pending-review recovery continue on the normal polling schedule. Backoff never skips their expiry/cancellation, reservation recovery, or release reconciliation. Native pending withdrawals also continue reconciliation. No authorization deadline is extended.
- Known operational settlement waits do not send otherwise valid deposits to governance merely because the settlement retry grace elapsed. Custody/evidence validation, missing-receipt/trace review deadlines, explicit verifier review, and unknown-failure review behavior remain in place. Existing reviews are never cleared by this tracking.
- Native discovery does not advance its cursor past a recording failure. Other deposits in the scanned range can still be recorded; replay remains idempotent.
- A successful operation clears its blocker. A terminal on-chain record can also clear it. Disappearance from a status query or a failed Cirrus read cannot produce a recovery notice. **Blocker cleared does not mean transfer completed**, and the email says so. Routing, fallback authorization, quorum and dissent rules are unchanged.

The existing `TRANSACTION_APPROVER_EMAILS` and `SENDGRID_API_KEY` enable operational emails. Matching blockers are grouped, unchanged incidents get at most one reminder per hour, and transient dependency/confirmation waits have a five-minute email grace period. Changes to the reason or reported policy/limit can notify immediately. Governance-only reviews use their existing notification channel. Delivery failures retry; a crash after mail acceptance but before journal acknowledgement can produce a duplicate (at-least-once delivery).

Keep this journal on the existing durable `/app/data` mount, writable by UID 1000, with **one runtime writer**. Writes use atomic replacement and fsync. Resolved history is pruned on subsequent writes after seven days; active blockers are retained. Preserve and restore a corrupt journal from backup; do not delete it as a health-reset action. Journal or notification failures appear in the `processingIssues` health check. Transfer blockers themselves do not mark a working polling loop unhealthy.

To inspect active records inside the runtime container:

```sh
node -e 'const s=require("/app/data/processingIssues.json"); console.log(JSON.stringify(Object.values(s.records).filter(r=>!r.resolvedAt),null,2))'
```

Rollout: build the `bridge-eab` image, update the bridge runtime and all verifier tasks, and retain the existing data volume and email settings. The service accepts both old and structured verifier errors, and verifier HTTP statuses/decision fields remain compatible, so either update order is supported. No contract, legacy bridge, backend, UI, nginx, or new environment configuration is required for this phase. Verify a blocked transfer, successful retry, restart deduplication, and email delivery on testnet before relying on alerts. Read-only policy inventory and an Admin processing-issues screen are outside this phase; policies that have not blocked an attempted operation are not proactively scanned.

### Admin transaction reviews and refund notifications

Admin → Bridge includes an **Action Required** queue. This first phase covers transaction reviews and refunds, not configuration, pause, or verifier-change proposals.

- **EAB deposits:** prepare digest-bound approval or rejection votes using the logged-in administrator's existing AdminRegistry workflow. After approval, the bridge automatically re-verifies custody, collects attestations and retries settlement on subsequent deposit polls. **Settle approved deposit** remains a manual retry. Rejecting a deposit does **not** return its external funds; agree a recovery plan before voting.
- **EAB withdrawal reviews:** STRATO displays the on-chain pending-review status and proposal hash, labeled **Approval handled in Safe**. Review and execute proposals in Safe. Service-local sign-time reviews for READY withdrawals are emailed by the bridge; they do not create an on-chain PENDING_REVIEW transition and are not loaded by the admin UI.
- **EAB expired withdrawals:** **Prepare refund / vote** checks the contract's current refund digest and indexed attestations. If quorum is already present, voting works without the bridge service. Otherwise the backend requests verifier collection from the bridge, then independently rechecks the digest and indexed quorum before offering a vote. Expiry alone is not proof of non-payment; the contract re-checks state and quorum when governance executes.
- **Native reviews:** pending Safe approvals remain visible on STRATO, with approval handled in Safe. Deposit evidence reviews remain operator investigations; this feature adds no custody override or automatic refund for burned representations. Automatic native withdrawal delays are excluded. The app continues to show legacy reviews independently; this service sends review notifications only for EAB and native transfers.

The app backend reads the queue directly from Cirrus. Deposit approval digests come from read-only contract calls to the STRATO node's `/rpc` endpoint, avoiding a duplicate digest implementation. Queue display, deposit governance, and refund votes with existing quorum do not call the bridge service. Only collection of missing refund attestations and operator settlement use its authenticated operation endpoint. The bridge's email worker runs independently and shares the pure queue projection with the app; it does not depend on the app backend.

Emails go to `TRANSACTION_APPROVER_EMAILS` when an item enters the queue, its review details change, or it leaves the queue. Leaving the queue means it no longer meets the review criteria; the email directs recipients to transaction history rather than claiming success. This is a polling queue, not an event-by-event record of each governance vote. Brief transitions completed between polls may not generate email. Existing votes and approval counts remain in Admin → Vote on Issues.

Notification delivery state is persisted in `data/bridgeReviewNotifications.json`. Keep it and `data/safe-reviews/` on the existing persistent volume across deployments. Unchanged items are deduplicated across polls/restarts; failed deliveries retry. Delivery is at-least-once: a crash after email acceptance but before journal persistence can send a duplicate. An unavailable queue read never generates resolution emails. Failed notification polls appear in `/health`.

Deployment:

1. Bridge runtime: set the existing `TRANSACTION_APPROVER_EMAILS` and `SENDGRID_API_KEY`. Recipients enable queue emails; without recipients, emails are disabled. Emails identify the transaction and direct recipients to Safe for Safe reviews or Admin → Bridge for STRATO actions, without URL links. Set a strong `DEPOSIT_OPERATIONS_TOKEN` (at least 32 characters).
2. App backend: set `BRIDGE_SERVICE_URL=https://<new-bridge-runtime-host>` and secret `BRIDGE_OPERATIONS_TOKEN` equal to the runtime's `DEPOSIT_OPERATIONS_TOKEN`. Never expose this token to the UI or commit it. These settings are needed only for operator settlement and collecting missing refund attestations. Access requires an authenticated member of the configured AdminRegistry; the backend proxies the operations token server-side.
3. Backend/UI deployment enables the on-chain queue and governance reads independently. Deploy **bridge-eab and bridge-eab-nginx** to enable the operation buttons. The updated nginx template proxies only `POST /operations/reviews/prepare` for settlement or refund attestations; it does not expose a queue or governance-vote endpoint. The bridge enforces bearer authentication and rate limiting. Keep external load-balancer timeouts long enough for verifier collection (up to 180 seconds for the proxy). No contract or verifier change is needed for this queue feature; `/v1/attest-refund` must already be available on deployed verifiers.
4. With `eab-infra`, existing approver recipients and the SendGrid secret are already carried by `runtime-render-static-env.sh`. No additional email environment variable is required. Update both bridge and nginx image references, render/upload the runtime configuration, and follow the normal runtime restart steps.
5. Verify unauthenticated `POST /operations/reviews/prepare` returns 401 (503 if its token is not configured), then use a signed-in administrator at `/dashboard/admin?tab=bridge`. Confirm real review rows, pending-review visibility, and notification delivery before relying on the queue. The first enabled poll emails existing outstanding items. Do not cast a test vote against a live transaction without an approved recovery decision.

### Dynamic Configuration

The service automatically:
- Fetches enabled chains and assets from the bridge contract via Cirrus
- Validates that all required RPC URLs are configured at startup
- Uses the Alchemy API key for all chain connections
- Filters all operations by the specific bridge contract address

## Usage

### Development

Run the service in development mode with hot reloading:

```bash
npm run dev
```

### Production

Build and run the service:

```bash
npm run build
npm start
```

Build the production image from the repository root (the `app` context includes shared types):

```bash
docker build -f app/services/bridge-eab/Dockerfile -t bridge-eab:local app
```

## Architecture

### Service Layer

1. **Bridge Service** (`bridgeService.ts`)
   - Core bridge contract interactions
   - Handles deposit and withdrawal confirmations
   - Atomically settles independently verified deposits

2. **Withdrawal and Native Mint Services** (`externalWithdrawalService.ts`, `nativeMintService.ts`)
   - EAB vault reservations, releases, and Safe review proposals
   - Native representation mint proposals
   - Safe proposal status monitoring and execution

3. **Cirrus Service** (`cirrusService.ts`)
   - Dynamic chain and asset information fetching
   - Withdrawal status queries
   - Bridge contract data retrieval

4. **Polling Services**
   - **STRATO Polling**: Monitors STRATO bridge events
   - **Alchemy Polling**: Monitors Ethereum bridge events
   - Real-time transaction status tracking

### Bridge Out Flow (STRATO → Ethereum)

1. **Withdrawal Initiation**
   - Service polls `ExternalAssetBridge` for initiated routine withdrawals
   - Asks every verifier's `/v1/check-withdrawal` pre-flight for a policy decision; a `manual_review` answer records the review on STRATO before any authorization exists
   - Persists the vault signer-set version and authorization window on STRATO

2. **Vault Processing**
   - Collects threshold-sorted EIP-712 validator signatures
   - Reserves route-local vault liquidity and records the reservation on STRATO
   - Releases the canonical external asset to the recipient

3. **Finalization**
   - Records the confirmed release transaction on STRATO
   - Burns the escrowed STRATO representation only after release
   - Leaves large withdrawals pending for the manual-review path

### Bridge In Flow (Ethereum → STRATO)

1. **Deposit Detection**
   - External-chain polling reads standard and action deposit events in one ordered block range
   - ABI-decodes the action intent
   - Deduplicates exact RPC log repeats
   - Groups deposit events by transaction and requires a unique custody movement for every event
   - Deduplicates exact RPC evidence, but quarantines the whole transaction when an event or movement is malformed, reused, missing, or ambiguous

2. **Processing**
   - Fetches each transaction receipt and trace once, then validates token, sender, custody, exact amount, and execution ordering
   - Settles no deposits from a transaction unless every event passes custody verification
   - Calls `settleDeposit` once per verified deposit
   - Keeps the cursor behind the oldest pending deposit
   - Logs a failed settlement and continues processing later deposits

### Reviewed Deposits

Use the review resolver in dry-run mode before submitting either decision:
```bash
cd app/contracts/deploy
node resolve-external-deposit.js \
  --decision confirm \
  --external-chain-id <chain-id> \
  --deposit-router <router> \
  --deposit-id <deposit-id> \
  --bridge-service-url <bridge-service-url>
```

Add `--execute` after review to call `confirmReviewedDeposit` through the authenticated bridge-operator endpoint. Use `--decision abort --bridge-address <bridge>` to submit the final `abortDeposit` decision through AdminRegistry governance. A reorg replacement requires a separate `--decision reuse --bridge-address <bridge> --bridge-service-url <bridge-service-url>` governance vote; only after `authorizeDepositReuse` executes does the tool reset the persisted observation for canonical reprocessing. The `/reset` endpoint cannot authorize reuse by itself.

Configure `ExternalAssetBridge.setPriceOracle` and call `setRouteRebaseRequired(externalToken, chainId, stratoToken, true)` before enabling a rebasing route. The same route flag controls on-chain inbound division and outbound multiplication. The service preserves the raw verified external amount. Required-rebase routes fail closed unless `PriceOracle.rebaseFactors(stratoToken)` is nonzero; a failure is isolated to that deposit. Keep each xStock route disabled until the route flag, oracle, and factor are verified.

### AUTO_ROUTE rollout

1. Deploy and initialize the standalone `TokenRouter` proxy; do not initialize it from `BaseCodeCollection`.
2. Transfer TokenRouter ownership to AdminRegistry and approve each supported YieldVault.
3. Set the TokenRouter proxy on `ExternalAssetBridge`.
4. Upgrade each external DepositRouter to 3.2 and verify both ERC-20 and native ETH action deposits.
5. Set backend and bridge-service `TOKEN_ROUTER`, plus bridge-service `STRATO_APP_API_URL`.
6. Verify `/api/trade/route/quote` for each intended Save, Forge, swap and YieldVault destination.
7. Enable action 4 per source route with `setDepositAction(externalToken, chainId, stratoToken, 4, true)`.

Save and Forge remain distinct UI destinations, but they are no longer distinct bridge execution modes. Both emit an `AUTO_ROUTE` intent. The service refreshes the route after external finality, derives every step minimum from the user's signed `minFinalOut`, and submits `settleDepositWithRoute`; quote or execution failure atomically falls back to the bridged source token.

### Key Components

- **Dynamic RPC Management**: Uses `getChainRpcUrl(chainId)` for all chain interactions
- **Safe Integration**: Used for EAB governance and native withdrawal approvals
- **OAuth Authentication**: Secure STRATO access with JWT validation
- **Error Handling**: Comprehensive error handling with detailed logging

## Error Handling

The service includes comprehensive error handling:

- **Network Errors**: Automatic retry mechanisms for RPC calls
- **Safe Transaction Failures**: Proper error handling for proposal and execution
- **Cirrus API Errors**: Graceful degradation when Cirrus is unavailable
- **Configuration Errors**: Startup validation ensures all required config is present

All errors are logged with appropriate context for debugging.

## Monitoring

The service logs important events and errors using Winston logger:

- **Startup**: Chain validation, OAuth initialization
- **Polling**: Event detection and processing
- **Safe Operations**: Transaction proposals and executions
- **Bridge Operations**: Deposit and withdrawal processing
- **Errors**: Detailed error logging with context

## Security Considerations

- **Private Keys**: Stored securely in environment variables
- **Safe Multisig**: Safe remains available for governance, manual review, and native withdrawals
- **OAuth**: Secure authentication with STRATO
- **Contract Validation**: All operations filter by specific bridge contract address
- **Error Handling**: Prevents service crashes and data corruption

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT 

Withdrawal capacity is enforced by per-token buckets in the external vault for both routine and Safe-approved withdrawals. The service checks `withdrawalCapacity` before issuing a new authorization, leaves capacity-constrained requests pending, and logs available units and estimated retry seconds. Outstanding reservations hold capacity until release or cancellation; only released consumption refills. Existing READY withdrawals continue through the original expiry/recovery flow. Configure `bucketCapacity` in raw token units and `refillRate` in raw units per second; Safe policy changes remain immediate.

Fresh-deployment security configuration:
- STRATO mint policies are mandatory per representation token and shared by every deposit path. Apply the generated `setMintPolicy` AdminRegistry votes before activation.
- Deploy the matching STRATO contract and verifier together: deposit attestations carry `expectedGeneration`; refund attestations carry `expectedDigest`. The verifier obtains these from the source state it validates.
- A vault signer-set rotation no longer strands READY withdrawals. When the poll finds an unreserved, unexpired authorization pinned to an older set, the operator moves the committed version forward on STRATO (`refreshWithdrawalSignerSet`; the authorization window is never extended) and signing proceeds against the current set. The refresh only commits after rotation and non-reservation are both established at one confirmed external block (latest minus the chain's `DEPOSIT_CONFIRMATIONS`): mixed latest-head reads could otherwise overwrite an authorization whose digest an already-mined reservation binds, which release and refund verifiers would then reject forever. Reserved reservations don't need signatures, and expired authorizations follow the existing refund path.
- Cancellation recording is metadata only and one-shot: the refund digest binds the recorded hash, so neither the contract nor the service will overwrite it on later polls. A released withdrawal can still finalize; refunds continue to require confirmed external non-payment and the on-chain verifier threshold.
- Cirrus review reconciliation errors are logged without blocking external RPC discovery. A recovered review cannot overwrite a locally settled record. Settlement tombstones remain until Cirrus indexes completion; reconciliation also clears recovered reviews once indexed completion is observed.
- The container runs as the `node` user (UID 1000). Give its persistent data/log mounts write access for that UID before starting it.


Safe review proposals persist in `data/safe-reviews` before publication. Mount `data` persistently and run one writer. Recovery reuses the saved nonce, deadline, payload and Safe hash; service outages stop retry, while a confirmed 404 republishes the same signed transaction. An expired approval can generate a new proposal. Nonce allocation is serialized per chain/Safe and reserves all journaled nonces even before Safe indexing. A corrupt journal fails closed: preserve it and restore the verified signed payload from backup/Safe evidence before retrying; do not delete it to allocate a replacement nonce.

Verifier, webhook and deposit-operations authentication use constant-time digest comparison before JSON parsing and require tokens of at least 32 characters. Each authentication scope limits authenticated requests to 120 per minute and failed authentication to 30 attempts per socket peer per minute (429 with Retry-After). Requests are limited to 32 KiB. The app-backend quote client is anonymous and never forwards the bridge operator token.

Reviewed deposits require AdminRegistry approval of `approveReviewedDeposit(chainId, depositRouter, depositId, expectedDigest)`, using `getReviewedDepositDigest` for the current pending deposit. The approval binds its fields, verifier-set version and slot generation. Operator-created PENDING_REVIEW status is not approval. After governance approval is indexed, the enabled-chain deposit poll automatically re-verifies custody, collects verifier attestations and settles; transient failures retry on later polls. The authenticated operator endpoint remains a manual retry and shares the same in-flight settlement guard. Both paths read the current contract digest and require a matching approval; plain settlement remains permissionless only with both approvals present.

Reviewed-deposit disablement policy (R1): disabling a route or chain does not revoke governance approval or otherwise-valid verifier attestations for an already-recorded reviewed deposit. The contract intentionally permits settlement with those approvals after disablement, so users' external funds can still be credited on STRATO. Verifiers continue to require an enabled chain and route before issuing new attestations; governance approval alone is insufficient if the required attestations have not already been collected. Use the global deposit pause to stop outstanding settlements as well as new deposits.

Verified AUTO_ROUTE deposits may receive fallback-only approval when the local verifier policy or the on-chain action permission disables routing. Receipt, custody, confirmations, enabled deposit routes, original intent and automatic-approval limits are still checked. `attestDepositFallback` records a separate domain-separated digest of the full original settlement digest (including verifier-set version and deposit generation); it never authorizes `settleDepositWithRoute`. Full AUTO_ROUTE attestations also authorize fallback, so a mixed quorum can deliver the source token without granting permission to trade. The verifier response includes `fallbackOnly`; the runtime chooses plain settlement when the collected quorum cannot authorize routing. The existing fallback events identify the outcome. Missing or invalid deposit evidence and required manual review still block settlement. Deposits already recorded for review still require governance approval; automatic polling and the reviewed-deposit confirmation endpoint enforce the same checks.

Every withdrawal verifier must approve the `/v1/check-withdrawal` pre-flight before a withdrawal is marked ready; a `409 manual_review` answer records the Safe review first, and any other verifier failure defers processing to the next poll, leaving the withdrawal INITIATED where the sender retains the delayed abort option. The same `409 manual_review` response at signing time still causes Safe review instead of proceeding with other signatures. Residual risk: policy changes after authorization is committed may require governance-assisted recovery — a Safe approval executed within the authorization window lets the original authorization complete; otherwise the authorization expires and funds remain escrowed until verifier refund attestations and governance action complete the refund. Policy files are checked against their recomputed baseline hash. Each verifier compares receipts, traces, contract reads and network identity across all configured RPCs, uses the slowest head for confirmations, and fails closed on disagreements or outages.

New routes require 18-decimal STRATO representation tokens. Route governance grants only the required `mint`/`burn` permissions. Unpause the token before processing withdrawal refunds; token pause intentionally blocks escrow transfers. Authorization validity must match on STRATO and the vault (1–1800 seconds); the abort delay is capped at 172800 seconds. READY cannot use a future `notBefore`.

### Routed-deposit accounting and rollout notes

Reviewed deposits quote from the STRATO amount already recorded by EAB; unrecorded deposits quote from the verified external amount using EAB's current scaling and rebase formula. Do not recompute a reviewed deposit using a newer oracle factor. Changes to EAB's conversion formula require updating the pre-settlement calculation and its parity tests before enabling the new contract version.

Configure a positive DepositRouter token minimum before enabling rebasing routes. Choose a minimum that produces at least one STRATO base unit at the largest supported rebase factor; merely setting the minimum to one external base unit may still round to zero. The rollout generator rejects zero minima for rebasing routes. No existing on-chain token limits are changed by this check.

EAB `DepositCompleted` now includes `depositRouter` and `depositId`; update any consumers using positional event schemas when upgrading. EAB route outcomes use `AutoRouted`, `DepositActionFallback`, and `DepositActionFailed`; per-step outcomes use TokenRouter's `RouteStepExecuted`. `CANCELLED` remains a reserved status number for compatibility; recorded cancellations leave withdrawals READY until the attested refund completes. Deterministic AUTO_ROUTE failures may still settle through the operator's source-token fallback path.


### Native deposit routing rollout

Native representations can be redeemed and traded in one flow. `requestRedemptionWithRoute` burns the representation and emits one `RedemptionRequestedWithRoute` event binding the recipient, output token, and minimum output. Plain `requestRedemption` remains supported. Both share the same redemption ID counter.

The bridge service verifies every intent field against the external receipt, then requests fresh steps from the backend's existing TokenRouter quote service. Route selection may change; the committed output token and minimum cannot. STRATO unlocks the source asset from custody and executes the route. Routing failures roll back all route effects and transfer the original source asset to the recipient, emitting `DepositActionFailed` and `DepositActionFallback`. Custody failures revert settlement. The minimum output protects successful trades only, not the source-token fallback. A transport failure fetching the quote is retried rather than treated as a fallback.

Upgrade order:

1. Upgrade `StratoNativeBridge` on STRATO; configure `setTokenRouter(newTokenRouter)` with the same router used by the backend. Auto-routing defaults to disabled for every STRATO-token/external-chain pair. Explicitly opt in each intended route with owner-only `setAutoRouteEnabled(stratoToken, externalChainId, true)`. `configure-native-route.js --token-router <address> --auto-route-enabled true` supports this configuration alongside a native route; omitting `--auto-route-enabled` preserves its existing permission.
2. Deploy this bridge service **before** enabling routed external redemptions. It must poll both native redemption event signatures. Keep the existing native block cursor; if routed events were already emitted while an old service was running, replay from before the first such event.
3. Configure `STRATO_NATIVE_BRIDGE` in the rewards poller and deploy it. Router-attributed rewards fail closed until both bridge addresses are valid; native bridge callers are excluded just like EAB callers. Native rewards still require their intended on-chain activity configuration.
4. Upgrade each external `StratoNativeRepresentationBridge` proxy to version **1.2.0**. No new external storage is added.
5. Deploy backend and UI together. Native composite quotes require external bridge version 1.2+, matching STRATO `tokenRouter` wiring, and `autoRouteEnabled[stratoToken][externalChainId] == true`. Native inputs then use the same internal route graph as STRATO trades; direct native redemptions bypass routing and do not require auto-route permission.

Disabling auto-routing blocks new routed quotes and is checked again during on-chain execution. Already-sent routed redemptions remain recordable and settle through the source-token fallback when permission is disabled, including if disabled after recording. This follows EAB behavior and avoids stranding externally burned representations. The toggle does not change withdrawal permissions.

Do not enable routed redemptions until steps 1–3 are complete. No deployment or governance action is performed by the source changes themselves.

## Runtime health

The bridge runtime's `/health` returns HTTP 200 only after startup validation and
an initial successful pass of every enabled polling loop. It returns HTTP 503
with `status: false` and per-poll `checks` while starting, after a whole-poll
failure, or when polling stalls. A successful retry clears that poll's failure.
A running poll or external deposit reconciliation taking over 15 minutes is
stalled; a missing scheduled poll is stale after its interval plus 15 minutes
(`HEALTH_POLL_TIMEOUT_MS`). Empty queues and intentionally paused deposits do
not fail health when their polling checks succeed.

Tracked deposit/withdrawal failures are recorded in `data/processingIssues.json`
with transition logs and deduplicated emails. Other diagnostic errors may remain
in logs and `data/bridge-error.flag`. The file is historical evidence, not a health
gate; `errorLogPresent: true` does not change the HTTP status. A healthy response
confirms polling readiness, not that every transfer has settled. Monitor review
queues and item failures separately. No error-file deletion is needed to recover
health, and cursors/pending deposits are unchanged. Verifier health is unchanged.

### Flow recovery update

Deploy the verifier image first, then the bridge service image and app backend/UI. No contract upgrade or new environment variable is required for these fixes. Verifiers and the bridge must be able to make authenticated read-only calls to the STRATO node's `/rpc` endpoint: reviewed-deposit and refund digests come from the contract, not a duplicate off-chain hash implementation. Governance approval values are read from Cirrus storage; the deployed nested-mapping RPC getter returns zero even for recorded approvals.

Native deposit discovery and verification now enforce `CHAIN_<chainId>_DEPOSIT_CONFIRMATIONS` (or `DEPOSIT_CONFIRMATIONS`) against the slowest configured RPC head. Missing, immature or disputed receipts stay pending for retry; they are neither confirmed nor sent to manual review. Preserve existing cursors and pending-deposit files during rollout.

READY EAB withdrawals remain eligible for recovery while withdrawals are paused or their chain is disabled. Recovery uses the committed vault: it may finalize an already-paid withdrawal or cancel an expired reservation, but cannot initiate a reservation or payment while paused/disabled. Refunds still require verifier evidence and governance approval.
