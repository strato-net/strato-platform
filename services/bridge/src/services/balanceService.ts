import axios from 'axios';
import { Request, Response } from 'express';
import { config } from '../config';
import { getUserToken } from '../auth';
import logger from '../utils/logger';

const nodeUrl = process.env.NODE_URL;

export async function fetchUserBalance(address: string): Promise<{ address: string; balance: string }> {
  try {
    if (!nodeUrl) {
      throw new Error('NODE_URL environment variable is not configured');
    }

    if (!config.bridge.tokenAddress) {
      throw new Error('BRIDGE_TOKEN_ADDRESS environment variable is not configured');
    }

    const accessToken = await getUserToken();
    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    const txPayload = {
      txs: [
        {
          payload: {
            contractName: "Token",
            contractAddress: config.bridge.tokenAddress.toLowerCase().replace("0x", ""),
            method: "balanceOf",
            args: {
                accountAddress: address.toLowerCase().replace("0x", "")
            }
          },
          type: "FUNCTION"
        }
      ],
      txParams: {
        gasLimit: 150000,
        gasPrice: 30000000000
      }
    };

    logger.info('Sending request to node:', {
      url: `${nodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
      payload: txPayload
    });

    const response = await axios.post(
      `${nodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
      txPayload,
      {
        headers: {
          accept: "application/json;charset=utf-8",
          "content-type": "application/json;charset=utf-8",
          authorization: `Bearer ${accessToken}`
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      }
    );

    logger.info('Received response:', response.data);

    if (!response.data || !response.data[0]?.data?.contents?.[0]) {
      throw new Error("Invalid response format from node");
    }

    const balance = response.data[0].data.contents[0].toString();

    return {
      address,
      balance
    };
  } catch (error: any) {
    logger.error("Error in fetchUserBalance:", error?.message);
    if (error.response) {
      logger.error("API Error Response:", error.response.data);
      logger.error("API Error Status:", error.response.status);
      logger.error("API Error Headers:", error.response.headers);
    } else if (error.request) {
      logger.error("No response received. Request details:", error.request);
    } else {
      logger.error("Error setting up request:", error.message);
    }
    throw error;
  }
}

export const getUserBalance = async (req: Request, res: Response) => {
  logger.info('=== Balance Service Debug Logs ===');
  logger.info('Request params:', req.params);
  logger.info('Request query:', req.query);

  try {
    const { address } = req.params;
    
    logger.info('Fetching balance for address:', address);

    if (!address) {
      logger.error('Error: Address is missing');
      res.status(400).json({
        success: false,
        error: 'Address is required'
      });
      return;
    }

    const balanceData = await fetchUserBalance(address);
    logger.info('Successfully fetched balance:', balanceData);

    res.json({
      success: true,
      data: {
        balance: balanceData.balance || '0'
      }
    });
  } catch (error: any) {
    logger.error('Error in getUserBalance:', error?.message);
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    });
  }
}; 