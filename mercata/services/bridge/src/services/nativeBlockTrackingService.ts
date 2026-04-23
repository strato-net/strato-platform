import { promises as fs, mkdirSync } from "fs";
import path from "path";
import { logInfo, logError } from "../utils/logger";

const BLOCK_TRACKING_FILE = "nativeLastProcessedBlocks.json";
const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });
const BLOCK_TRACKING_PATH = path.join(DATA_DIR, BLOCK_TRACKING_FILE);

interface BlockTrackingData {
  [chainId: string]: number;
}

class NativeBlockTrackingService {
  private cachedData: BlockTrackingData | null = null;

  private async loadBlockData(): Promise<BlockTrackingData> {
    if (this.cachedData !== null) {
      return this.cachedData;
    }

    try {
      const fileContent = await fs.readFile(BLOCK_TRACKING_PATH, "utf-8");
      this.cachedData = JSON.parse(fileContent);
      return this.cachedData!;
    } catch {
      this.cachedData = {};
      return this.cachedData;
    }
  }

  private async saveBlockData(data: BlockTrackingData): Promise<void> {
    try {
      await fs.writeFile(BLOCK_TRACKING_PATH, JSON.stringify(data, null, 2));
      this.cachedData = data;
      logInfo("NativeBlockTrackingService", `Saved block tracking data to ${BLOCK_TRACKING_FILE}`);
    } catch (error) {
      logError("NativeBlockTrackingService", error as Error, {
        operation: "saveBlockData",
        filePath: BLOCK_TRACKING_PATH,
      });
      throw error;
    }
  }

  async getLastProcessedBlock(chainId: number): Promise<number> {
    const data = await this.loadBlockData();
    return data[chainId.toString()] || 0;
  }

  async updateLastProcessedBlockLocally(chainId: number, blockNumber: number): Promise<void> {
    const data = await this.loadBlockData();
    data[chainId.toString()] = blockNumber;
    await this.saveBlockData(data);

    logInfo("NativeBlockTrackingService", `Updated local lastProcessedBlock for chain ${chainId}: ${blockNumber}`);
  }

  async getEffectiveLastProcessedBlock(chainId: number, blockchainLastBlock: number): Promise<number> {
    const localLastBlock = await this.getLastProcessedBlock(chainId);
    return Math.max(localLastBlock, blockchainLastBlock);
  }
}

export const nativeBlockTrackingService = new NativeBlockTrackingService();
