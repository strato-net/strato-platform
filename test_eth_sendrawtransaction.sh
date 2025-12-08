#!/bin/bash

# Test script for eth_sendRawTransaction
# This creates a simple legacy transaction for testing

# The ethereum-jsonrpc server should be running on port 8546
RPC_URL="http://localhost:8546"

echo "Testing eth_sendRawTransaction endpoint..."
echo "RPC URL: $RPC_URL"
echo ""

# Test 1: Check if server is running
echo "1. Checking if server is running..."
response=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":1}')

echo "Response: $response"
echo ""

# Test 2: Try eth_sendRawTransaction with a sample transaction
# Note: This is a placeholder - you'll need a real signed transaction from MetaMask
echo "2. Testing eth_sendRawTransaction..."
echo "Note: You need to provide a real signed transaction hex string"
echo ""
echo "Example curl command:"
echo 'curl -X POST "'$RPC_URL'" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '"'"'{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0x..."],"id":1}'"'"
echo ""

# If you have a transaction hex, uncomment and replace with your actual transaction:
# TX_HEX="0x..."  # Replace with your actual signed transaction hex
# response=$(curl -s -X POST "$RPC_URL" \
#   -H "Content-Type: application/json" \
#   -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendRawTransaction\",\"params\":[\"$TX_HEX\"],\"id\":1}")
# echo "Transaction response: $response"

