import axios from 'axios';
import { config } from '../config';
import { getUserToken } from '../auth';
import logger from '../utils/logger';
import { handleBridgeInProposeTransaction } from '../events/bridgeIn';

export interface BridgeTransaction {
  transaction_hash: string;
  withdrawId: string;
  amount: string;
  ethRecipient: string;
  timestamp: string;
  // Add other fields as needed
}

interface BridgeTransactionParams {
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenAddress: string;
  ethHash: string;
}

const NODE_URL = process.env.NODE_URL;

export async function getAllBridgeTransactions(type: string, limit?: number, offset?: number): Promise<BridgeTransaction[]> {
  try {
    const accessToken = await getUserToken();
    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    let eventType;
    if (type === 'withdrawalinitiated') {
      eventType = 'MercataEthBridge.WithdrawalInitiated';
    } else if (type === 'withdrawalpendingapproval') {
      eventType = 'MercataEthBridge.WithdrawalPendingApproval';
    } else if (type === 'withdrawalcompleted') {
      eventType = 'MercataEthBridge.WithdrawalCompleted';
    } else if (type === 'depositrecorded') {
      eventType = 'MercataEthBridge.DepositRecorded';
    } else {
      throw new Error("Invalid transaction type");
    }

    const params: any = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    params.order = 'block_timestamp.desc';

    const response = await axios.get(
      `${NODE_URL}/cirrus/search/${eventType}`,
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

export async function processBridgeTransaction(params: BridgeTransactionParams): Promise<void> {
  try {
    // Log all received parameters
    logger.info('Bridge Transaction Parameters:', {
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      amount: params.amount,
      tokenAddress: params.tokenAddress,
      ethHash: params.ethHash
    });

    // Call handleBridgeInProposeTransaction with the transaction details
    await handleBridgeInProposeTransaction({
      hash: params.ethHash,
      value: params.amount,
      from: params.fromAddress,
      token: params.tokenAddress
    });

    logger.info('Bridge transaction processed successfully');

  } catch (error) {
    logger.error('Error processing bridge transaction:', error);
    throw error;
  }
} 