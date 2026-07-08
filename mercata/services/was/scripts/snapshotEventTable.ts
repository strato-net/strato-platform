/// <reference types="node" />

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../../backend/.env") });

interface SnapshotFile {
  block?: string;
  file: string;
  rowCount: number;
  bytes: number;
  firstBlock?: string | number;
  lastBlock?: string | number;
}

interface SnapshotManifest {
  highestBlock?: string;
  totalRows: number;
  totalBytes?: number;
  files: SnapshotFile[];
}

type SnapshotMode = "update" | "refresh";
interface SnapshotPage {
  page: number;
  offset: number;
  rows: any[];
}

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const NODE_URL = process.env.NODE_URL?.replace(/\/$/, "");
const PAGE_SIZE = Number(process.env.WAS_EVENT_SNAPSHOT_PAGE_SIZE || 5000);
const MAX_PAGES = Number(process.env.WAS_EVENT_SNAPSHOT_MAX_PAGES || 0);
const BLOCK_RANGE_SPANS = [10000n, 1000n, 100n, 10n];
const SNAPSHOT_ROOT = resolve(
  __dirname,
  "../debug-dumps/event-table-snapshot",
);
const SELECT =
  process.env.WAS_EVENT_SNAPSHOT_SELECT ||
  "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender";
const MODE: SnapshotMode = args.has("--refresh") ? "refresh" : "update";
const FETCH_CONCURRENCY = parsePositiveInteger(
  argValue("concurrency") || process.env.WAS_EVENT_SNAPSHOT_FETCH_CONCURRENCY,
  4,
);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const getTokenEndpoint = async (): Promise<string | undefined> => {
  const discoveryUrl = process.env.OAUTH_DISCOVERY_URL;
  if (!discoveryUrl) return undefined;

  const response = await axios.get(discoveryUrl);
  return response.data?.token_endpoint;
};

const getAccessToken = async (): Promise<string | undefined> => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;

  const tokenEndpoint = await getTokenEndpoint();
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

const createClient = async (): Promise<AxiosInstance> => {
  if (!NODE_URL) throw new Error("NODE_URL is required");

  const accessToken = await getAccessToken();
  return axios.create({
    baseURL: `${NODE_URL}/cirrus/search`,
    timeout: 120_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
};

const safeFilePart = (value: unknown): string =>
  String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

const formatBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

const rowsToJsonl = (rows: any[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");

const blockNumber = (row: any): string => String(row?.block_number ?? "0");

const blockValue = (value: unknown): bigint => {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
};

const readManifest = (snapshotDir: string): SnapshotManifest => {
  return JSON.parse(
    readFileSync(join(snapshotDir, "manifest.json"), "utf8"),
  ) as SnapshotManifest;
};

const highestManifestBlock = (
  manifest: SnapshotManifest | undefined,
  fallback: bigint | undefined,
): bigint | undefined => {
  if (manifest?.highestBlock !== undefined) return blockValue(manifest.highestBlock);

  const highestFileBlock = manifest?.files.reduce<bigint | undefined>(
    (highest, file) => {
      const block = blockValue(file.block ?? file.lastBlock ?? file.firstBlock);
      return highest === undefined || block > highest ? block : highest;
    },
    undefined,
  );
  return highestFileBlock ?? fallback;
};

const latestSnapshotDir = (): { dir: string; highestBlock: bigint } | undefined => {
  if (!existsSync(SNAPSHOT_ROOT)) return undefined;

  const snapshots = readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = entry.name.match(/^snapshot-(\d+)$/);
      if (!match) return undefined;

      const dir = join(SNAPSHOT_ROOT, entry.name);
      const manifest = existsSync(join(dir, "manifest.json"))
        ? readManifest(dir)
        : undefined;
      return {
        dir,
        highestBlock: highestManifestBlock(manifest, BigInt(match[1])) || 0n,
      };
    })
    .filter((entry): entry is { dir: string; highestBlock: bigint } => !!entry)
    .sort((a, b) => (a.highestBlock > b.highestBlock ? -1 : 1));

  return snapshots[0];
};

const writeBlockFile = (
  outputDir: string,
  block: string,
  rows: any[],
): SnapshotFile => {
  const contents = rowsToJsonl(rows);
  const bytes = Buffer.byteLength(contents, "utf8");
  const rangeDir = blockRangeDir(block);
  const file = `${rangeDir}/block-${safeFilePart(block)}.jsonl`;
  mkdirSync(join(outputDir, rangeDir), { recursive: true });
  writeFileSync(join(outputDir, file), contents);
  return {
    block,
    file,
    rowCount: rows.length,
    bytes,
  };
};

const blockRangeDir = (block: string): string => {
  const blockNumber = blockValue(block);
  if (blockNumber <= 0n) return "0-0";

  return BLOCK_RANGE_SPANS.map((span) => {
    const start = ((blockNumber - 1n) / span) * span + 1n;
    const end = start + span - 1n;
    return `${start.toString()}-${end.toString()}`;
  }).join("/");
};

const normalizeExistingSnapshot = (
  sourceDir: string,
  manifest: SnapshotManifest,
  outputDir: string,
): { files: SnapshotFile[]; totalRows: number; totalBytes: number; highestBlock?: bigint } => {
  const files: SnapshotFile[] = [];
  let totalRows = 0;
  let totalBytes = 0;
  let highestBlock: bigint | undefined;
  let currentBlock: string | undefined;
  let currentRows: any[] = [];

  const flushCurrentBlock = () => {
    if (!currentBlock || !currentRows.length) return;
    const file = writeBlockFile(outputDir, currentBlock, currentRows);
    files.push(file);
    totalRows += file.rowCount;
    totalBytes += file.bytes;
    const block = blockValue(currentBlock);
    if (highestBlock === undefined || block > highestBlock) {
      highestBlock = block;
    }
    currentRows = [];
  };

  for (const file of manifest.files) {
    const contents = readFileSync(join(sourceDir, file.file), "utf8");
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const block = blockNumber(row);
      if (currentBlock && block !== currentBlock) {
        flushCurrentBlock();
      }
      currentBlock = block;
      currentRows.push(row);
    }
  }

  flushCurrentBlock();
  return { files, totalRows, totalBytes, highestBlock };
};

const fetchEventPage = async (
  client: AxiosInstance,
  page: number,
  fromBlock: bigint | undefined,
): Promise<SnapshotPage> => {
  const offset = page * PAGE_SIZE;
  const response = await client.get("/event", {
    params: {
      select: SELECT,
      order: "block_number.asc",
      limit: PAGE_SIZE,
      offset,
      ...(MODE === "update" && fromBlock !== undefined
        ? { block_number: `gt.${fromBlock.toString()}` }
        : {}),
    },
  });
  return {
    page,
    offset,
    rows: Array.isArray(response.data) ? response.data : [],
  };
};

const main = async () => {
  const client = await createClient();
  const existingSnapshot = MODE === "update" ? latestSnapshotDir() : undefined;
  const existingManifest = existingSnapshot
    ? readManifest(existingSnapshot.dir)
    : undefined;
  const fromBlock = highestManifestBlock(
    existingManifest,
    existingSnapshot?.highestBlock,
  );
  const startedAt = new Date().toISOString();
  const writeDir = join(SNAPSHOT_ROOT, `snapshot-building-${Date.now()}`);
  mkdirSync(writeDir, { recursive: true });
  const normalizedExisting = existingSnapshot && existingManifest
    ? normalizeExistingSnapshot(existingSnapshot.dir, existingManifest, writeDir)
    : { files: [], totalRows: 0, totalBytes: 0, highestBlock: undefined };
  const appendedFiles: SnapshotFile[] = [];
  let appendedRows = 0;
  let appendedBytes = 0;
  let highestBlock = normalizedExisting.highestBlock ?? fromBlock;
  let currentBlock: string | undefined;
  let currentRows: any[] = [];
  let nextPage = 0;

  const flushCurrentBlock = () => {
    if (!currentBlock || !currentRows.length) return;
    const file = writeBlockFile(writeDir, currentBlock, currentRows);
    appendedFiles.push(file);
    appendedRows += file.rowCount;
    appendedBytes += file.bytes;
    const block = blockValue(currentBlock);
    if (highestBlock === undefined || block > highestBlock) {
      highestBlock = block;
    }
    console.log(
      [
        `block=${currentBlock}`,
        `rows=${file.rowCount}`,
        `bytes=${file.bytes}`,
        `size=${formatBytes(file.bytes)}`,
        `file=${file.file}`,
      ].join(" "),
    );
    currentRows = [];
  };

  while (true) {
    const remainingPages = MAX_PAGES > 0 ? MAX_PAGES - nextPage : FETCH_CONCURRENCY;
    if (remainingPages <= 0) break;

    const batchSize = Math.min(FETCH_CONCURRENCY, remainingPages);
    const pages = Array.from({ length: batchSize }, (_, index) => nextPage + index);
    const fetchedPages = await Promise.all(
      pages.map((page) => fetchEventPage(client, page, fromBlock)),
    );
    const firstShortPageIndex = fetchedPages.findIndex(
      (fetchedPage) => fetchedPage.rows.length < PAGE_SIZE,
    );
    const pagesToWrite =
      firstShortPageIndex >= 0
        ? fetchedPages.slice(0, firstShortPageIndex + 1)
        : fetchedPages;

    for (const fetchedPage of pagesToWrite) {
      const rows = fetchedPage.rows;

      console.log(
        [
          `page=${fetchedPage.page}`,
          `offset=${fetchedPage.offset}`,
          `rows=${rows.length}`,
          MODE === "update" && fromBlock !== undefined
            ? `fromBlockExclusive=${fromBlock.toString()}`
            : "fromBlockExclusive=",
        ].join(" "),
      );

      for (const row of rows) {
        const block = blockNumber(row);
        if (currentBlock && block !== currentBlock) {
          flushCurrentBlock();
        }
        currentBlock = block;
        currentRows.push(row);
      }
    }

    if (firstShortPageIndex >= 0) break;
    nextPage += fetchedPages.length;
  }

  flushCurrentBlock();

  const finalHighestBlock = highestBlock?.toString() || "0";
  const finalDir = join(SNAPSHOT_ROOT, `snapshot-${finalHighestBlock}`);
  const totalRows = normalizedExisting.totalRows + appendedRows;
  const totalBytes = normalizedExisting.totalBytes + appendedBytes;
  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    nodeUrlHost: NODE_URL ? new URL(NODE_URL).host : undefined,
    mode: MODE,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES || null,
    fetchConcurrency: FETCH_CONCURRENCY,
    select: SELECT,
    fromBlockExclusive:
      MODE === "update" && fromBlock !== undefined ? fromBlock.toString() : undefined,
    highestBlock: finalHighestBlock,
    totalRows,
    totalBytes,
    totalSizeMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    averageBytesPerRow: totalRows ? Math.round(totalBytes / totalRows) : 0,
    files: [...normalizedExisting.files, ...appendedFiles],
  };

  writeFileSync(join(writeDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(finalDir, { recursive: true, force: true });
  renameSync(writeDir, finalDir);
  if (existingSnapshot && existingSnapshot.dir !== finalDir) {
    rmSync(existingSnapshot.dir, { recursive: true, force: true });
  }

  console.log(
    `Wrote ${appendedRows} new rows to ${appendedFiles.length} block files, ${formatBytes(appendedBytes)} new data.`,
  );
  console.log(`Snapshot directory: ${finalDir}`);
};

main().catch((error) => {
  console.error(error?.response?.data || error);
  process.exit(1);
});
