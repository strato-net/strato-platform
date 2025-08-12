import axios from 'axios';
import { 
  NODE_URL, 
  MERCATA_URL, 
  TESTNET_STRATO_TOKENS, 
  getExchangeTokenInfoBridgeOut 
} from '../../config/bridge.config';

// Helper to normalize Ethereum address (lowercase + remove '0x' prefix)
const normalizeAddress = (address: string) => address?.replace(/^0x/i, '').toLowerCase();

export const fetchDepositInitiatedStatus = async (
  accessToken: string,
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
): Promise<any | null> => {
  if (!accessToken) return null;

  try {
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';
    const selectFields = 'select=txHash,from,token,amount,to,mercataUser,address,transaction_hash,block_timestamp';

    const bridgeAddress = process.env.BRIDGE_ADDRESS || '';
    const cirrusUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}.${status}?${selectFields}&mercataUser=eq.${userAddress}&address=eq.${bridgeAddress}${limitParam}${offsetParam}${orderByParam}`;
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
    const depositStatusUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}-depositStatus?key=in.(${txHashList})&select=key,value`;

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
      const { exchangeTokenName, exchangeTokenSymbol, exchangeTokenAddress } = getExchangeTokenInfoBridgeOut(getEthTokenInfo, true);

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

    const totalTransactionCountUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}.${status}?mercataUser=eq.${userAddress}&address=eq.${bridgeAddress}&select=count`;
    const totalTransactionCountResponse = await axios.get(totalTransactionCountUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
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
  accessToken: string,
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
): Promise<any | null> => {
  if (!accessToken) return null;

  try {
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';
    const selectFields = 'select=txHash,from,token,amount,to,mercataUser,address,transaction_hash,block_timestamp';

    const bridgeAddress = process.env.BRIDGE_ADDRESS || '';
    const cirrusUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}.${status}?${selectFields}&mercataUser=eq.${userAddress}&address=eq.${bridgeAddress}${limitParam}${offsetParam}${orderByParam}`;
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

    const withdrawalStatusUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}-withdrawStatus?key=in.(${txHashList})&select=key,value`;

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

    const totalTransactionCountUrl = `${NODE_URL}/cirrus/search/${MERCATA_URL}.${status}?mercataUser=eq.${userAddress}&&address=eq.${bridgeAddress}&select=count`;
    const totalTransactionCountResponse = await axios.get(totalTransactionCountUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

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

export const fetchDepositInitiated = async (
  accessToken: string,
  txHash: string
): Promise<any | null> => {
  if (!accessToken) return null;
  
  try {
    const depositInitiatedResponse = await axios.get(`${NODE_URL}/cirrus/search/${MERCATA_URL}.DepositInitiated?txHash=eq.${txHash}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return depositInitiatedResponse.data;
  } catch (error: any) {
    return null;
  }
};

export const fetchDepositInitiatedTransactions = async (
  accessToken: string,
  transactionHashes: string[]
): Promise<any[]> => {
  if (!accessToken || transactionHashes.length === 0) return [];

  const queryFields = 'select=txHash,token,amount,to,mercataUser';

  // Normalize and strip '0x' prefix from hashes
  const normalizedHashes = transactionHashes.map((hash) =>
    hash.replace(/^0x/, "")
  );

  const hashQueryParam = normalizedHashes.join(',');
  const endpoint = `${NODE_URL}/cirrus/search/${MERCATA_URL}.DepositInitiated?txHash=in.(${hashQueryParam})&${queryFields}`;

  try {
    const response = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error: any) {
    console.error("❌ Error fetching DepositInitiated transactions:", error.message);
    return [];
  }
}; 