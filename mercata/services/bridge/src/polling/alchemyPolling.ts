import axios from 'axios';
import { config } from '../config';
import { getBAUserToken } from '../auth';
import { confirmBridgeinSafePolling, confirmBridgeOutSafePolling } from '../services/bridgeService';
import SafeApiKit from "@safe-global/api-kit";

const NODE_URL = process.env.NODE_URL;

const apiKit = new SafeApiKit({ chainId: process.env.SHOW_TESTNET === 'true' ? 11155111n : 1n });

const ALCHEMY_URL = process.env.SHOW_TESTNET === 'true' ? 'https://eth-sepolia.g.alchemy.com/v2' : 'https://eth-mainnet.g.alchemy.com/v2';

const SEARCH_URL = "BlockApps-Mercata-MercataEthBridge";
// const MERCATA_URL = "MercataEthBridge" ;
const stripHexPrefix = (hashes: string[]): string[] =>
  hashes.map(hash => hash.replace('0x', '')
);

export const startDepositTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {
  console.log("🚀 Starting Alchemy get transaction polling");

  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-depositStatus?value=eq.1&order=block_timestamp.desc&address=eq.${config.bridge.address}`;
      console.log("🚀 url: step1", url);

      // Get token and log its details
      const token = await getBAUserToken();
      console.log("🔑 Token details for deposit polling:", {
        timestamp: new Date().toISOString(),
        tokenLength: token?.length,
        tokenPrefix: token?.substring(0, 10) + '...',
      });

      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      console.log("🚀 data: step1", data);

      if (!Array.isArray(data) || data.length === 0) {
        console.log('✅ No more transactions to fetch');
        return;
      }

      // Step 1: Extract txHashes
      const txHashes = data.map(({ key }: { key: string }) => `0x${key}`);
      console.log("🚀 txHashes: step1", txHashes);

      // Step 2: Batch call to get receipts
      const batch = txHashes.map((hash, i) => ({
        jsonrpc: '2.0',
        id: hash,
        method: 'eth_getTransactionReceipt',
        params: [hash],
      }));

      console.log("🚀 batch: step2", batch);
      console.log("🚀 ALCHEMY_URL: step2", ALCHEMY_URL);

      const { data: batchResponses } = await axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, batch);
      console.log("🚀 batchResponses: step3", batchResponses);

      // Step 3: Extract valid transactionHashes from receipts
      const completedTxHashes = batchResponses.filter((res: any) => res?.result?.status === "0x1");
      console.log("🚀 validTxHashes: step4", completedTxHashes);

      if (!completedTxHashes.length) {
        console.log('⚠️ No valid receipts with transaction hashes found');
        return;
      }

      await confirmBridgeinSafePolling(completedTxHashes);
    } catch (e: any) {
      console.error('❌ Polling error:', {
        message: e.message,
        status: e.response?.status,
        data: e.response?.data,
        timestamp: new Date().toISOString()
      });
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};

export const startWithdrawalTxPolling = async (pollingInterval: number = 5 * 60 * 1000) => {
  console.log("🚀 Starting Alchemy withdrawal transaction polling");

  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-withdrawStatus?value=eq.2&order=block_timestamp.desc&address=eq.${config.bridge.address}`;
      console.log("🚀 url: step1", url);
      
      // Get token and log its details
      const token = await getBAUserToken();
      console.log("🔑 Token details for withdrawal polling:", {
        timestamp: new Date().toISOString(),
        tokenLength: token?.length,
        tokenPrefix: token?.substring(0, 10) + '...',
      });

      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!Array.isArray(data) || data.length === 0) {
        console.log('✅ No more transactions to fetch');
        return;
      }

      // Step 1: Extract txHashes
      const txHashes = data.map(({ key }: { key: string }) => `0x${key}`);
      console.log("🚀 txHashes: step1", txHashes);
      const approvedTxHashes = [];
      
      for (const txHash of txHashes) {
        try {
          const safeTransaction = await apiKit.getTransaction(txHash);
          console.log("🚀 safeTransaction: step2", safeTransaction);
          if(safeTransaction.isExecuted === true){
            approvedTxHashes.push(txHash);
          }
          console.log("🚀 approvedTxHashes: step3", approvedTxHashes);
        } catch (err) {
          console.error(`❌ Failed to process transaction ${txHash}:`, err);
        }
      }
      
      const strippedHashes = stripHexPrefix(approvedTxHashes);
      console.log("🚀 strippedHashes: step4", strippedHashes);
      await confirmBridgeOutSafePolling(strippedHashes);
    } catch (e: any) {
      console.error('❌ Polling error:', {
        message: e.message,
        status: e.response?.status,
        data: e.response?.data,
        timestamp: new Date().toISOString()
      });
      // Don't stop polling on errors, let it retry on next interval
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};
