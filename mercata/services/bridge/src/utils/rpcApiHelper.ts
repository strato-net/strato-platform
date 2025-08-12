import axios from 'axios';
import { getChainRpcUrl } from '../config';

// Get current block number for a chain
export const getCurrentBlockNumber = async (chainId: number): Promise<number> => {
  try {
    const rpcUrl = getChainRpcUrl(chainId);

    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    });

    return parseInt(response.data?.result, 16);
  } catch (error) {
    console.error(`❌ Failed to get current block for chain ${chainId}:`, error);
    throw error;
  }
};

// Get logs for a specific chain
export const getChainLogs = async (
  chainId: number,
  fromBlock: number, 
  toBlock: number, 
  depositRouter: string,
  eventSignature: string
): Promise<any[]> => {
  try {
    const rpcUrl = getChainRpcUrl(chainId);

    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [eventSignature],
        address: depositRouter
      }]
    });

    return response.data?.result || [];
  } catch (error) {
    console.error(`❌ Failed to get logs for chain ${chainId}:`, error);
    return [];
  }
};

// Check if chain RPC is configured
export const isChainConfigured = (chainId: number): boolean => {
  try {
    getChainRpcUrl(chainId);
    return true;
  } catch {
    return false;
  }
};
