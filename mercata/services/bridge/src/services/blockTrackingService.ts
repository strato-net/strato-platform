import { promises as fs } from 'fs';
import path from 'path';
import { logInfo, logError } from '../utils/logger';
import { config } from '../config';
import { execute } from '../utils/stratoHelper';

const BLOCK_TRACKING_FILE = 'lastProcessedBlocks.json';
const BLOCK_TRACKING_PATH = path.join(process.cwd(), BLOCK_TRACKING_FILE);

interface BlockTrackingData {
  [chainId: string]: number;
}

class BlockTrackingService {
  private cachedData: BlockTrackingData | null = null;

  /**
   * Load block tracking data from file
   */
  private async loadBlockData(): Promise<BlockTrackingData> {
    if (this.cachedData !== null) {
      return this.cachedData;
    }

    try {
      const fileContent = await fs.readFile(BLOCK_TRACKING_PATH, 'utf-8');
      this.cachedData = JSON.parse(fileContent);
      return this.cachedData!;
    } catch (error) {
      // File doesn't exist or is invalid, return empty object
      this.cachedData = {};
      return this.cachedData;
    }
  }

  /**
   * Save block tracking data to file
   */
  private async saveBlockData(data: BlockTrackingData): Promise<void> {
    try {
      await fs.writeFile(BLOCK_TRACKING_PATH, JSON.stringify(data, null, 2));
      this.cachedData = data;
      logInfo('BlockTrackingService', `Saved block tracking data to ${BLOCK_TRACKING_FILE}`);
    } catch (error) {
      logError('BlockTrackingService', error as Error, {
        operation: 'saveBlockData',
        filePath: BLOCK_TRACKING_PATH,
      });
      throw error;
    }
  }

  /**
   * Get the last processed block for a chain (locally stored)
   */
  async getLastProcessedBlock(chainId: number): Promise<number> {
    const data = await this.loadBlockData();
    return data[chainId.toString()] || 0;
  }

  /**
   * Update the last processed block locally
   */
  async updateLastProcessedBlockLocally(chainId: number, blockNumber: number): Promise<void> {
    const data = await this.loadBlockData();
    data[chainId.toString()] = blockNumber;
    await this.saveBlockData(data);
    
    logInfo('BlockTrackingService', `Updated local lastProcessedBlock for chain ${chainId}: ${blockNumber}`);
  }

  /**
   * Get the difference between blockchain and local block numbers
   * Returns the local block number if it's higher than blockchain, otherwise blockchain value
   */
  async getEffectiveLastProcessedBlock(chainId: number, blockchainLastBlock: number): Promise<number> {
    const localLastBlock = await this.getLastProcessedBlock(chainId);
    return Math.max(localLastBlock, blockchainLastBlock);
  }

  /**
   * Update the last processed block on the blockchain
   */
  async updateLastProcessedBlockOnBlockchain(chainId: number, blockNumber: number): Promise<void> {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "setLastProcessedBlock",
      args: {
        externalChainId: chainId,
        lastProcessedBlock: blockNumber,
      },
    });
    
    logInfo(
      "BlockTrackingService",
      `Updated lastProcessedBlock on blockchain for chain ${chainId}: ${blockNumber}`,
    );
  }

  /**
   * Update last processed block both locally and on blockchain
   * Use this when deposits have been processed and blockchain state should be updated
   */
  async updateLastProcessedBlockEverywhere(chainId: number, blockNumber: number): Promise<void> {
    await Promise.all([
      this.updateLastProcessedBlockLocally(chainId, blockNumber),
      this.updateLastProcessedBlockOnBlockchain(chainId, blockNumber)
    ]);
  }
}

export const blockTrackingService = new BlockTrackingService();
