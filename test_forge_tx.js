const { ethers } = require('ethers');

async function forgeAndSubmitTx() {
  // Create a test wallet with a known private key (offline, no provider needed)
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat test key #1
  const wallet = new ethers.Wallet(privateKey);
  
  console.log('Wallet address:', wallet.address);
  
  try {
    // Create a simple transfer transaction (legacy format - no type field)
    const toAddress = ethers.getAddress('0x742d35cc6634c0532925a3b844bc9e7595f0beb0'); // Random address, properly checksummed
    const tx = {
      to: toAddress,
      value: ethers.parseEther('0.002'),
      gasLimit: 21000,
      gasPrice: ethers.parseUnits('1', 'gwei'),
      nonce: 0, // Start with 0
      chainId: 114784819836269, // Helium network chain ID (computed from "helium" string)
      type: 0, // Force legacy transaction type
    };
    
    console.log('\nTransaction details:');
    console.log('  To:', tx.to);
    console.log('  Value:', ethers.formatEther(tx.value), 'ETH');
    console.log('  Gas Limit:', tx.gasLimit.toString());
    console.log('  Gas Price:', ethers.formatUnits(tx.gasPrice, 'gwei'), 'gwei');
    console.log('  Nonce:', tx.nonce);
    console.log('  Chain ID:', tx.chainId);
    
    // Sign the transaction (offline) - use a dummy provider
    console.log('\nSigning transaction...');
    const dummyProvider = {
      getNetwork: async () => ({ chainId: tx.chainId }),
      resolveName: async (name) => name,
      getBlockNumber: async () => 0,
      call: async () => '0x',
      estimateGas: async () => tx.gasLimit,
      getFeeData: async () => ({ gasPrice: tx.gasPrice })
    };
    const walletWithProvider = wallet.connect(dummyProvider);
    const signedTx = await walletWithProvider.signTransaction(tx);
    console.log('Signed transaction length:', signedTx.length);
    console.log('Signed transaction (first 100 chars):', signedTx.substring(0, 100) + '...');
    
    // Submit via eth_sendRawTransaction using fetch
    console.log('\nSubmitting transaction to http://localhost:8546...');
    const response = await fetch('http://localhost:8546', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [signedTx],
        id: 1
      })
    });
    
    const result = await response.json();
    console.log('\nResponse:', JSON.stringify(result, null, 2));
    
    if (result.error) {
      console.log('\n❌ Transaction rejected:', result.error.message);
      console.log('Error code:', result.error.code);
    } else {
      console.log('\n✅ Transaction submitted successfully!');
      console.log('Transaction hash:', result.result);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

forgeAndSubmitTx().catch(console.error);

