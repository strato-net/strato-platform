import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CirrusClient, CirrusEventRow, CirrusQueryParams, WasConfig } from "./types";
import { logInfo } from "./logger";

interface SnapshotManifestFile {
  file: string;
  rowCount: number;
}

interface SnapshotManifest {
  totalRows: number;
  files: SnapshotManifestFile[];
}

const EVENT_TABLE = "/event";

const normalizeAddress = (address?: string): string =>
  address ? address.toLowerCase().replace(/^0x/, "") : "";

const normalizeValue = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

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

const parseEventNames = (value: unknown): Set<string> | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("eq.")) return new Set([value.slice(3)]);
  if (value.startsWith("in.(") && value.endsWith(")")) {
    return new Set(value.slice(4, -1).split(",").filter(Boolean));
  }
  return undefined;
};

const eventBlock = (event: CirrusEventRow): bigint | undefined => {
  try {
    return BigInt(normalizeValue(event.block_number));
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

  constructor(private readonly snapshotDir: string) {
    this.load();
  }

  private addEvent(event: CirrusEventRow) {
    this.events.push(event);

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

export const createSnapshotBackedCirrusClient = (
  baseClient: CirrusClient,
  config: WasConfig,
): CirrusClient => {
  if (!config.eventSnapshotDir) return baseClient;

  const snapshotDir = resolve(config.eventSnapshotDir);
  const localStore = new LocalEventStore(snapshotDir);

  return {
    getRows: async <T>(table: string, params: CirrusQueryParams = {}) => {
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
