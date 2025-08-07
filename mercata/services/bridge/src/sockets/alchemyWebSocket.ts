import { Alchemy, Network, AlchemySubscription } from 'alchemy-sdk';
import { config, MAINNET_ERC20_TOKEN_CONTRACTS } from '../config';
import logger from '../utils/logger';
import { confirmBridgeIn, confirmBridgeOut } from '../services/bridgeService';
import { TESTNET_ERC20_TOKEN_CONTRACTS } from '../config';
import { ethers } from 'ethers';

const showTestnet = process.env.SHOW_TESTNET === 'true';

const erc20TokenContracts = showTestnet ? TESTNET_ERC20_TOKEN_CONTRACTS : MAINNET_ERC20_TOKEN_CONTRACTS;

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
            console.log('txxxxx  found', tx);
            // Only process if the transaction is going TO the safe address
            if (tx.transaction.input === '0x') {
              console.log("calling confirmBridgeIn")
              await confirmBridgeIn(tx.transaction);
            }
            else {
              console.log("calling confirmBridgeOut ....")
              await confirmBridgeOut(tx.transaction);
            }
          } catch (error: any) {
            logger.error('Error processing transaction:', error);
          }
        }
      );

      for (const contractAddress of erc20TokenContracts) {
        const filter = {
          address: contractAddress,
          topics: [
            ethers.id('Transfer(address,address,uint256)'),
            null,
            '0x' + config.safe.address.toLowerCase().slice(2).padStart(64, '0'),
          ],
        };

        this.alchemy.ws.on(filter, async (log) => {
          try {
            console.log('ERC-20 Transfer log:', log);
            await confirmBridgeIn({ hash: log.transactionHash }); // or use a separate handler if needed
          } catch (error) {
            logger.error('Error processing ERC-20 transfer:', error);
          }
        });
      }

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
