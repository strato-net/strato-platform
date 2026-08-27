# STRATO Bridge Service

The STRATO Bridge Service is responsible for seamlessly bridging assets between multiple blockchain networks and the STRATO mainnet/testnet. It manages vault-backed non-native transfers, native bridge transfers, and legacy Safe withdrawals while monitoring blockchain activity through dynamic RPC connections.

## Features

* **Dynamic Chain Support**: Automatically detects and configures RPC endpoints for all enabled chains from the bridge contract
* **Safe Multisig Integration**: Proposes and executes transactions through Gnosis Safe for secure asset management
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
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_ATTESTATION_PRIVATE_KEY` - Destination-chain key used to pay gas and sign external vault withdrawal authorizations
- `CHAIN_${chainId}_EXTERNAL_BRIDGE_ATTESTATION_PRIVATE_KEY_1`, `_2`, ... - Optional additional signer keys required by the vault threshold

Routine non-native withdrawals are marked ready on STRATO, reserved in the route-local vault, released externally, and only then finalized and burned on STRATO. Withdrawals flagged for manual review remain pending.

#### Optional
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
   - Manages batch operations for efficiency

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
   - Rejects unsupported multi-deposit transactions without advancing the cursor

2. **Processing**
   - Records standard deposits with `depositBatch`
   - Records action deposits with `depositBatchWithAction`
   - Advances the cursor only after both recording paths succeed

### Action Deposit Rollout

Before starting the updated relayer in dev, test, or production:

1. Upgrade and configure `MercataBridge`.
2. Dry-run the two required relayer whitelist operations:
```bash
cd app/contracts/deploy
node configure-bridge-relayer-actions.js \
  --bridge-address <bridge-proxy> \
  --relayer-address <relayer-address>
```
3. Repeat with `--execute` as each required admin until governance executes both operations.
4. Verify the relayer is whitelisted for `depositWithAction` and `depositBatchWithAction`.
5. Start one relayer instance, validate standard and action deposits, then roll out remaining instances.

### Key Components

- **Dynamic RPC Management**: Uses `getChainRpcUrl(chainId)` for all chain interactions
- **Safe Integration**: Leverages `@safe-global/protocol-kit` and `@safe-global/api-kit`
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
