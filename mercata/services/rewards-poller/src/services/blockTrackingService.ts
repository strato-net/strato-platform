import { promises as fs } from 'fs';
import path from 'path';
import { logInfo, logError } from '../utils/logger';
import { BLOCK_TRACKING_FILE } from '../config';

const BLOCK_TRACKING_PATH = path.join(process.cwd(), BLOCK_TRACKING_FILE);
const BLOCK_TRACKING_TMP_PATH = path.join(process.cwd(), `${BLOCK_TRACKING_FILE}.tmp`);

const MAX_REASONABLE_BLOCK = 1_000_000_000;

interface BlockTrackingData {
  lastProcessedBlock: number;
}

class BlockTrackingService {
  private cachedBlock: number | null = null;

  private async loadBlockData(): Promise<number> {
    if (this.cachedBlock !== null) {
      return this.cachedBlock;
    }

    try {
      const fileContent = await fs.readFile(BLOCK_TRACKING_PATH, 'utf-8');
      const data = JSON.parse(fileContent) as BlockTrackingData;
      
      if (typeof data.lastProcessedBlock !== 'number') {
        throw new Error('Invalid block number format in file');
      }

      if (data.lastProcessedBlock < 0) {
        logError('BlockTrackingService', new Error(`Invalid negative block number: ${data.lastProcessedBlock}`), {
          operation: 'loadBlockData',
        });
        this.cachedBlock = 0;
        return 0;
      }

      if (data.lastProcessedBlock > MAX_REASONABLE_BLOCK) {
        logError('BlockTrackingService', new Error(`Suspiciously high block number: ${data.lastProcessedBlock}`), {
          operation: 'loadBlockData',
        });
      }

      this.cachedBlock = data.lastProcessedBlock;
      return this.cachedBlock;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.cachedBlock = 0;
        return 0;
      }

      logError('BlockTrackingService', error as Error, {
        operation: 'loadBlockData',
        filePath: BLOCK_TRACKING_PATH,
      });
      
      this.cachedBlock = 0;
      return 0;
    }
  }

  private async saveBlockData(blockNumber: number): Promise<void> {
    if (blockNumber < 0) {
      throw new Error(`Cannot save negative block number: ${blockNumber}`);
    }

    if (blockNumber > MAX_REASONABLE_BLOCK) {
      logError('BlockTrackingService', new Error(`Suspiciously high block number: ${blockNumber}`), {
        operation: 'saveBlockData',
      });
    }

    try {
      const data: BlockTrackingData = { lastProcessedBlock: blockNumber };
      const jsonContent = JSON.stringify(data, null, 2);

      await fs.writeFile(BLOCK_TRACKING_TMP_PATH, jsonContent, 'utf-8');

      try {
        JSON.parse(jsonContent);
      } catch (parseError) {
        await fs.unlink(BLOCK_TRACKING_TMP_PATH).catch(() => {});
        throw new Error('Generated invalid JSON');
      }

      await fs.rename(BLOCK_TRACKING_TMP_PATH, BLOCK_TRACKING_PATH);
      this.cachedBlock = blockNumber;
      logInfo('BlockTrackingService', `Saved last processed block: ${blockNumber}`);
    } catch (error) {
      try {
        await fs.unlink(BLOCK_TRACKING_TMP_PATH).catch(() => {});
      } catch {
      }

      logError('BlockTrackingService', error as Error, {
        operation: 'saveBlockData',
        filePath: BLOCK_TRACKING_PATH,
        blockNumber,
      });
      throw error;
    }
  }

  async getLastProcessedBlock(): Promise<number> {
    return await this.loadBlockData();
  }

  async updateLastProcessedBlock(blockNumber: number): Promise<void> {
    await this.saveBlockData(blockNumber);
  }
}

export const blockTrackingService = new BlockTrackingService();

