import axios from 'axios';
import { config } from '../config';
import { getUserToken } from '../auth';

export interface BridgeTransaction {
  transaction_hash: string;
  withdrawId: string;
  amount: string;
  ethRecipient: string;
  timestamp: string;
  // Add other fields as needed
}

export async function getAllBridgeTransactions(type: string, limit?: number, offset?: number): Promise<BridgeTransaction[]> {
  try {
    const accessToken = await getUserToken();
    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    const eventType = type === 'withdrawalinitiated' 
      ? 'MercataEthBridge.WithdrawalInitiated'
      : 'MercataEthBridge.DepositRecorded';

    const params: any = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    params.order = 'block_timestamp.desc';

    const response = await axios.get(
      `${process.env.NODE_URL}/cirrus/search/${eventType}`,
      {
        headers: {
          accept: "application/json;charset=utf-8",
          "content-type": "application/json;charset=utf-8",
          authorization: `Bearer ${accessToken}`,
        },
        params,
      }
    );

    return response.data;
  } catch (error: any) {
    console.error("Error fetching bridge transactions:", error?.message);
    if (error.response) {
      console.error("API Error Response:", error.response.data);
      console.error("API Error Status:", error.response.status);
    }
    throw error;
  }
} 