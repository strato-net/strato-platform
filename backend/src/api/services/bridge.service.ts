
import axios from 'axios';

interface BridgeParams {
  amount: string;
  fromAddress: string;
  toAddress: string;
  userToken: string;
  tokenAddress: string;
  ethHash: string;
}

export class BridgeService {
  public async ethToStrato(params: BridgeParams): Promise<any> {
    try {
     console.log("params",params);
      // Make API call to bridge service
      const response = await axios.post(
        'http://localhost:3002/api/bridge/transaction',
        {
          fromAddress: params.fromAddress,
          toAddress: params.toAddress,
          amount: params.amount,
          tokenAddress: params.tokenAddress,
          userToken: params.userToken,
          ethHash: params.ethHash
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

     console.log('Bridge service API response:', response.data);

      // Return the response from bridge service
      return {
        transactionId: params.ethHash,
        status: 'pending',
        timestamp: new Date().toISOString(),
        details: {
          amount: params.amount,
          fromAddress: params.fromAddress,
          toAddress: params.toAddress,
          tokenAddress: params.tokenAddress,
          ethHash: params.ethHash
        },
        bridgeServiceResponse: response.data
      };

    } catch (error: any) {
     console.log("error",error);
      throw error;
    }
  }
} 