import { promises as fs } from 'fs';
import path from 'path';
import { logInfo, logError } from '../observability/logger';
import { BLOCK_TRACKING_FILE, config } from '../config/runtimeConfig';
import { EventCursor } from '../../shared/types';
import { cirrus } from '../http/api';
import { writeJsonFileAtomic } from './atomicJson.store';

const BLOCK_TRACKING_PATH = path.join(process.cwd(), BLOCK_TRACKING_FILE);

const MAX_REASONABLE_BLOCK = 1_000_000_000;

function isCursor(x: any): x is EventCursor {
  return (
    x &&
    typeof x.blockNumber === 'number' &&
    typeof x.eventIndex === 'number' &&
    typeof x.block_timestamp === 'string' &&
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

async function getLatestCursorFromEvents(): Promise<EventCursor> {
  const data = await cirrus.get('/event', {
    params: {
      address: `eq.${config.rewards.address}`,
      event_name: 'eq.ActionProcessed',
      order: 'id.desc',
      limit: 1,
      select: 'block_number,event_index,block_timestamp',
    },
  });

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      `No ActionProcessed events found for Rewards contract ${config.rewards.address}`
    );
  }

  const latestEvent = data[0];
  const blockNumber = Number(latestEvent.block_number);
  const eventIndex = Number(latestEvent.event_index);
  const block_timestamp = latestEvent.block_timestamp;

  if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(eventIndex)) {
    throw new Error(
      `Invalid event data: blockNumber=${latestEvent.block_number}, eventIndex=${latestEvent.event_index}`
    );
  }

  if (typeof block_timestamp !== 'string') {
    throw new Error(
      `Invalid event data: block_timestamp=${block_timestamp}`
    );
  }

  return { blockNumber, eventIndex, block_timestamp };
}

class BlockTrackingService {
  private cachedCursor: EventCursor | null = null;
  private warnedBadFile = false;

  private async writeCursorToFile(cursor: EventCursor): Promise<void> {
    try {
      await writeJsonFileAtomic(BLOCK_TRACKING_PATH, cursor);
      this.cachedCursor = cursor;

      logInfo(
        'BlockTrackingService',
        `Saved cursor: blockNumber=${cursor.blockNumber}, eventIndex=${cursor.eventIndex}, block_timestamp=${cursor.block_timestamp}`
      );
    } catch (error) {
      logError('BlockTrackingService', error as Error, {
        operation: 'writeCursorToFile',
        filePath: BLOCK_TRACKING_PATH,
        cursor,
      });
      throw error;
    }
  }

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
        const cursor = await getLatestCursorFromEvents();
        await this.writeCursorToFile(cursor);
        return cursor;
      }

      const cursor = validateCursor(parsed);
      this.cachedCursor = cursor;
      this.warnedBadFile = false;
      return cursor;
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && !this.warnedBadFile) {
        this.warnedBadFile = true;
        logError('BlockTrackingService', error as Error, {
          operation: 'getCursor',
          filePath: BLOCK_TRACKING_PATH,
        });
      }

      const cursor = await getLatestCursorFromEvents();
      await this.writeCursorToFile(cursor);
      return cursor;
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

    await this.writeCursorToFile(next);
  }
}

export const blockTrackingService = new BlockTrackingService();
