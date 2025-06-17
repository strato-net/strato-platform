import axios from 'axios';
import { getBAUserToken } from '../auth';
import { getExchangeTokenInfoBridgeOut, TESTNET_STRATO_TOKENS } from '../config';

const NODE_URL = process.env.NODE_URL;

// Helper to normalize Ethereum address (lowercase + remove '0x' prefix)
const normalizeAddress = (address: string) => address?.replace(/^0x/i, '').toLowerCase();

export const fetchDepositInitiatedStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
): Promise<any | null> => {
  const accessToken = await getBAUserToken();
  if (!accessToken) return null;

  try {
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';
    const selectFields = 'select=txHash,from,token,amount,to,mercataUser,address,transaction_hash,block_timestamp';

    const cirrusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?${selectFields}&mercataUser=eq.${userAddress}${limitParam}${offsetParam}${orderByParam}`;
    const response = await axios.get(cirrusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      return { success: true, data: [], totalCount: 0 };
    }

    const depositData = response.data;

    // Collect all txHashes
    const txHashes = depositData.map((item: any) => item.txHash).filter(Boolean);
    const txHashList = txHashes.map((hash) => encodeURIComponent(hash)).join(',');

    const depositStatusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-depositStatus?key=in.(${txHashList})&select=key,value`;

    const depositStatusResponse = await axios.get(depositStatusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const statusMap = new Map<string, string>();
    if (Array.isArray(depositStatusResponse.data)) {
      depositStatusResponse.data.forEach((entry: any) => {
        if (entry?.key) statusMap.set(entry.key, entry.value);
      });
    }

    const enrichedData = depositData.map((item: any) => {
      const normalizedToken = normalizeAddress(item.token || '');

      const getEthTokenInfo = '0x' + item.token || '';
      const { exchangeTokenName, exchangeTokenSymbol ,exchangeTokenAddress} = getExchangeTokenInfoBridgeOut(getEthTokenInfo, true);

      const matchedToken = TESTNET_STRATO_TOKENS.find(
        (token) => normalizeAddress(token.tokenAddress) === normalizedToken
      );
      return {
        ...item,
        depositStatus: statusMap.get(item.txHash) || null,
        tokenSymbol: matchedToken?.symbol || null,
        tokenDecimal: matchedToken?.decimals ?? null,
        ethTokenName: exchangeTokenName,
        ethTokenSymbol: exchangeTokenSymbol,
        ethTokenAddress: exchangeTokenAddress
      };
    });

    const totalTransactionCountUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?mercataUser=eq.${userAddress}&select=count`;
    const totalTransactionCountResponse = await axios.get(totalTransactionCountUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    console.log("totalTransactionCountResponse", totalTransactionCountResponse.data);

    return {
      success: true,
      data: enrichedData,
      totalCount: totalTransactionCountResponse.data?.[0]?.count || 0
    };

  } catch (error: any) {
    console.error("Error in fetchDepositInitiatedStatus:", error.message);
    return null;
  }
};


export const fetchWithdrawalInitiatedStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
): Promise<any | null> => {
  const accessToken = await getBAUserToken();
  if (!accessToken) return null;

  try {
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';
    const selectFields = 'select=txHash,from,token,amount,to,mercataUser,address,transaction_hash,block_timestamp';

    const cirrusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?${selectFields}&mercataUser=eq.${userAddress}${limitParam}${offsetParam}${orderByParam}`;
    const response = await axios.get(cirrusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      return { success: true, data: [], totalCount: 0 };
    }

    const withdrawalData = response.data;

    // Collect all txHashes
    const txHashes = withdrawalData.map((item: any) => item.txHash).filter(Boolean);
    const txHashList = txHashes.map((hash) => encodeURIComponent(hash)).join(',');

    const withdrawalStatusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-withdrawStatus?key=in.(${txHashList})&select=key,value`;

    const withdrawalStatusResponse = await axios.get(withdrawalStatusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const statusMap = new Map<string, string>();
    if (Array.isArray(withdrawalStatusResponse.data)) {
      withdrawalStatusResponse.data.forEach((entry: any) => {
        if (entry?.key) statusMap.set(entry.key, entry.value);
      });
    }

    const enrichedData = withdrawalData.map((item: any) => {
      const normalizedToken = normalizeAddress(item.token || '');

      const getEthTokenInfo = '0x' + item.token || '';
      const { exchangeTokenName, exchangeTokenSymbol, exchangeTokenAddress } = getExchangeTokenInfoBridgeOut(getEthTokenInfo, true);

      const matchedToken = TESTNET_STRATO_TOKENS.find(
        (token) => normalizeAddress(token.tokenAddress) === normalizedToken
      );

      return {
        ...item,
        withdrawalStatus: statusMap.get(item.txHash) || null,
        tokenSymbol: matchedToken?.symbol || null,
        tokenDecimal: matchedToken?.decimals ?? null,
        ethTokenName: exchangeTokenName,
        ethTokenSymbol: exchangeTokenSymbol,
        ethTokenAddress: exchangeTokenAddress
      };
    });

    const totalTransactionCountUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?mercataUser=eq.${userAddress}&select=count`;
    const totalTransactionCountResponse = await axios.get(totalTransactionCountUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    console.log("totalTransactionCountResponse (withdrawal):", totalTransactionCountResponse.data);

    return {
      success: true,
      data: enrichedData,
      totalCount: totalTransactionCountResponse.data?.[0]?.count || 0
    };

  } catch (error: any) {
    console.error("Error in fetchWithdrawalInitiatedStatus:", error.message);
    return null;
  }
};


export const fetchDepositInitiated = async (txHash: string): Promise<any | null> => {
  const accessToken = await getBAUserToken();

  if (!accessToken) return null;
  try {
    console.log("fetching deposit initiated url ",`${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.DepositInitiated?txHash=eq.${txHash}`)
    const depositInitiatedResponse = await axios.get(`${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.DepositInitiated?txHash=eq.${txHash}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return depositInitiatedResponse.data;
  } catch (error: any) {
    return null;
  }
}; 



