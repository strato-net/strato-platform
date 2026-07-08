/// <reference types="node" />

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../../backend/.env") });

interface PageStat {
  page: number;
  offset: number;
  rowCount: number;
  bytes: number;
  firstBlock?: string | number;
  lastBlock?: string | number;
}

const NODE_URL = process.env.NODE_URL?.replace(/\/$/, "");
const PAGE_SIZE = Number(process.env.WAS_EVENT_MEASURE_PAGE_SIZE || 5000);
const MAX_PAGES = Number(process.env.WAS_EVENT_MEASURE_MAX_PAGES || 0);
const OUTPUT_DIR = resolve(
  __dirname,
  "../debug-dumps/event-size-measurements",
);
const SELECT =
  process.env.WAS_EVENT_MEASURE_SELECT ||
  "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender";

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

const formatBytes = (bytes: number): string => {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(2)} MiB`;
};

const main = async () => {
  const client = await createClient();
  const startedAt = new Date().toISOString();
  const pageStats: PageStat[] = [];
  let totalRows = 0;
  let totalBytes = 0;
  let page = 0;

  while (true) {
    if (MAX_PAGES > 0 && page >= MAX_PAGES) break;

    const offset = page * PAGE_SIZE;
    const response = await client.get("/event", {
      params: {
        select: SELECT,
        order: "block_number.asc",
        limit: PAGE_SIZE,
        offset,
      },
    });
    const rows = Array.isArray(response.data) ? response.data : [];
    const json = JSON.stringify(rows);
    const bytes = Buffer.byteLength(json, "utf8");

    const stat: PageStat = {
      page,
      offset,
      rowCount: rows.length,
      bytes,
      firstBlock: rows[0]?.block_number,
      lastBlock: rows[rows.length - 1]?.block_number,
    };
    pageStats.push(stat);
    totalRows += rows.length;
    totalBytes += bytes;

    console.log(
      [
        `page=${page}`,
        `offset=${offset}`,
        `rows=${rows.length}`,
        `bytes=${bytes}`,
        `size=${formatBytes(bytes)}`,
        `blocks=${stat.firstBlock || "?"}-${stat.lastBlock || "?"}`,
      ].join(" "),
    );

    if (rows.length < PAGE_SIZE) break;
    page += 1;
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    nodeUrlHost: NODE_URL ? new URL(NODE_URL).host : undefined,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES || null,
    select: SELECT,
    totalRows,
    totalBytes,
    totalSizeMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    averageBytesPerRow: totalRows ? Math.round(totalBytes / totalRows) : 0,
    pages: pageStats,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = join(OUTPUT_DIR, `event-size-${Date.now()}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `Measured ${totalRows} rows, ${totalBytes} bytes (${formatBytes(totalBytes)}).`,
  );
  console.log(`Wrote report to ${reportPath}`);
};

main().catch((error) => {
  console.error(error?.response?.data || error);
  process.exit(1);
});
