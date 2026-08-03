import { config } from "./config";
import { fetchWithRetry } from "./fetchWithRetry";
import { logInfo, logError } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;

// `/transaction/last/{n}` is capped server-side at 1000 rows. At current
// volume 1000 txs span ~35h, so a single call covers the 24h window. If daily
// volume ever grows past that, we page backward by block-number range (which
// is not capped the same way) until we cross the 24h boundary — so no code
// change is needed as the chain grows.
const LAST_TX_CAP = 1000;
const BLOCK_CHUNK = 500;
const MAX_PAGES = 200; // safety bound: 200 * 500 = 100k blocks scanned max

interface EthTx {
  from?: string;
  timestamp?: string;
  blockNumber?: number;
}

export interface DailyActivity {
  /** Number of transactions in the trailing 24h. */
  transactions: number;
  /** Distinct `from` addresses across those transactions. */
  uniqueWallets: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Compute trailing-24h transaction count and unique active wallets straight
 * from the STRATO node REST API. Transactions are newest-first from
 * `/transaction/last/{n}`; `/transaction?minblocknumber&maxblocknumber` is used
 * to page further back when a single capped call doesn't reach 24h.
 */
export async function fetchDailyActivity(
  nowMs: number = Date.now()
): Promise<DailyActivity> {
  const base = config.strato.ethApiBaseUrl;
  const cutoff = nowMs - DAY_MS;

  const senders = new Set<string>();
  let transactions = 0;
  let crossedBoundary = false;
  let minBlockSeen = Number.POSITIVE_INFINITY;

  const consume = (txs: EthTx[]): void => {
    for (const tx of txs) {
      if (typeof tx.blockNumber === "number") {
        minBlockSeen = Math.min(minBlockSeen, tx.blockNumber);
      }
      const t = tx.timestamp ? Date.parse(tx.timestamp) : NaN;
      if (Number.isNaN(t)) continue;
      if (t >= cutoff) {
        transactions += 1;
        if (tx.from) senders.add(tx.from.toLowerCase());
      } else {
        // A transaction older than the window means we've paged past 24h.
        crossedBoundary = true;
      }
    }
  };

  // Fast path: the most recent (capped) batch usually spans well over 24h.
  const recent = await getJson<EthTx[]>(`${base}/transaction/last/${LAST_TX_CAP}`);
  consume(recent);

  // Slow path: only if 1000 txs didn't reach back a full day.
  let pages = 0;
  let hi = (minBlockSeen === Number.POSITIVE_INFINITY ? 0 : minBlockSeen) - 1;
  while (!crossedBoundary && hi > 0 && pages < MAX_PAGES) {
    pages += 1;
    const lo = Math.max(0, hi - BLOCK_CHUNK + 1);
    const batch = await getJson<EthTx[]>(
      `${base}/transaction?minblocknumber=${lo}&maxblocknumber=${hi}`
    );
    consume(batch);
    if (lo === 0) break;
    hi = lo - 1;
  }

  if (!crossedBoundary && pages >= MAX_PAGES) {
    logError(
      "Daily activity scan hit page limit before reaching 24h boundary; counts may be a lower bound",
      { pages, transactions }
    );
  }

  logInfo("Computed daily chain activity", {
    transactions,
    uniqueWallets: senders.size,
    pagedBlocks: pages > 0,
  });

  return { transactions, uniqueWallets: senders.size };
}
