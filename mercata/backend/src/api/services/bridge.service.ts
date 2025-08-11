import axios from 'axios';
import { nodeUrl } from '../../config/config';
import BridgeContractCall from '../../utils/bridgeContractCall';
import safeTransactionGenerator, { checkEthTransaction } from '../../utils/safeService';
import sendEmail from '../../utils/emailService';
import { 
  getCurrentConfig,
  TESTNET_ERC20_TOKEN_CONTRACTS,
  MAINNET_ERC20_TOKEN_CONTRACTS,
  TESTNET_ETH_STRATO_TOKEN_MAPPING,
  MAINNET_ETH_STRATO_TOKEN_MAPPING
} from '../../config/bridgeConfig';

interface BridgeOutParams {
  amount: string;
  toAddress: string;
  tokenAddress: string;
  accessToken: string;
}

// New interface for bridge-out using Ethereum contract data
interface EthereumBridgeOutParams {
  tokenAddress: string;
  fromAddress: string;
  amount: string;
  toAddress: string;
  userAddress: string;
}

interface BridgeInParams {
  ethHash: string;
  tokenAddress: string;
  fromAddress: string;
  amount: string;
  toAddress: string;
  userAddress: string;
  accessToken?: string; // Optional for backward compatibility
}

const BRIDGE_API_BASE_URL = process.env.BRIDGE_API_BASE_URL || 'http://localhost:3003';

export class BridgeService {
  // COMMENTED OUT - HTTP-based bridgeIn method
  // public async bridgeIn(params: BridgeInParams): Promise<any> {
  //   try {
  //     const response = await axios.post(
  //       `${BRIDGE_API_BASE_URL}/api/bridge/bridgeIn`,
  //       {
  //         fromAddress: params.fromAddress,
  //         amount: params.amount,
  //         tokenAddress: params.tokenAddress,
  //         ethHash: params.ethHash || ''
  //       },
  //       {
  //         headers: {
  //           'Content-Type': 'application/json',
  //           Authorization: `Bearer ${params.accessToken}`
  //         }
  //       }
  //     );
  
  //     return {
  //       status: response.data.status,
  //       hash: response.data.hash,
  //     };
  //   } catch (error: any) {
  //     // Extract error message from axios error response
  //     if (error.response?.data?.message) {
  //       throw new Error(error.response.data.message);
  //     } else if (error.message) {
  //       throw new Error(error.message);
  //     } else {
  //       throw new Error('Unknown error occurred');
  //     }
  //   }
  // }

  // Simple bridge-in function using interface - same structure as original bridge service
  public async bridgeIn(params: BridgeInParams): Promise<any> {
    try {
      // Get data from Ethereum contract (imaginary for now)
      // In real scenario, this would call the actual Ethereum contract
      const ethereumData = {
        userAddress: params.userAddress || params.fromAddress,
        tokenAddress: params.tokenAddress,
        amount: params.amount,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        ethHash: params.ethHash
      };

      const bridgeContract = new BridgeContractCall();

      const depositResponse = await bridgeContract.deposit({
        txHash: ethereumData.ethHash.toString().replace("0x", ""),
        token: ethereumData.tokenAddress.toLowerCase().replace("0x", ""),
        from: ethereumData.fromAddress.toLowerCase().replace("0x", ""),
        amount: ethereumData.amount.toString(),
        to: ethereumData.toAddress.toLowerCase().replace("0x", ""),
        mercataUser: ethereumData.userAddress.toLowerCase().replace("0x", ""),
      });
      
      return depositResponse;
    } catch (error: any) {
      // Preserve blockchain error messages for user feedback
      if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Unknown error occurred during bridge-in operation');
      }
    }
  }

  // COMMENTED OUT - HTTP-based bridgeOut method
  // public async bridgeOut(params: BridgeOutParams): Promise<any> {
  //   try {
  //     const response = await axios.post(
  //       `${BRIDGE_API_BASE_URL}/api/bridge/bridgeOut`,
  //       {
  //         amount: params.amount,
  //         toAddress: params.toAddress,
  //         tokenAddress: params.tokenAddress,
  //       },
  //       {
  //         headers: {
  //           'Content-Type': 'application/json',
  //           Authorization: `Bearer ${params.accessToken}`
  //         }
  //       }
  //     );

  //     return response.data;
  //   } catch (error: any) {
  //     // Extract error message from axios error response
  //     if (error.response?.data?.message) {
  //       throw new Error(error.response.data.message);
  //     } else if (error.message) {
  //       throw new Error(error.message);
  //     } else {
  //       throw new Error('Unknown error occurred');
  //     }
  //   }
  // }

  // COMMENTED OUT - BridgeOut function moved to direct function calls
  // public async bridgeOut(
  //   tokenAddress: string,
  //   fromAddress: string,
  //   amount: string,
  //   toAddress: string,
  //   userAddress: string
  // ): Promise<any> {
  //   // Get data from Ethereum contract instead of API
  //   // const ethereumData = await getEthereumContractData(); // This would be the real call
  //   
  //   // For now, use the parameters directly (same as original)
  //   // In real scenario, these would come from Ethereum contract

  //   const isTestnet = process.env.SHOW_TESTNET === "true";
  //   const tokenContract = isTestnet
  //     ? TESTNET_ERC20_TOKEN_CONTRACTS
  //     : MAINNET_ERC20_TOKEN_CONTRACTS;

  //   const tokenMapping = isTestnet
  //     ? TESTNET_ETH_STRATO_TOKEN_MAPPING
  //     : MAINNET_ETH_STRATO_TOKEN_MAPPING;

  //   const ethTokenAddress: any =
  //     Object.entries(tokenMapping).find(
  //       ([_, value]) => value.toLowerCase() === tokenAddress.toLowerCase()
  //     )?.[0] || null;

  //   const isERC20 = tokenContract.find((token: any) => token === ethTokenAddress);

  //   const generator = await safeTransactionGenerator(
  //     amount,
  //     toAddress,
  //     isERC20 ? "erc20" : "eth",
  //     ethTokenAddress
  //   );
  //   const {
  //     value: { hash },
  //     } = await generator.next();

  //   const bridgeContract = new BridgeContractCall();
  //   await bridgeContract.withdraw({
  //     txHash: hash.toString().replace("0x", ""),
  //     token: tokenAddress.toLowerCase().replace("0x", ""),
  //     from: fromAddress.toLowerCase().replace("0x", ""),
  //     amount: amount.toString(),
  //     to: toAddress.toLowerCase().replace("0x", ""),
  //     mercataUser: userAddress.toLowerCase().replace("0x", ""),
  //   });

  //   const {
  //     value: { success },
  //     } = await generator.next();

  //   const markPendindResponse =
  //     await bridgeContract.markWithdrawalPendingApproval({
  //       txHash: hash.toString().replace("0x", ""),
  //     });

  //   sendEmail(hash.toString());

  //   return markPendindResponse;
  // }

  // EXACT SAME STRUCTURE as original bridge service
  public async confirmBridgeOut(tx: any): Promise<any> {
    const transactionHash = tx.hash;
    const transaction = await checkEthTransaction(transactionHash);
    if (!transaction) {
      return null;
    }

    const safeTxHash = transaction.safeTxHash.toString().replace("0x", "");

    const bridgeContract = new BridgeContractCall();
    await bridgeContract.confirmWithdrawal({
      txHash: safeTxHash,
    });
  }

  // EXACT SAME STRUCTURE as original bridge service
  public async confirmBridgeOutSafePolling(txs: string[]): Promise<any> {
    if (!txs || txs.length === 0) {
      return;
    }
    
    const bridgeContract = new BridgeContractCall();
    await bridgeContract.batchConfirmWithdrawals({
      txHashes: txs,
    });
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
