import axios from 'axios';

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
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/userDepositStatus/${params.status}`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          },
          params: {
            limit: params.limit,
            orderBy: params.orderBy,
            orderDirection: params.orderDirection,
            pageNo: params.pageNo
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


  public async getUserWithdrawalStatus(params: {
    accessToken: string;
    status: string;
    limit?: number;
    orderBy?: string;
    orderDirection?: string;
    pageNo?: string;
  }): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/userWithdrawalStatus/${params.status}`,
        {
          headers: {
            'Authorization': `Bearer ${params.accessToken}`
          },
          params: {
            limit: params.limit,
            orderBy: params.orderBy,
            orderDirection: params.orderDirection,
            pageNo: params.pageNo
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

  public async getBridgeConfig(): Promise<any> {
    try {
      const response = await axios.get(
        `${BRIDGE_API_BASE_URL}/api/bridge/config`
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
