# STRATO Bridge Service

The STRATO Bridge Service is responsible for seamlessly bridging assets between multiple blockchain networks and the STRATO mainnet/testnet. It manages vault-backed non-native transfers, native bridge transfers, and legacy Safe withdrawals while monitoring blockchain activity through dynamic RPC connections.

## Features

* **Dynamic Chain Support**: Automatically detects and configures RPC endpoints for all enabled chains from the bridge contract
* **Safe Governance Integration**: Uses Safe governance for large-withdrawal approval and reviewed-deposit aborts
* **External Vault Releases**: Reserves and releases routine non-native withdrawals using threshold-signed vault authorizations
* **Real-time Monitoring**: Polls blockchain events and transaction statuses across all supported chains
* **Bridge Out Flow**: STRATO → external-chain transfers through route-local vaults, with manual review for large withdrawals
* **Bridge In Flow**: Ethereum → STRATO deposit processing and confirmation
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
cd services/bridge
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

#### Blockchain
- `ALCHEMY_API_KEY` - Alchemy API key (used for all chains)
- `BRIDGE_ADDRESS` - MercataBridge contract address
- `EXTERNAL_ASSET_BRIDGE_ADDRESS` - ExternalAssetBridge proxy address used for non-native deposits
- `EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS` - Safe approval validity for large withdrawals (defaults to seven days)

#### Chain RPC URLs (Dynamically Validated)
The service automatically validates that RPC URLs are configured for all enabled chains from the bridge contract:

- `CHAIN_11155111_RPC_URL` - Sepolia RPC URL (e.g., `https://eth-sepolia.g.alchemy.com/v2`)
- `CHAIN_1_RPC_URL` - Ethereum mainnet RPC URL (if using mainnet)
- `CHAIN_${chainId}_RPC_URL` - RPC URL for any additional enabled chains

#### Safe Wallet
- `SAFE_ADDRESS` - Gnosis Safe wallet address
- `SAFE_PROPOSER_ADDRESS` - Safe Proposer address
- `SAFE_PROPOSER_PRIVATE_KEY` - Safe Proposer private key

#### Native Bridge Minting
- `STRATO_NATIVE_BRIDGE_ADDRESS` - STRATO native bridge proxy address
- `CHAIN_${chainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS` - External representation bridge address for each native route chain
- `CHAIN_${chainId}_NATIVE_BRIDGE_PRIVATE_KEY` - Destination-chain key used to pay gas and sign native mint attestations
- `CHAIN_${chainId}_NATIVE_BRIDGE_PRIVATE_KEY_1`, `_2`, ... - Optional additional destination-chain signer keys when the destination bridge attestation threshold is raised

Native withdrawal review delay and attestation validity are enforced by the native bridge contracts, not bridge-service environment variables.

#### External Vault Releases
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY` - Unprivileged destination-chain gas key used only to submit reserve/release/cancel transactions
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_SIGNER_URLS` - Comma-separated independent signer service URLs
- `EXTERNAL_BRIDGE_SIGNER_API_TOKEN` - Shared authentication token for signer service requests

Run each signer independently with `npm run start:signer`. Each process must use its own `SIGNER_RPC_URL`, KMS/HSM adapter (`KMS_SIGNER_URL`, `KMS_SIGNER_ADDRESS`), and read-only STRATO OAuth account (`SIGNER_OPENID_DISCOVERY_URL`, `SIGNER_CLIENT_ID`, `SIGNER_CLIENT_SECRET`, `SIGNER_BA_USERNAME`, `SIGNER_BA_PASSWORD`). Access tokens are refreshed before expiry and once after a 401 response. A signer verifies the source withdrawal and destination vault policy itself before requesting a digest signature; no attestation private key is held by the bridge executor.

Production signer deployments use `docker-compose.bridge-signer.tpl.yml`. Deploy one isolated stack per signer with a distinct RPC provider, KMS/HSM key and API endpoint.

Routine non-native withdrawals are marked ready on STRATO, reserved in the route-local vault, released externally, and only then finalized and burned on STRATO. Large withdrawals require an executed Safe approval over their stable review digest before receiving a fresh release authorization.
Expired reservations are cancelled on the destination vault and recorded on STRATO; governance can then refund the escrowed representation with `npm run refund:external-withdrawal` from `app/contracts`.

#### Optional
- `CHAIN_${chainId}_WS_RPC_URL` - WebSocket RPC used for immediate deposit detection
- `CHAIN_${chainId}_VERIFICATION_RPC_URLS` - Independent receipt-verification RPCs; the primary `CHAIN_${chainId}_RPC_URL` must support `trace_transaction` for native ETH deposits
- `CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS` - Per-chain confirmation count (defaults to `0` in development; production requires an explicit positive value)
- `DEPOSIT_MISSING_RECEIPT_GRACE_MS` - Time a missing/lagging receipt remains retryable before review (defaults to `300000`)
- `DEPOSIT_SETTLEMENT_RETRY_GRACE_MS` - Time a verified deposit settlement may retry before terminal quarantine/review (defaults to `900000`)
- `DEPOSIT_REVIEW_RECORD_RETRY_MS` - Minimum interval between STRATO review-recording attempts (defaults to `60000`; persisted reviews retry independently of log reconciliation)
- `DEPOSIT_WEBHOOK_TOKEN` - Required outside development/test for deposit webhook authentication
- `DEPOSIT_OPERATIONS_TOKEN` - Required outside development/test to confirm reviewed deposits through the operator endpoint
- `VOUCHER_CONTRACT_ADDRESS` - Voucher contract address (defaults to `0x000000000000000000000000000000000000100e`)
- `TRANSACTION_APPROVER_EMAILS` - Comma-separated list of emails for transaction alerts
- `SENDGRID_API_KEY` - SendGrid API key for sending emails

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

## Architecture

### Service Layer

1. **Bridge Service** (`bridgeService.ts`)
   - Core bridge contract interactions
   - Handles deposit and withdrawal confirmations
   - Atomically settles independently verified deposits

2. **Safe Service** (`safeService.ts`)
   - Centralized Safe multisig wallet operations
   - Transaction generation and proposal
   - Status monitoring and execution

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
   - Processes every deposit event independently, including multiple events in one transaction
   - Quarantines malformed logs without stopping the chain cursor

2. **Processing**
   - Verifies the receipt, canonical event and custody transfer before any STRATO write
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

Add `--execute` after review to call `confirmReviewedDeposit` through the authenticated bridge-operator endpoint. Use `--decision abort --bridge-address <bridge> --bridge-service-url <bridge-service-url>` to submit `abortDeposit` through AdminRegistry governance and reset the persisted observation for canonical reprocessing. The authenticated `/reset` operation is also the manual recovery path after correcting a terminal settlement configuration failure.

### Key Components

- **Dynamic RPC Management**: Uses `getChainRpcUrl(chainId)` for all chain interactions
- **Safe Integration**: Retained for governance and legacy withdrawal operations
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
- **Safe Multisig**: Safe remains available for governance, manual review, and legacy withdrawals
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
