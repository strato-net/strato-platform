import axios from 'axios';
import { BigNumber } from 'bignumber.js';

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
}

const BRIDGE_API_BASE_URL = process.env.BRIDGE_API_BASE_URL || 'http://localhost:3002';

export class BridgeService {
  public async bridgeIn(params: BridgeInParams): Promise<any> {
    try {
      console.log("params",params);
      // Make API call to bridge service
      const response = await axios.post(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeIn`,
        {
          fromAddress: params.fromAddress,
          amount: new BigNumber(params.amount).multipliedBy(10**18).toString(),
          tokenAddress: params.tokenAddress,
          accessToken: params.accessToken,
          ethHash: params.ethHash || ''
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        status: response.data.status,
        hash: response.data.hash,
      };
    } catch (error: any) {
      console.log("error",error.message);
      throw error;
    }
  }

  public async bridgeOut(params: BridgeOutParams): Promise<any> {
    try {
      console.log(params);

      const response = await axios.post(
        `${BRIDGE_API_BASE_URL}/api/bridge/bridgeOut`,
        {
          amount: new BigNumber(params.amount).multipliedBy(10**18).toString(),
          toAddress: params.toAddress,
          tokenAddress: params.tokenAddress,
          accessToken: params.accessToken
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      console.log("response",response.data);

      return response.data;
    } catch (error: any) {
      console.log("Error in stratoToEth:", error.message);
      throw error;
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
          accessToken: params.accessToken
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // divide balance by 10^18
      const balance = new BigNumber(response.data.data.balance).div(10**18);
      return {
        balance: balance.toString(),
      };
    } catch (error: any) {
      console.log("Error in getBalance:", error.message);
      throw error;
    }
  }


  public async getUserDepositStatus(params: {
    accessToken: string;
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/userDepositStatus`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          }
        }
      );
      console.log('Bridge Service Response:', response.data);
      return response.data;
    } catch (error: any) {
      console.log("Error in get user deposit Status:", error.message);
      throw error;
    }
  }


  public async getUserWithdrawalStatus(params: {
    accessToken: string;
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/userWithdrawalStatus`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          }
        }
      );
      return response.data;
    } catch (error: any) {
      return null;
      throw error;
    }
  }
  

}
