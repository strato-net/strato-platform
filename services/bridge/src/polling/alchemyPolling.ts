import axios from 'axios';
import { Alchemy, Network } from 'alchemy-sdk';
import { config } from '../config';
import { getBAUserToken } from '../auth';
import { confirmBridgeIn, confirmBridgeOut, confirmBridgeOutSafePolling } from '../services/bridgeService';
import SafeApiKit from "@safe-global/api-kit";

const NODE_URL = process.env.NODE_URL;

const apiKit = new SafeApiKit({ chainId: process.env.SHOW_TESTNET === 'true' ? 11155111n : 1n });

const ALCHEMY_URL = process.env.SHOW_TESTNET === 'true' ? 'https://eth-sepolia.g.alchemy.com/v2' : 'https://eth-mainnet.g.alchemy.com/v2';

let page = 1;

export const startDepositTxPolling = async () => {
  console.log("🚀 Starting Alchemy get transaction polling");

  const token = await getBAUserToken();
  if (!token) return console.error('❌ No access token');

  let page = 1;

  const poll = async () => {
    try {
      const offset = (page++ - 1) * 10;
      const url = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-depositStatus?value=eq.1&order=block_timestamp.desc&limit=10&offset=${offset}`;

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
      const validTxHashes = batchResponses
        .map((res: any) => res?.id)
        .filter((hash: string) => !!hash);

      console.log("🚀 validTxHashes: step4", validTxHashes);

      if (!validTxHashes.length) {
        console.log('⚠️ No valid receipts with transaction hashes found');
        return;
      }

      // Step 4: Batch call to get full transaction details
      const txBatch = validTxHashes.map((hash:string) => ({
        jsonrpc: '2.0',
        id: hash,
        method: 'eth_getTransactionByHash',
        params: [hash],
      }));

      console.log("🚀 txBatch: step5", txBatch);

      const { data: txResponses } = await axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`,txBatch);
      console.log("🚀 txResponses: step6", txResponses);

      // Step 5: Process transactions
      for (const res of txResponses) {
        const tx = res?.result;
        if (!tx) {
          console.warn(`⚠️ Missing transaction for ID ${res.id}`);
          continue;
        }
        console.log('📦 TX found: step7', tx);
        // await confirmBridgeIn(tx);
      }
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
    }
  };

  // Run once now, then every 5 minutes
  await poll();
  setInterval(poll, 5 * 60 * 1000);
};


export const startWithdrawalTxPolling = async () => {
  console.log("🚀 Starting Alchemy withdrawal transaction polling");

  const token = await getBAUserToken();
  if (!token) return console.error('❌ No access token');

  let page = 1;

  const poll = async () => {
    try {
      const offset = (page++ - 1) * 10;
      const url = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-withdrawStatus?value=eq.2&order=block_timestamp.desc&limit=10&offset=${offset}`;

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

      for (const txHash of txHashes) {
        try {
          const safeTransaction = await apiKit.getTransaction(txHash);
          const allTransactions = await apiKit.getAllTransactions(config.safe.address as string);
          console.log("🚀 allTransactions: step2", allTransactions);
          console.log("🚀 safeTransaction: step2", safeTransaction);
          await confirmBridgeOutSafePolling(safeTransaction);
        } catch (err) {
          console.error(`❌ Failed to process transaction ${txHash}:`, err);
        }
      }
     
    
    } catch (e: any) {
      console.error('❌ Polling error:', e.message);
    }
  };

  // Run once now, then every 5 minutes
  await poll();
  setInterval(poll, 5 * 60 * 1000);
};
