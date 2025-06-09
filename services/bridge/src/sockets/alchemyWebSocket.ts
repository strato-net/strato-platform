import { Alchemy, Network, AlchemySubscription } from 'alchemy-sdk';
import { config } from '../config';
import logger from '../utils/logger';
import { confirmBridgeIn, confirmBridgeOut } from '../services/bridgeService';

export class AlchemyWebSocket {
  private alchemy: Alchemy;
  private isConnected: boolean = false;

  constructor() {
    const settings = {
      apiKey: config.alchemy.apiKey,
      network: Network[config.alchemy.network as keyof typeof Network],
    };
    this.alchemy = new Alchemy(settings);
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
          try {
            // Only process if the transaction is going TO the safe address
            if (tx.transaction.input === '0x') {
              await confirmBridgeIn(tx.transaction);
            }
            else {
              await confirmBridgeOut(tx.transaction);
            }
          } catch (error: any) {
            logger.error('Error processing transaction:', error);
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
