import axios from "axios";
import { config } from "../config";
import { parseJsonPreservingBigInts } from "../utils/num";
import { logError, logInfo } from "../utils/logger";
import { applySerialized } from "./apply";
import { CirrusEventRow, fromCirrusRow } from "./normalize";
import { getProgress } from "./progress";

const EVENT_NAMES = ["Transfer", "Swap", "PriceUpdated", "BatchPricesUpdated"];
const SELECT = "id,address,block_hash,transaction_hash,block_timestamp,block_number,transaction_sender,event_index,event_name,attributes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Backfill and completeness: pages Cirrus's global event table by id from
 * where it last stopped, continuously. From genesis on first start (the
 * backfill); afterwards it lags the bus by one poll interval and catches
 * anything the bus feed missed. Anonymous reads: no Authorization header,
 * since a bogus bearer is a 403 where anonymous is fine.
 */
export const runCirrusPoller = async (): Promise<void> => {
  const { cirrus } = config;
  const progress = await getProgress("cirrus");
  let cursor = progress ? Number(progress.cursor) : 0;
  logInfo("Cirrus", `Polling ${cirrus.nodeUrl}/cirrus/search/event from id ${cursor}`);
  for (;;) {
    try {
      const { data } = await axios.get<CirrusEventRow[]>(`${cirrus.nodeUrl}/cirrus/search/event`, {
        params: {
          select: SELECT,
          id: `gt.${cursor}`,
          order: "id.asc",
          limit: cirrus.pageSize,
          event_name: `in.(${EVENT_NAMES.join(",")})`,
        },
        transformResponse: [(text: string) => (typeof text === "string" ? parseJsonPreservingBigInts(text) : text)],
        timeout: 60000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        await sleep(cirrus.intervalMs);
        continue;
      }
      const events = rows.map(fromCirrusRow).filter((e): e is NonNullable<typeof e> => e !== null);
      const lastId = Math.max(...rows.map((r) => Number(r.id)));
      const lastBlock = Math.max(0, ...events.map((e) => e.blockNumber));
      const stats = await applySerialized(events, { name: "cirrus", blockNumber: lastBlock, cursor: lastId });
      cursor = lastId;
      logInfo("Cirrus", `applied ${events.length} of ${rows.length} rows through id ${lastId}, block ${lastBlock}`, stats);
      if (rows.length < cirrus.pageSize) await sleep(cirrus.intervalMs);
    } catch (error) {
      logError("Cirrus", error, { cursor, retryInMs: cirrus.intervalMs });
      await sleep(cirrus.intervalMs);
    }
  }
};
