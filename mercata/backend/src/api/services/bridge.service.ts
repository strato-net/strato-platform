import axios from 'axios';
import { 
  fetchDepositInitiatedStatus, 
  fetchWithdrawalInitiatedStatus,
  fetchDepositInitiatedTransactions
} from './cirrusService';
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";

interface BridgeInParams {
  amount: string;
  fromAddress: string;
  accessToken: string;
  tokenAddress: string;
  ethHash: string;
}

interface BridgeOutParams {
  amount: string;
  toAddress: string;
  tokenAddress: string;
  accessToken: string;
  userAddress: string;
}

const BRIDGE_API_BASE_URL = process.env.BRIDGE_API_BASE_URL || 'http://localhost:3003';

export class BridgeService {
  public async bridgeIn(params: BridgeInParams): Promise<any> {
    try {
      const response = await axios.post(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeIn`,
        {
          fromAddress: params.fromAddress,
          amount: params.amount,
          tokenAddress: params.tokenAddress,
          ethHash: params.ethHash || ''
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.accessToken}`
          }
        }
      );
  
      return {
        status: response.data.status,
        hash: response.data.hash,
      };
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }
  

  public async bridgeOut(params: BridgeOutParams): Promise<any> {
    try {
      // Comment out the existing API call
      /*
      const response = await axios.post(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeOut`,
        {
          amount: params.amount,
          toAddress: params.toAddress,
          tokenAddress: params.tokenAddress,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.accessToken}`
          }
        }
      );

      return response.data;
      */

      // New contract call to emit WithdrawalRequested event
      const bridgeContractName = extractContractName(constants.MercataEthBridge);
      const bridgeContractAddress = process.env.BRIDGE_ADDRESS;
      
      if (!bridgeContractAddress) {
        throw new Error("Bridge contract address not configured");
      }

      // Generate a unique ID for the withdrawal request
      const withdrawalId = Date.now().toString();
      
      // Assuming destChainId is 1 for Ethereum mainnet (you may need to adjust this)
      const destChainId = "1";
      
      const tx = buildFunctionTx({
        contractName: bridgeContractName,
        contractAddress: bridgeContractAddress,
        method: "requestWithdrawal", // change method name
        args: {
          id: withdrawalId,
          destChainId: destChainId,
          token: params.tokenAddress,
          amount: params.amount,
           user: params.userAddress, // Use the actual user address from the token
          dest: params.toAddress
        },
      });

      const { status, hash } = await postAndWaitForTx(params.accessToken, () =>
        strato.post(params.accessToken, StratoPaths.transactionParallel, tx)
      );

      return {
        status,
        hash,
        withdrawalId,
        message: "Withdrawal request submitted successfully"
      };
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

  public async getBalance(params: {
    accessToken: string;
    tokenAddress: string;
  }): Promise<any> {
    try {
      // Balance endpoint
      const response = await axios.post(
        `${BRIDGE_API_BASE_URL}/api/bridge/stratoTokenBalance`,
        {
          tokenAddress: params.tokenAddress,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.accessToken}`
          }
        }
      );

      // divide balance by 10^18
      const balance = response.data.data.balance;
      return {
        balance: balance.toString(),
      };
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

  public async getUserDepositStatus(params: {
    accessToken: string;
    status: string;
    limit?: number;
    orderBy?: string;
    orderDirection?: string;
    pageNo?: string;
    userAddress?: string;
  }): Promise<any> {
    try {
      // Call cirrus function directly instead of external bridge service
      const result = await fetchDepositInitiatedStatus(
        params.accessToken,
        params.status,
        params.limit,
        params.orderBy,
        params.orderDirection,
        params.pageNo,
        params.userAddress
      );
      
      if (!result) {
        throw new Error('Failed to fetch deposit status');
      }
      
      return result;
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

  public async getUserWithdrawalStatus(params: {
    accessToken: string;
    status: string;
    limit?: number;
    orderBy?: string;
    orderDirection?: string;
    pageNo?: string;
    userAddress?: string;
  }): Promise<any> {
    try {
      // Call cirrus function directly instead of external bridge service
      const result = await fetchWithdrawalInitiatedStatus(
        params.accessToken,
        params.status,
        params.limit,
        params.orderBy,
        params.orderDirection,
        params.pageNo,
        params.userAddress
      );
      
      if (!result) {
        throw new Error('Failed to fetch withdrawal status');
      }
      
      return result;
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }
  
  public async getBridgeInTokens(params: {
    accessToken: string;
    type: string;
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeInTokens`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          }
        }
      );
      return response.data;
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

  public async getBridgeOutTokens(params: {
    accessToken: string;
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeOutTokens`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          }
        }
      );
      return response.data;
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

  public async getEthereumConfig(): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/ethereumConfig`
      );
      return response.data;
    } catch (error: any) {
      // Extract error message from axios error response
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred');
      }
    }
  }

}
