import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import axios, { AxiosInstance } from "axios";
import { CirrusClient, CirrusEventRow, CirrusQueryParams, WasConfig } from "./types";
import { logInfo } from "./logger";

interface SnapshotManifestFile {
  file: string;
  rowCount: number;
  block?: string | number;
  firstBlock?: string | number;
  lastBlock?: string | number;
  page?: number;
  offset?: number;
  bytes?: number;
}

interface SnapshotManifest {
  totalRows: number;
  files: SnapshotManifestFile[];
  highestBlock?: string | number;
  totalBytes?: number;
  totalSizeMiB?: number;
  averageBytesPerRow?: number;
}

const EVENT_TABLE = "/event";
const STANDARD_WITHDRAWALS_TABLE = "/BlockApps-MercataBridge-withdrawals";
const NATIVE_WITHDRAWALS_TABLE = "/BlockApps-StratoNativeBridge-withdrawals";
const EVENT_SELECT =
  "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender";
const REFRESH_PAGE_SIZE = 5000;
const REFRESH_FETCH_CONCURRENCY = parsePositiveInteger(
  process.env.WAS_EVENT_SNAPSHOT_FETCH_CONCURRENCY,
  4,
);
const BLOCK_RANGE_SPANS = [10000n, 1000n, 100n, 10n];

const normalizeAddress = (address?: string): string =>
  address ? address.toLowerCase().replace(/^0x/, "") : "";

const normalizeValue = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const parseEq = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return value.startsWith("eq.") ? value.slice(3) : undefined;
};

const parseLt = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !value.startsWith("lt.")) return undefined;
  try {
    return BigInt(value.slice(3));
  } catch {
    return undefined;
  }
};

const parseGt = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !value.startsWith("gt.")) return undefined;
  try {
    return BigInt(value.slice(3));
  } catch {
    return undefined;
  }
};

const parseEventNames = (value: unknown): Set<string> | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("eq.")) return new Set([value.slice(3)]);
  if (value.startsWith("in.(") && value.endsWith(")")) {
    return new Set(value.slice(4, -1).split(",").filter(Boolean));
  }
  return undefined;
};

const eventBlock = (event: CirrusEventRow): bigint | undefined => {
  return toBlock(event.block_number);
};

const toBlock = (value: unknown): bigint | undefined => {
  try {
    return BigInt(normalizeValue(value));
  } catch {
    return undefined;
  }
};

const transactionKey = (event: CirrusEventRow): string =>
  `${normalizeValue(event.block_number)}:${normalizeValue(event.transaction_hash)}`;

const transferKey = (event: CirrusEventRow): string =>
  `${normalizeAddress(event.address)}:${normalizeAddress(normalizeValue(event.attributes?.to))}`;

const sortEvents = (
  events: CirrusEventRow[],
  order: string | number | boolean | undefined,
): CirrusEventRow[] => {
  if (order !== "block_number.desc" && order !== "block_number.asc") return events;
  const direction = order === "block_number.desc" ? -1 : 1;
  return [...events].sort((a, b) => {
    const aBlock = eventBlock(a) ?? 0n;
    const bBlock = eventBlock(b) ?? 0n;
    if (aBlock === bBlock) return 0;
    return aBlock > bBlock ? direction : -direction;
  });
};

const applyPagination = (
  events: CirrusEventRow[],
  params: CirrusQueryParams = {},
): CirrusEventRow[] => {
  const offset = Number(params.offset || 0);
  const limit = Number(params.limit || events.length);
  return events.slice(offset, offset + limit);
};

class LocalEventStore {
  private events: CirrusEventRow[] = [];
  private eventsByTransaction = new Map<string, CirrusEventRow[]>();
  private transfersByTokenTo = new Map<string, CirrusEventRow[]>();
  private latestBlock: bigint | undefined;
  private manifest: SnapshotManifest | undefined;
  private refreshPromise: Promise<void> | undefined;

  constructor(
    private snapshotDir: string,
    private readonly config: WasConfig,
  ) {
    this.load();
  }

  private addEvent(event: CirrusEventRow) {
    this.events.push(event);
    const block = eventBlock(event);
    if (block !== undefined && (this.latestBlock === undefined || block > this.latestBlock)) {
      this.latestBlock = block;
    }

    const txKey = transactionKey(event);
    const txEvents = this.eventsByTransaction.get(txKey) || [];
    txEvents.push(event);
    this.eventsByTransaction.set(txKey, txEvents);

    if (event.event_name === "Transfer") {
      const key = transferKey(event);
      const transfers = this.transfersByTokenTo.get(key) || [];
      transfers.push(event);
      this.transfersByTokenTo.set(key, transfers);
    }
  }

  private load() {
    const manifestPath = join(this.snapshotDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`Event snapshot manifest not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
    const highestBlock = manifestHighestBlock(manifest) || 0n;
    if (!isPlausibleManifest(manifest, highestBlock)) {
      throw new Error(
        `Event snapshot manifest looks duplicated: ${manifestPath} has ${manifest.files.length} files for highest block ${highestBlock.toString()}`,
      );
    }
    this.manifest = manifest;
    const manifestBlock = toBlock(manifest.highestBlock);
    if (manifestBlock !== undefined) {
      this.latestBlock = manifestBlock;
    }
    for (const file of manifest.files) {
      const filePath = join(this.snapshotDir, file.file);
      const contents = readFileSync(filePath, "utf8");
      for (const line of contents.split("\n")) {
        if (!line.trim()) continue;
        this.addEvent(JSON.parse(line));
      }
    }

    for (const [key, transfers] of this.transfersByTokenTo.entries()) {
      this.transfersByTokenTo.set(
        key,
        sortEvents(transfers, "block_number.desc"),
      );
    }

    logInfo("LocalEventStore", "Loaded local event snapshot", {
      snapshotDir: this.snapshotDir,
      manifestRows: manifest.totalRows,
      loadedRows: this.events.length,
      files: manifest.files.length,
      transactionCount: this.eventsByTransaction.size,
      transferIndexKeys: this.transfersByTokenTo.size,
    });
  }

  getRows(params: CirrusQueryParams = {}): CirrusEventRow[] {
    let candidates = this.selectCandidateSet(params);
    candidates = candidates.filter((event) => this.matches(event, params));
    candidates = sortEvents(candidates, params.order);
    return applyPagination(candidates, params);
  }

  async refresh(baseClient: CirrusClient): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshNow(baseClient).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async refreshNow(baseClient: CirrusClient): Promise<void> {
    const startingBlock = this.latestBlock;
    let addedRows = 0;
    let totalBytes = 0;
    const files: SnapshotManifestFile[] = [];
    let currentBlock: string | undefined;
    let currentRows: CirrusEventRow[] = [];

    const flushCurrentBlock = () => {
      if (!currentBlock || !currentRows.length) return;

      const contents = currentRows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      const bytes = Buffer.byteLength(contents, "utf8");
      const rangeDir = blockRangeDir(currentBlock);
      const file = `${rangeDir}/block-${safeFilePart(currentBlock)}.jsonl`;
      mkdirSync(join(this.snapshotDir, rangeDir), { recursive: true });
      writeFileSync(join(this.snapshotDir, file), contents);

      files.push({
        block: currentBlock,
        file,
        rowCount: currentRows.length,
        bytes,
      });
      totalBytes += bytes;
      currentRows = [];
    };

    const latestBlock = await latestBlockNumber(this.config);
    if (startingBlock === undefined || startingBlock >= latestBlock) return;

    for (let block = startingBlock + 1n; block <= latestBlock;) {
      const blocks = Array.from(
        { length: REFRESH_FETCH_CONCURRENCY },
        (_, index) => block + BigInt(index),
      ).filter((nextBlock) => nextBlock <= latestBlock);
      const fetchedBlocks = await Promise.all(
        blocks.map((nextBlock) => fetchBlockEvents(baseClient, nextBlock)),
      );

      for (const rows of fetchedBlocks) {
        for (const row of rows) {
          const block = normalizeValue(row.block_number);
          if (currentBlock && block !== currentBlock) {
            flushCurrentBlock();
          }
          currentBlock = block;
          currentRows.push(row);
          this.addEvent(row);
        }
        addedRows += rows.length;
      }

      block += BigInt(blocks.length);
    }

    if (!addedRows) return;

    flushCurrentBlock();
    for (const [key, transfers] of this.transfersByTokenTo.entries()) {
      this.transfersByTokenTo.set(
        key,
        sortEvents(transfers, "block_number.desc"),
      );
    }

    this.updateManifest(files, totalBytes);
    logInfo("LocalEventStore", "Appended local event snapshot rows", {
      snapshotDir: this.snapshotDir,
      rows: addedRows,
      files: files.length,
      fromBlockExclusive: startingBlock?.toString() || "",
      latestBlock: this.latestBlock?.toString() || "",
    });
  }

  private updateManifest(files: SnapshotManifestFile[], addedBytes: number) {
    const manifest = this.manifest || { totalRows: 0, files: [] };
    manifest.files.push(...files);
    manifest.totalRows = this.events.length;
    manifest.highestBlock = this.latestBlock?.toString();

    if (manifest.totalBytes !== undefined) {
      manifest.totalBytes += addedBytes;
      manifest.totalSizeMiB = Number((manifest.totalBytes / 1024 / 1024).toFixed(2));
      manifest.averageBytesPerRow = manifest.totalRows
        ? Math.round(manifest.totalBytes / manifest.totalRows)
        : 0;
    }

    writeFileSync(
      join(this.snapshotDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    this.manifest = manifest;
    this.renameSnapshotDir();
  }

  private renameSnapshotDir() {
    const latestBlock = this.latestBlock?.toString();
    if (!latestBlock || !/^snapshot-\d+$/.test(basename(this.snapshotDir))) return;

    const nextDir = join(dirname(this.snapshotDir), `snapshot-${latestBlock}`);
    if (nextDir === this.snapshotDir || existsSync(nextDir)) return;

    renameSync(this.snapshotDir, nextDir);
    this.snapshotDir = nextDir;
    logInfo("LocalEventStore", "Renamed local event snapshot directory", {
      snapshotDir: this.snapshotDir,
      latestBlock,
    });
  }

  private selectCandidateSet(params: CirrusQueryParams): CirrusEventRow[] {
    const blockEq = parseEq(params.block_number);
    const txEq = parseEq(params.transaction_hash);
    if (blockEq && txEq) {
      return this.eventsByTransaction.get(`${blockEq}:${txEq}`) || [];
    }

    const eventNames = parseEventNames(params.event_name);
    const addressEq = parseEq(params.address);
    const toEq = parseEq(params["attributes->>to"]);
    if (eventNames?.has("Transfer") && addressEq && toEq) {
      return this.transfersByTokenTo.get(`${normalizeAddress(addressEq)}:${normalizeAddress(toEq)}`) || [];
    }

    return this.events;
  }

  private matches(event: CirrusEventRow, params: CirrusQueryParams): boolean {
    const addressEq = parseEq(params.address);
    if (addressEq && normalizeAddress(event.address) !== normalizeAddress(addressEq)) {
      return false;
    }

    const eventNames = parseEventNames(params.event_name);
    if (eventNames && !eventNames.has(event.event_name)) {
      return false;
    }

    const txEq = parseEq(params.transaction_hash);
    if (txEq && normalizeValue(event.transaction_hash) !== txEq) {
      return false;
    }

    const blockEq = parseEq(params.block_number);
    if (blockEq && normalizeValue(event.block_number) !== blockEq) {
      return false;
    }

    const blockLt = parseLt(params.block_number);
    if (blockLt !== undefined) {
      const block = eventBlock(event);
      if (block === undefined || block >= blockLt) return false;
    }

    const blockGt = parseGt(params.block_number);
    if (blockGt !== undefined) {
      const block = eventBlock(event);
      if (block === undefined || block <= blockGt) return false;
    }

    for (const [key, value] of Object.entries(params)) {
      if (!key.startsWith("attributes->>")) continue;
      const attr = key.slice("attributes->>".length);
      const attrEq = parseEq(value);
      if (attrEq && normalizeValue(event.attributes?.[attr]) !== attrEq) {
        return false;
      }
    }

    return true;
  }
}

const safeFilePart = (value: unknown): string =>
  String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

const blockRangeDir = (block: string): string => {
  const blockNumber = toBlock(block) || 0n;
  if (blockNumber <= 0n) return "0-0";

  return BLOCK_RANGE_SPANS.map((span) => {
    const start = ((blockNumber - 1n) / span) * span + 1n;
    const end = start + span - 1n;
    return `${start.toString()}-${end.toString()}`;
  }).join("/");
};

const refreshesSnapshotBeforeRead = (table: string): boolean =>
  table === STANDARD_WITHDRAWALS_TABLE || table === NATIVE_WITHDRAWALS_TABLE;

const manifestHighestBlock = (manifest: SnapshotManifest): bigint | undefined => {
  const highestBlock = toBlock(manifest.highestBlock);
  if (highestBlock !== undefined) return highestBlock;

  return manifest.files.reduce<bigint | undefined>((highest, file) => {
    const block = toBlock(file.block ?? file.lastBlock ?? file.firstBlock);
    if (block === undefined) return highest;
    return highest === undefined || block > highest ? block : highest;
  }, undefined);
};

const findLatestSnapshotDir = (snapshotRoot: string): string | undefined => {
  if (!existsSync(snapshotRoot)) return undefined;

  return readdirSync(snapshotRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^snapshot-\d+$/.test(entry.name))
    .map((entry) => {
      const dir = join(snapshotRoot, entry.name);
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) return undefined;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
      const highestBlock = manifestHighestBlock(manifest) || 0n;
      if (!isPlausibleManifest(manifest, highestBlock)) return undefined;
      return { dir, highestBlock };
    })
    .filter((entry): entry is { dir: string; highestBlock: bigint } => !!entry)
    .sort((a, b) => (a.highestBlock > b.highestBlock ? -1 : 1))[0]?.dir;
};

const isPlausibleManifest = (
  manifest: SnapshotManifest,
  highestBlock: bigint,
): boolean => manifest.files.length <= Number(highestBlock + 1n);

const getTokenEndpoint = async (config: WasConfig): Promise<string | undefined> => {
  const discoveryUrl = config.oauth?.discoveryUrl;
  if (!discoveryUrl) return undefined;

  const response = await axios.get(discoveryUrl);
  return response.data?.token_endpoint;
};

const getAccessToken = async (config: WasConfig): Promise<string | undefined> => {
  const clientId = config.oauth?.clientId;
  const clientSecret = config.oauth?.clientSecret;
  if (!clientId || !clientSecret) return undefined;

  const tokenEndpoint = await getTokenEndpoint(config);
  if (!tokenEndpoint) return undefined;

  const response = await axios.post(
    tokenEndpoint,
    new URLSearchParams({ grant_type: "client_credentials" }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
    },
  );

  return response.data?.access_token;
};

const latestBlockNumber = async (config: WasConfig): Promise<bigint> => {
  if (process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK) {
    return BigInt(process.env.WAS_EVENT_SNAPSHOT_LATEST_BLOCK);
  }

  const accessToken = await getAccessToken(config);
  const client = axios.create({
    baseURL: config.nodeUrl,
    timeout: 60_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  const paths = [
    "/strato-api/eth/v1.2/block/last/1",
    "/eth/v1.2/block/last/1",
  ];

  for (const path of paths) {
    try {
      const response = await client.get(path);
      const value = response.data?.[0]?.blockData?.number ?? response.data?.[0]?.number;
      if (value !== undefined) return BigInt(String(value));
    } catch {
      // Try the next STRATO API base path.
    }
  }

  throw new Error("Unable to fetch latest STRATO block number");
};

const fetchBlockEvents = async (
  baseClient: CirrusClient,
  block: bigint,
): Promise<CirrusEventRow[]> => {
  const rows: CirrusEventRow[] = [];
  let page = 0;

  while (true) {
    const pageRows = await baseClient.getRows<CirrusEventRow>(EVENT_TABLE, {
      select: EVENT_SELECT,
      block_number: `eq.${block.toString()}`,
      order: "block_number.asc",
      limit: REFRESH_PAGE_SIZE,
      offset: page * REFRESH_PAGE_SIZE,
    });
    rows.push(...pageRows);
    if (pageRows.length < REFRESH_PAGE_SIZE) break;
    page += 1;
  }

  return rows;
};

const resolveSnapshotDir = (snapshotPath: string): string => {
  const resolved = resolve(snapshotPath);
  if (existsSync(join(resolved, "manifest.json"))) return resolved;
  return findLatestSnapshotDir(resolved) || resolved;
};

export const createSnapshotBackedCirrusClient = (
  baseClient: CirrusClient,
  config: WasConfig,
): CirrusClient => {
  if (!config.eventSnapshotDir) return baseClient;

  const snapshotDir = resolveSnapshotDir(config.eventSnapshotDir);
  const localStore = new LocalEventStore(snapshotDir, config);

  return {
    getRows: async <T>(table: string, params: CirrusQueryParams = {}) => {
      if (refreshesSnapshotBeforeRead(table)) {
        await localStore.refresh(baseClient);
      }

      if (table === EVENT_TABLE) {
        return localStore.getRows(params) as T[];
      }
      return baseClient.getRows<T>(table, params);
    },
    verifyConnectivity: async () => {
      await baseClient.verifyConnectivity();
    },
  };
};
