import { Alchemy, Network, AlchemySubscription } from 'alchemy-sdk';
import { config } from '../config';
import logger from '../utils/logger';
import { handleBridgeIn } from '../events/bridgeIn';
import { handleBridgeOut } from '../events/bridgeOut';
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { GetMultisigTransactionsOptions, ListOptions } from '@safe-global/api-kit';

type DataDecoded = {
    method: string;
    parameters: Array<{
        name: string;
        value: string;
        type: string;
    }>;
};

export type SafeModuleTransaction = {
    readonly created?: string;
    readonly executionDate: string;
    readonly blockNumber?: number;
    readonly isSuccessful?: boolean;
    readonly transactionHash?: string;
    readonly safe: string;
    readonly module: string;
    readonly to: string;
    readonly value: string;
    readonly data: string | null;
    readonly operation: number;
    readonly dataDecoded?: DataDecoded;
};

export class AlchemyWebSocket {
  private alchemy: Alchemy;
  private isConnected: boolean = false;
  private apiKit: SafeApiKit;

  constructor() {
    if (!config.alchemy.apiKey) {
      throw new Error('Alchemy API key is not configured');
    }

    const settings = {
      apiKey: config.alchemy.apiKey,
      network: Network[config.alchemy.network as keyof typeof Network],
    };
    this.alchemy = new Alchemy(settings);
    this.apiKit = new SafeApiKit({
      chainId: 11155111n,
    });
  }

  public async connect(): Promise<void> {
    try {
      if (!config.safe.address) {
        throw new Error('Safe address is not configured');
      }

      // monitor incoming transactions (ETH to STRATO)
      this.alchemy.ws.on(
        {
          method: AlchemySubscription.MINED_TRANSACTIONS,
          addresses: [{ 
            to: config.safe.address,
            from: undefined
          }],
          includeRemoved: true,
          hashesOnly: false,
        },
        async (tx) => {
          // console.log("tx", tx);
          try {
            // Only process if the transaction is going TO the safe address
            if (tx.transaction.input === '0x') {
              // console.log(" [ALCHEMY] Processing incoming transaction to safe address");
              await handleBridgeIn(tx.transaction);
            }
             else {
              // console.log(" [ALCHEMY] Skipping transaction - not going to safe address");
              const transactionHash = tx.transaction.hash;
              // console.log("transactionHash", transactionHash);
              
              // Add 5 second delay
              await new Promise(resolve => setTimeout(resolve, 5000));
              
              const options = {
                limit: 400
              } as any;
              const allTxs: any = await this.apiKit.getAllTransactions(config.safe.address || "", options);
              const transaction = allTxs.results.find((safeTx: any) => transactionHash === safeTx.transactionHash);
              console.log("Found Transaction:", transaction);
              if (!transaction) {
                console.log("No matching transaction found in Safe transactions");
              }
            }
          } catch (error: any) {
            logger.error('Error processing transaction:', error?.message);
          }
        }
      );

      this.isConnected = true;
    } catch (error: any) {
      throw error;
    }
  }

  public disconnect(): void {
    try {
      if (this.isConnected) {
        this.alchemy.ws.removeAllListeners();
        this.isConnected = false;
        logger.info('Alchemy WebSocket disconnected');
      }
    } catch (error: any) {
      logger.error('Error disconnecting Alchemy WebSocket:', error?.message);
    }
  }
} 