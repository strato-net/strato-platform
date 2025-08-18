import { fetch } from '../utils/api';
import { getChainRpcUrl } from '../config';
import { ensureHexPrefix, decimalToHex } from '../utils/utils';

// Get current block number for a chain
export const getCurrentBlockNumber = async (chainId: number): Promise<number> => {
  const rpcUrl = getChainRpcUrl(chainId);
  const response: any = await fetch.post(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_blockNumber',
    params: []
  });
  return parseInt(response?.result || '0', 16);
};

// Get logs for a specific chain
export const getChainLogs = async (
  chainId: number,
  fromBlock: number, 
  toBlock: number, 
  depositRouter: string,
  eventSignature: string
): Promise<any[]> => {
  const rpcUrl = getChainRpcUrl(chainId);
  
  // Ensure depositRouter has 0x prefix
  const formattedAddress = ensureHexPrefix(depositRouter);
  
  const response: any = await fetch.post(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getLogs',
    params: [{
      fromBlock: decimalToHex(fromBlock.toString()),
      toBlock: decimalToHex(toBlock.toString()),
      topics: [eventSignature],
      address: formattedAddress
    }]
  });
  return response?.result || [];
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
