import axios from 'axios';
import { config } from '../config';
import { getBAUserToken } from '../auth';
import { confirmBridgeinSafePolling, confirmBridgeOutSafePolling } from '../services/bridgeService';
import SafeApiKit from "@safe-global/api-kit";
import BridgeContractCall from '../utils/bridgeContractCall';
import safeTransactionGenerator from '../services/safeService';
import sendEmail from '../services/emailService';
import { TESTNET_ERC20_TOKEN_CONTRACTS, MAINNET_ERC20_TOKEN_CONTRACTS } from '../config';
import { TESTNET_ETH_STRATO_TOKEN_MAPPING, MAINNET_ETH_STRATO_TOKEN_MAPPING } from '../config';

const NODE_URL = process.env.NODE_URL;

const apiKit = new SafeApiKit({ chainId: process.env.SHOW_TESTNET === 'true' ? 11155111n : 1n });

const ALCHEMY_URL = process.env.SHOW_TESTNET === 'true' ? 'https://eth-sepolia.g.alchemy.com/v2' : 'https://eth-mainnet.g.alchemy.com/v2';

const SEARCH_URL = "BlockApps-Mercata-MercataEthBridge";
// const MERCATA_URL = "MercataEthBridge" ;
const stripHexPrefix = (hashes: string[]): string[] =>
  hashes.map(hash => hash.replace('0x', '')
);

// Comment out the existing batch processing function
/*
export const startDepositTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {
  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-depositStatus?value=eq.1&order=block_timestamp.desc&address=eq.${config.bridge.address}`; //fetchong depositInitiated 

      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await getBAUserToken()}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      // Step 1: Extract txHashes
      const txHashes = data.map(({ key }: { key: string }) => `0x${key}`);
      // Step 2: Batch call to get receipts
      const batch = txHashes.map((hash, i) => ({
        jsonrpc: '2.0',
        id: hash,
        method: 'eth_getTransactionReceipt',
        params: [hash],
      }));

      const { data: batchResponses } = await axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, batch);

      // Step 3: Extract valid transactionHashes from receipts
      const completedTxHashes = batchResponses.filter((res: any) => res?.result?.status === "0x1");

      if (!completedTxHashes.length) {
        return;
      }

      await confirmBridgeinSafePolling(completedTxHashes);
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  // Run once now, then every specified interval
  await poll();
  setInterval(poll, pollingInterval);
};
*/

// New function that processes transactions one by one
export const startDepositTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {
  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-depositStatus?value=eq.1&order=block_timestamp.desc&address=eq.${config.bridge.address}`; //fetchong depositInitiated 

      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await getBAUserToken()}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      // Process each transaction individually instead of in batch
      for (const transaction of data) {
        try {
          const txHash = `0x${transaction.key}`;
          
          // Get transaction receipt for this specific transaction
          const receiptResponse = await axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, {
            jsonrpc: '2.0',
            id: txHash,
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          });

          const receipt = receiptResponse.data?.result;
          
          // Check if transaction is completed
          if (receipt && receipt.status === "0x1") {
            // Call confirmBridgeinSafePolling for single transaction
            await confirmBridgeinSafePolling([txHash]);
            console.log(`✅ Processed completed transaction: ${txHash}`);
          } else {
            console.log(`⏳ Transaction ${txHash} not yet completed`);
          }
          
        } catch (err: any) {
          console.error(`❌ Failed to process transaction ${transaction.key}:`, err);
        }
      }
      
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  // Run once now, then every specified interval
  await poll();
  setInterval(poll, pollingInterval);
};

// Comment out the existing batch processing function
/*
export const startWithdrawalTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {

  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-withdrawStatus?value=eq.2&order=block_timestamp.desc&address=eq.${config.bridge.address}`;
      
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await getBAUserToken()}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      // Step 1: Extract txHashes
      const txHashes = data.map(({ key }: { key: string }) => `0x${key}`);
      const approvedTxHashes = [];
      
      for (const txHash of txHashes) {
        try {
          const safeTransaction = await apiKit.getTransaction(txHash);
          if(safeTransaction.isExecuted === true){
            approvedTxHashes.push(txHash);
          }
        } catch (err) {
          console.error(`❌ Failed to process transaction ${txHash}:`, err);
        }
      }
      
      const strippedHashes = stripHexPrefix(approvedTxHashes);
      await confirmBridgeOutSafePolling(strippedHashes);
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};
*/

// New function that processes withdrawal transactions one by one
export const startWithdrawalTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {

  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-withdrawStatus?value=eq.2&order=block_timestamp.desc&address=eq.${config.bridge.address}`;
      
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await getBAUserToken()}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      // Process each withdrawal transaction individually instead of in batch
      for (const transaction of data) {
        try {
          const txHash = `0x${transaction.key}`;
          
          // Check Safe transaction status for this specific transaction
          try {
            const safeTransaction = await apiKit.getTransaction(txHash);
            if(safeTransaction.isExecuted === true){
              // Process this individual withdrawal transaction
              const strippedHash = txHash.replace('0x', '');
              await confirmBridgeOutSafePolling([strippedHash]);
              console.log(`✅ Processed approved withdrawal transaction: ${txHash}`);
            } else {
              console.log(`⏳ Withdrawal transaction ${txHash} not yet executed`);
            }
          } catch (err) {
            console.error(`❌ Failed to check Safe transaction ${txHash}:`, err);
          }
          
        } catch (err: any) {
          console.error(`❌ Failed to process withdrawal transaction ${transaction.key}:`, err);
        }
      }
      
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};

export const fetchWithdrawalRequestedTransactions = async (withdrawalInterval: number) => {
  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-withdrawStatus?value=eq.0&order=block_timestamp.desc&address=eq.${config.bridge.address}`;
      //  console.log("url for withdrawal requested transactions", url);
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await getBAUserToken()}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      // Extract txHashes and process each withdrawal request
      const processedTransactions = [];
      
      for (const transaction of data) {
        try {
          const txHash = `0x${transaction.key}`;
          
          // Get transaction details from the bridge contract
          const bridgeContract = new BridgeContractCall();
          
          // Extract transaction details (you may need to adjust these based on your data structure)
          const tokenAddress = transaction.token || transaction.tokenAddress;
          const fromAddress = transaction.from || transaction.fromAddress;
          const amount = transaction.amount;
          const toAddress = transaction.to || transaction.toAddress;
          const userAddress = transaction.mercataUser || transaction.userAddress;
          
          if (!tokenAddress || !fromAddress || !amount || !toAddress || !userAddress) {
            console.error(`❌ Missing required fields for transaction ${txHash}:`, transaction);
            continue;
          }

          // Determine if it's testnet
          const isTestnet = process.env.SHOW_TESTNET === "true";
          const tokenContract = isTestnet
            ? TESTNET_ERC20_TOKEN_CONTRACTS
            : MAINNET_ERC20_TOKEN_CONTRACTS;

          const tokenMapping = isTestnet
            ? TESTNET_ETH_STRATO_TOKEN_MAPPING
            : MAINNET_ETH_STRATO_TOKEN_MAPPING;

          const ethTokenAddress: any =
            Object.entries(tokenMapping).find(
              ([_, value]) => value.toLowerCase() === tokenAddress.toLowerCase()
            )?.[0] || null;

          const isERC20 = tokenContract.find((token: any) => token === ethTokenAddress);

          // Generate Safe transaction
          const generator = await safeTransactionGenerator(
            amount,
            toAddress,
            isERC20 ? "erc20" : "eth",
            ethTokenAddress
          );
          
          const {
            value: { hash },
          } = await generator.next();

          // // Call bridge contract withdraw method
          // await bridgeContract.withdraw({
          //   txHash: hash.toString().replace("0x", ""),
          //   token: tokenAddress.toLowerCase().replace("0x", ""),
          //   from: fromAddress.toLowerCase().replace("0x", ""),
          //   amount: amount.toString(),
          //   to: toAddress.toLowerCase().replace("0x", ""),
          //   mercataUser: userAddress.toLowerCase().replace("0x", ""),
          // });

          // Mark withdrawal as pending approval
          const markPendingResponse = await bridgeContract.confirmWithdrawal({
            txHash: hash.toString().replace("0x", ""),
          });

          // Send email notification
          sendEmail(hash.toString());

          processedTransactions.push({
            originalTxHash: txHash,
            safeTxHash: hash.toString(),
            status: 'proposed',
            response: markPendingResponse
          });

          console.log(`✅ Successfully proposed Safe transaction for ${txHash}: ${hash.toString()}`);
          
        } catch (err: any) {
          console.error(`❌ Failed to process transaction ${transaction.key}:`, err);
          processedTransactions.push({
            originalTxHash: `0x${transaction.key}`,
            status: 'failed',
            error: err.message
          });
        }
      }
      
      console.log(`📊 Processed ${processedTransactions.length} withdrawal requested transactions`);
      
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  await poll();
  setInterval(poll, withdrawalInterval);
};

export const checkDepositInitiatedOnEthContract = async (pollingInterval: number = 5 * 60 * 1000) => {
  const poll = async () => {
    try {
      console.log('🔍 Checking for initiated deposits on Ethereum contract...');
      
      // For now, assume there is an Ethereum contract and fetch from there
      // This would typically involve monitoring Ethereum events or transactions
      // that indicate a deposit has been initiated
      
      // Example: Check for DepositInitiated events on Ethereum
      // This is a placeholder implementation - you'll need to adapt it based on your actual Ethereum contract
      
      try {
        // Get transaction details from the bridge contract
        const bridgeContract = new BridgeContractCall();
        
        // Example: Process a deposit (you'll need to replace this with actual logic)
        // to detect when deposits are initiated on Ethereum
        
                // For demonstration purposes, this shows how you would call the deposit method
        // when you detect an initiated deposit:
       
        // Based on contract function: deposit(uint256 srcChainId, string ethTxHash, address token, uint256 amount, address user)
        const depositResponse = await bridgeContract.depositInitiated({
          srcChainId: 1, // Ethereum mainnet chain ID (adjust as needed)
          ethTxHash: "example_hash", // Replace with actual ethTxHash from Ethereum
          token: "0x0000000000000000000000000000000000000000", // Replace with actual token address
          amount: "1000000000000000000", // Replace with actual amount in wei
          user: "0x0000000000000000000000000000000000000000", // Replace with actual user address
        });
        
        console.log('✅ Deposit marked as initiated:', depositResponse);
        
        
        // TODO: Implement actual Ethereum contract monitoring logic here
        // This could involve:
        // 1. Monitoring Ethereum events for DepositInitiated
        // 2. Checking transaction status on Ethereum
        // 3. Fetching transaction details from Ethereum blockchain
        // 4. Calling the bridge contract deposit method with the fetched data
        
        console.log('📝 Placeholder: Ethereum contract monitoring not yet implemented');
        
      } catch (err: any) {
        console.error('❌ Failed to process Ethereum deposit:', err);
      }
      
    } catch (e: any) {
      console.error('❌ Ethereum deposit polling error:', e.message);
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  // Run once now, then every specified interval
  await poll();
  setInterval(poll, pollingInterval);
};
