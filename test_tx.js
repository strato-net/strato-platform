// Quick test script - you'll need to install ethers first: npm install ethers
const { ethers } = require('ethers');

const RPC_URL = 'http://localhost:8546';

async function test() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log('Connected to:', RPC_URL);
    
    // Get block number to verify connection
    const blockNumber = await provider.getBlockNumber();
    console.log('Current block:', blockNumber);
    
    console.log('\n✅ Server is working!');
    console.log('\nTo test eth_sendRawTransaction, you need:');
    console.log('1. A private key with funds');
    console.log('2. Or use MetaMask to generate a transaction');
    console.log('\nExample MetaMask setup:');
    console.log('- Add network: http://localhost:8546');
    console.log('- Chain ID: Check your ethconf.yaml');
    console.log('- Send a transaction and it will use eth_sendRawTransaction');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
