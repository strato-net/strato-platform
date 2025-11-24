import { promises as fs } from 'fs';
import path from 'path';
import { logInfo, logError } from '../utils/logger';

const BLOCK_TRACKING_FILE = 'lastProcessedEvents.json';
const BLOCK_TRACKING_PATH = path.join(process.cwd(), BLOCK_TRACKING_FILE);

interface BlockTrackingData {
  [eventKey: string]: number;
}

class BlockTrackingService {
  private cachedData: BlockTrackingData | null = null;

  private async loadBlockData(): Promise<BlockTrackingData> {
    if (this.cachedData !== null) {
      return this.cachedData;
    }

    try {
      const fileContent = await fs.readFile(BLOCK_TRACKING_PATH, 'utf-8');
      this.cachedData = JSON.parse(fileContent);
      return this.cachedData!;
    } catch (error) {
      this.cachedData = {};
      return this.cachedData;
    }
  }

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

  async getLastProcessedBlock(eventKey: string): Promise<number> {
    const data = await this.loadBlockData();
    return data[eventKey] || 0;
  }

  async updateLastProcessedBlock(eventKey: string, blockNumber: number): Promise<void> {
    const data = await this.loadBlockData();
    data[eventKey] = blockNumber;
    await this.saveBlockData(data);
    
    logInfo('BlockTrackingService', `Updated lastProcessedBlock for ${eventKey}: ${blockNumber}`);
  }

  async updateLastProcessedBlocks(updates: Map<string, number>): Promise<void> {
    const data = await this.loadBlockData();
    for (const [eventKey, blockNumber] of updates.entries()) {
      data[eventKey] = blockNumber;
    }
    await this.saveBlockData(data);
    
    logInfo('BlockTrackingService', `Updated ${updates.size} lastProcessedBlocks`);
  }
}

export const blockTrackingService = new BlockTrackingService();

