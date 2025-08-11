import axios from 'axios';
import {
  TESTNET_ERC20_TOKEN_CONTRACTS,
  MAINNET_ERC20_TOKEN_CONTRACTS,
  TESTNET_ETH_STRATO_TOKEN_MAPPING,
  MAINNET_ETH_STRATO_TOKEN_MAPPING,
} from '../../config/bridge.config';
import safeTransactionGenerator from './safe.service';
import BridgeContractCall from '../../utils/bridgeContractCall';
import sendEmail from './email.service';

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

  public async bridgeOutDirect(
    tokenAddress: string,
    fromAddress: string,
    amount: string,
    toAddress: string,
    userAddress: string
  ): Promise<any> {
    const isTestnet = process.env.SHOW_TESTNET === "true";
    const tokenContract = isTestnet
      ? TESTNET_ERC20_TOKEN_CONTRACTS
      : MAINNET_ERC20_TOKEN_CONTRACTS;

    const tokenMapping = isTestnet
      ? TESTNET_ETH_STRATO_TOKEN_MAPPING
      : MAINNET_ETH_STRATO_TOKEN_MAPPING;

    const ethTokenAddress: any =
      Object.entries(tokenMapping).find(
        ([_, value]) => value.toLowerCase() === tokenAddress.toLowerCase()
      )?.[0] || null;

    const isERC20 = tokenContract.find((token: any) => token === ethTokenAddress);

    const generator = await safeTransactionGenerator(
      amount,
      toAddress,
      isERC20 ? "erc20" : "eth",
      ethTokenAddress
    );
    const {
      value: { hash },
    } = await generator.next();

    const bridgeContract = new BridgeContractCall();
    await bridgeContract.withdraw({
      txHash: hash.toString().replace("0x", ""),
      token: tokenAddress.toLowerCase().replace("0x", ""),
      from: fromAddress.toLowerCase().replace("0x", ""),
      amount: amount.toString(),
      to: toAddress.toLowerCase().replace("0x", ""),
      mercataUser: userAddress.toLowerCase().replace("0x", ""),
    });

    const {
      value: { success },
    } = await generator.next();

    const markPendindResponse =
      await bridgeContract.markWithdrawalPendingApproval({
        txHash: hash.toString().replace("0x", ""),
      });

    sendEmail(hash.toString());

    return markPendindResponse;
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
