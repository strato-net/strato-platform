import { promises as fs } from 'fs';
import path from 'path';
import { logInfo, logError } from '../utils/logger';
import { BLOCK_TRACKING_FILE } from '../config';
import { EventCursor } from '../types';

const BLOCK_TRACKING_PATH = path.join(process.cwd(), BLOCK_TRACKING_FILE);
const DIR = path.dirname(BLOCK_TRACKING_PATH);

const MAX_REASONABLE_BLOCK = 1_000_000_000;
const DEFAULT_CURSOR: EventCursor = { blockNumber: 0, eventIndex: 0 };

function isCursor(x: any): x is EventCursor {
  return (
    x &&
    typeof x.blockNumber === 'number' &&
    typeof x.eventIndex === 'number' &&
    Number.isSafeInteger(x.blockNumber) &&
    Number.isSafeInteger(x.eventIndex) &&
    x.blockNumber >= 0 &&
    x.eventIndex >= 0
  );
}

function validateCursor(cursor: EventCursor): EventCursor {
  if (cursor.blockNumber > MAX_REASONABLE_BLOCK) {
    logError(
      'BlockTrackingService',
      new Error(`Suspiciously high block number: ${cursor.blockNumber}`),
      { operation: 'validateCursor' }
    );
  }
  return cursor;
}

class BlockTrackingService {
  private cachedCursor: EventCursor | null = null;
  private warnedBadFile = false;

  async getCursor(): Promise<EventCursor> {
    if (this.cachedCursor) return this.cachedCursor;

    try {
      const raw = await fs.readFile(BLOCK_TRACKING_PATH, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!isCursor(parsed)) {
        if (!this.warnedBadFile) {
          this.warnedBadFile = true;
          logError(
            'BlockTrackingService',
            new Error(`Invalid cursor file format at ${BLOCK_TRACKING_PATH}`),
            { operation: 'getCursor', fileLength: raw.length }
          );
        }
        this.cachedCursor = DEFAULT_CURSOR;
        return DEFAULT_CURSOR;
      }

      const cursor = validateCursor(parsed);
      this.cachedCursor = cursor;
      this.warnedBadFile = false;
      return cursor;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        if (!this.warnedBadFile) {
          this.warnedBadFile = true;
          logError('BlockTrackingService', error as Error, {
            operation: 'getCursor',
            filePath: BLOCK_TRACKING_PATH,
          });
        }
      }

      this.cachedCursor = DEFAULT_CURSOR;
      return DEFAULT_CURSOR;
    }
  }

  async updateCursor(next: EventCursor): Promise<void> {
    if (!isCursor(next)) throw new Error(`Invalid cursor: ${JSON.stringify(next)}`);

    const cur = this.cachedCursor ?? await this.getCursor();

    if (cur.blockNumber === next.blockNumber && cur.eventIndex === next.eventIndex) {
      return;
    }

    const regressed =
      next.blockNumber < cur.blockNumber ||
      (next.blockNumber === cur.blockNumber && next.eventIndex < cur.eventIndex);
    if (regressed) {
      logError(
        'BlockTrackingService',
        new Error(`Refusing to write regressed cursor`),
        { operation: 'updateCursor', current: cur, next }
      );
      return;
    }

    await fs.mkdir(DIR, { recursive: true });

    const tmpPath = `${BLOCK_TRACKING_PATH}.tmp.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
      await fs.rename(tmpPath, BLOCK_TRACKING_PATH);
      this.cachedCursor = next;

      logInfo(
        'BlockTrackingService',
        `Saved cursor: blockNumber=${next.blockNumber}, eventIndex=${next.eventIndex}`
      );
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => {});
      logError('BlockTrackingService', error as Error, {
        operation: 'updateCursor',
        filePath: BLOCK_TRACKING_PATH,
        cursor: next,
      });
      throw error;
    }
  }
}

export const blockTrackingService = new BlockTrackingService();
