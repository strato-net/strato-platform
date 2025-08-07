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
  const poll = async () => {
    try {
      const url = `${NODE_URL}/cirrus/search/${SEARCH_URL}-depositStatus?value=eq.1&order=block_timestamp.desc&address=eq.${config.bridge.address}`;

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
