import axios from 'axios';
import { getUserToken } from '../auth';
import { getUserAddressFromToken } from '../utils';
import { TESTNET_STRATO_TOKENS } from '../config';

const NODE_URL = process.env.NODE_URL;

// Helper to normalize Ethereum address (lowercase + remove '0x' prefix)
const normalizeAddress = (address: string) => address?.replace(/^0x/i, '').toLowerCase();

export const fetchDepositInitiatedStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string
): Promise<any | null> => {
  const accessToken = await getUserToken();
  const userAddress = await getUserAddressFromToken(accessToken);
  if (!accessToken) return null;

  try {
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';

    const cirrusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?mercataUser=eq.${userAddress}${limitParam}${offsetParam}${orderByParam}`;

    console.log("userAddress in deposit status", userAddress);
    console.log("fetching deposit status Cirrus URL:", cirrusUrl);

    const response = await axios.get(cirrusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      return { success: true, data: [], totalCount: 0 };
    }

    const depositData = response.data;

    const enrichedData = await Promise.all(
      depositData.map(async (item: any) => {
        const normalizedToken = normalizeAddress(item.token || '');

        const matchedToken = TESTNET_STRATO_TOKENS.find(
          (token) => normalizeAddress(token.tokenAddress) === normalizedToken
        );

        let depositStatus = null;
        try {
          const statusResponse = await axios.get(
            `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-depositStatus?key=eq.${item.txHash}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );
          depositStatus = statusResponse.data?.[0]?.value || null;
        } catch (error: any) {
          console.error("Error fetching status for txHash:", item.txHash, ":", error.message);
        }

        return {
          ...item,
          depositStatus,
          tokenSymbol: matchedToken?.symbol || null,
          tokenDecimal: matchedToken?.decimals ?? null
        };
      })
    );

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
  pageNo?: string
): Promise<any | null> => {
  const accessToken = await getUserToken();
  const userAddress = await getUserAddressFromToken(accessToken);
  if (!accessToken) return null;

  try {
    // Build pagination params
    const limitParam = limit ? `&limit=${limit}` : '';
    const offsetParam = (pageNo && limit) ? `&offset=${(Number(pageNo) - 1) * Number(limit)}` : '';
    const orderByParam = orderBy ? `&order=${orderBy}.${orderDirection || 'desc'}` : '';

    const cirrusUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.${status}?mercataUser=eq.${userAddress}${limitParam}${offsetParam}${orderByParam}`;

    console.log("userAddress in withdrawal status:", userAddress);
    console.log("fetching withdrawal status Cirrus URL:", cirrusUrl);

    const response = await axios.get(cirrusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      return { success: true, data: [], totalCount: 0 };
    }

    const withdrawalData = response.data;

    // Enrich with withdrawalStatus and tokenSymbol
    const enrichedData = await Promise.all(
      withdrawalData.map(async (item: any) => {
        const normalizedToken = normalizeAddress(item.token || '');

        // Find token symbol from config
        const matchedToken = TESTNET_STRATO_TOKENS.find(
          (token:any) => normalizeAddress(token.tokenAddress) === normalizedToken
        );

        let withdrawalStatus = null;
        try {
          const statusResponse = await axios.get(
            `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge-withdrawStatus?key=eq.${item.txHash}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );
          withdrawalStatus = statusResponse.data?.[0]?.value || null;
        } catch (error: any) {
          console.error("Error fetching status for txHash:", item.txHash, ":", error.message);
        }

        return {
          ...item,
          withdrawalStatus,
          tokenSymbol: matchedToken?.symbol || null,
          tokenDecimal: matchedToken?.decimals ?? null
        };
      })
    );

    // Fetch total count
    const totalTransactionCountUrl = `${NODE_URL}/cirrus/search/BlockApps-Mercata-MercataEthBridge.WithdrawalInitiated?mercataUser=eq.${userAddress}&select=count`;

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
  const accessToken = await getUserToken();

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