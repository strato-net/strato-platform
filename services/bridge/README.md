# Mercata Bridge Service

This service handles the bridging of assets between Ethereum and STRATO networks using a Safe multisig wallet for transaction approval.

## Features

- Monitors bridge contract events on both networks
- Handles withdrawal and deposit events
- Proposes transactions to Safe multisig for approval
- Executes approved transactions
- Automatic reconnection on WebSocket disconnection
- Comprehensive logging

## Prerequisites

- Node.js 18 or higher
- Access to Ethereum and STRATO RPC endpoints
- Safe multisig wallet address
- Relayer private key
- Safe Transaction Service URL

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file and update the values:
```bash
cp .env.example .env
```

## Configuration

Update the following environment variables in `.env`:

- `ETH_RPC_URL`: Ethereum RPC endpoint
- `STRATO_RPC_URL`: STRATO RPC endpoint
- `STRATO_WS_URL`: STRATO WebSocket endpoint
- `ETH_BRIDGE_ADDRESS`: Ethereum bridge contract address
- `STRATO_BRIDGE_ADDRESS`: STRATO bridge contract address
- `SAFE_ADDRESS`: Safe multisig wallet address
- `SAFE_SERVICE_URL`: Safe Transaction Service URL

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

The service consists of several key components:

1. **BridgeContract**: Handles interactions with the bridge smart contracts on both networks
2. **SafeService**: Manages Safe multisig transaction proposals and execution
3. **BridgeService**: Coordinates between contracts and services, handles event monitoring

### Event Flow

1. **Withdrawal Initiated**:
   - Service detects withdrawal event on STRATO
   - Proposes transaction to Safe to mark withdrawal as pending
   - Waits for Safe approval
   - Executes approved transaction

2. **Deposit Recorded**:
   - Service detects deposit event on Ethereum
   - Checks if deposit is already processed
   - Records deposit on STRATO if not processed

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