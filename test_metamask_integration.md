# Testing MetaMask Integration with Strato

## Server Status
✅ **ethereum-jsonrpc server is running on port 8546**

## Testing Methods

### Method 1: Test with curl (Quick Test)

First, you need a signed transaction hex string. You can get this from MetaMask or create a test one.

```bash
# Test the endpoint with a sample transaction
curl -X POST http://localhost:8546 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_sendRawTransaction",
    "params": ["0xYOUR_SIGNED_TRANSACTION_HEX_HERE"],
    "id": 1
  }'
```

### Method 2: Test with MetaMask

1. **Add Strato Network to MetaMask:**
   - Open MetaMask
   - Go to Settings → Networks → Add Network
   - Add a custom network:
     - Network Name: Strato Local
     - RPC URL: `http://localhost:8546`
     - Chain ID: (check your ethconf.yaml or use 1 for testing)
     - Currency Symbol: STRATO (or whatever you use)

2. **Create a Transaction:**
   - Switch to the Strato network in MetaMask
   - Send a transaction to any address
   - Before confirming, open the browser console (F12)
   - The transaction will be signed and you can capture the raw transaction hex

3. **Submit via API:**
   - Copy the raw transaction hex from MetaMask
   - Use curl or any HTTP client to send it to `eth_sendRawTransaction`

### Method 3: Generate Test Transaction (for development)

You can use a tool like `ethers.js` or `web3.js` to create a test transaction:

```javascript
// Example using ethers.js (Node.js)
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('http://localhost:8546');
const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

const tx = {
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: ethers.parseEther('0.1'),
  nonce: await provider.getTransactionCount(wallet.address),
  gasPrice: ethers.parseUnits('1', 'gwei'),
  gasLimit: 21000,
};

const signedTx = await wallet.signTransaction(tx);
console.log('Signed transaction:', signedTx);

// Now send it
const response = await fetch('http://localhost:8546', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [signedTx],
    id: 1,
  }),
});

const result = await response.json();
console.log('Result:', result);
```

## Expected Response

On success, you should get:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x<transaction_hash>"
}
```

On error, you'll get:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid hex string: ..."
  }
}
```

## Debugging

1. **Check server logs:**
   ```bash
   tail -f my-app/logs/ethereum-jsonrpc
   ```

2. **Check if server is running:**
   ```bash
   curl http://localhost:8546 -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":1}'
   ```

3. **Check Kafka/Strato sequencer:**
   - The transaction should appear in the sequencer logs
   - Check `my-app/logs/strato-sequencer`

## Notes

- The server currently supports **legacy transactions** (9-item RLP arrays)
- EIP-155, EIP-2930, and EIP-1559 support is implemented but may need testing
- Make sure your transaction has the correct nonce for the sender address
- The transaction will be submitted to Kafka and processed by the Strato sequencer

