import { logInfo } from '../utils/logger';
import { config } from '../config';
import { execute } from '../utils/stratoHelper';
import { JsonFileStore, dataFilePath } from '../utils/jsonFileStore';

const BLOCK_TRACKING_FILE = 'lastProcessedBlocks.json';

interface BlockTrackingData {
  [chainId: string]: number;
}

class BlockTrackingService {
  // An unreadable file falls back to the on-chain checkpoint, and re-scanning is safe
  private store = new JsonFileStore<BlockTrackingData>(
    dataFilePath(BLOCK_TRACKING_FILE),
    () => ({}),
    "empty",
  );

  /**
   * Get the last processed block for a chain (locally stored)
   */
  async getLastProcessedBlock(chainId: number): Promise<number> {
    const data = await this.store.read();
    return data[chainId.toString()] || 0;
  }

  /**
   * Update the last processed block locally
   */
  async updateLastProcessedBlockLocally(chainId: number, blockNumber: number): Promise<void> {
    await this.store.update((data) => {
      data[chainId.toString()] = blockNumber;
    });

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
}

export const blockTrackingService = new BlockTrackingService();
