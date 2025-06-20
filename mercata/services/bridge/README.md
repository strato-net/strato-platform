# Mercata Bridge Service
The Mercata Bridge Service is responsible for seamlessly bridging assets between the Ethereum Sepolia network and the STRATO Mercata testnet. It manages deposits and withdrawals using a Safe multisig wallet and monitors blockchain activity in real-time using Alchemy WebSocket connections.

## Features
* Detects deposit/withdrawal events on both Ethereum and STRATO
* Proposes transactions to Safe multisig for security and approval
* Executes actions after Safe approval
* Syncs transaction states across chains to ensure consistency
* Fetches balances and transaction history for display in frontend interfaces
* Real-time monitoring of Ethereum and STRATO bridge contracts
* Event-based handling of deposit and withdraw actions
* Proposing transactions to Safe multisig for pending/confirm updates
* Fetching balances of bridged tokens
* Retrieving transaction histories
* Automatic reconnection for resilient WebSocket communication
* Secure and contextual logging using Winston

## Prerequisites

- Node.js 18 or higher
- Access to Ethereum and STRATO RPC endpoints
- Safe multisig wallet address
- Relayer private key
- Safe Transaction Service URL

## Installation

1. Clone the repository

2. cd services/bridge

3. Install dependencies:
```bash
npm install
```

4. Copy the example environment file and update the values:
```bash
cp .env.example .env
```

## Configuration

Update the following environment variables in `.env`:
Key	                           Description

- ALCHEMY_API_KEY                 	WebSocket API key for Ethereum
- ALCHEMY_NETWORK                 	Ethereum network name (e.g. ETH_SEPOLIA)
- ETHEREUM_RPC_URL              	RPC endpoint for Ethereum
- NODE_URL	RPC                     endpoint for STRATO
- SAFE_ADDRESS	                  Address of the Safe multisig wallet
- SAFE_OWNER_PRIVATE_KEY        	Private key of Safe proposer
- SAFE_OWNER_ADDRESS	            Address of Safe owner submitting the proposal
- BRIDGE_ADDRESS	                  STRATO bridge contract address
- BRIDGE_TOKEN_ADDRESS           	Token address on STRATO
- CLIENT_ID, CLIENT_SECRET      	OAuth credentials for STRATO login
- OPENID_DISCOVERY_URL	            STRATO OpenID metadata URL
- TRANSACTION_APPROVER_EMAILS   Comma-separated list of emails for transaction alerts
- SENDGRID_API_KEY	               SendGrid API key for sending emails




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

1. Event Monitoring Layer
- Uses Alchemy WebSockets to subscribe to Deposit events on Ethereum
- Uses STRATO WebSockets to detect Withdraw events
- Automatically reconnects if socket drops

2. Bridge Logic Deposits (ETH → STRATO):
- Detects DepositInitiated on Ethereum
- Checks if already processed
- If not, triggers recordDeposit on STRATO
- Withdrawals (STRATO → ETH):
- Detects WithdrawInitiated on STRATO
- Proposes a transaction to Safe for marking withdrawal
- Waits for approvals and executes via Safe SDK

3. Safe Integration Uses Safe SDK to:
- Create transactions (markWithdrawalPending, confirmWithdrawal)
- Submit them for multisig approval
- Execute after approval

4. Data Fetching Fetches:
- Token balances on STRATO
- Transaction history for audit/debugging

### Event Flow

Deposit Flow:
* Alchemy detects a deposit on Ethereum
* Service checks if it’s already processed on STRATO
* If not processed → sends a recordDeposit() transaction on STRATO

Withdrawal Flow:
* STRATO detects a withdrawal
* Creates a transaction to mark it as pending on Ethereum via Safe
* Submits for Safe approval
* After enough signatures → executes the transaction

## Error Handling

The service includes comprehensive error handling and logging:

- WebSocket connection errors
- Transaction failures
- Safe proposal errors
- Network errors

All errors are logged with appropriate context for debugging.

## Monitoring

The service logs important events and errors using Winston logger:

- WebSocket connection status
- Transaction proposals and executions
- Event detections
- Error conditions

Logs are written to both console and files:
- `error.log`: Error-level logs
- `combined.log`: All logs

## Security Considerations

- Private keys are stored in environment variables
- Safe multisig ensures transaction approval
- WebSocket connections are secured
- Error handling prevents service crashes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT 