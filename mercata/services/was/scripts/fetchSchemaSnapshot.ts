/// <reference types="node" />

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROTOCOL_ASSOCIATION_EVENT_NAMES } from "../src/protocolEventConfig";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../../backend/.env") });

type JsonObject = Record<string, unknown>;

interface SnapshotTarget {
  name: string;
  table: string;
  params?: Record<string, string | number>;
}

interface InferredField {
  types: string[];
  nested?: Record<string, InferredField>;
}

interface SnapshotEntry {
  name: string;
  table: string;
  params: Record<string, string | number>;
  rowCount: number;
  fields: Record<string, InferredField>;
  sampleRows: JsonObject[];
}

const OUTPUT_DIR = resolve(
  __dirname,
  "../test/fixtures/schema-snapshot/current",
);
const SAMPLE_LIMIT = Number(process.env.WAS_SCHEMA_SNAPSHOT_LIMIT || 5);
const NODE_URL = process.env.NODE_URL?.replace(/\/$/, "");

const WAS_TABLES: SnapshotTarget[] = [
  { name: "mercataBridge.withdrawals", table: "/BlockApps-MercataBridge-withdrawals" },
  { name: "stratoNativeBridge.withdrawals", table: "/BlockApps-StratoNativeBridge-withdrawals" },
  { name: "mercataBridge.state", table: "/BlockApps-MercataBridge" },
  { name: "stratoNativeBridge.state", table: "/BlockApps-StratoNativeBridge" },
  { name: "mercataBridge.assets", table: "/BlockApps-MercataBridge-assets" },
  { name: "stratoNativeBridge.assets", table: "/BlockApps-StratoNativeBridge-assets" },
  {
    name: "event.generic",
    table: "/event",
    params: {
      select:
        "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
    },
  },
];

const WAS_EVENT_NAMES = [
  "DepositCompleted",
  "WithdrawalRequested",
  "NativeDepositCompleted",
  "NativeWithdrawalRequested",
  "Transfer",
  ...PROTOCOL_ASSOCIATION_EVENT_NAMES,
].filter((eventName, index, eventNames) => eventNames.indexOf(eventName) === index);

const eventTargets: SnapshotTarget[] = WAS_EVENT_NAMES.map((eventName) => ({
  name: `event.${eventName}`,
  table: "/event",
  params: {
    event_name: `eq.${eventName}`,
    select:
      "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
  },
}));

const fileNameForTarget = (targetName: string): string =>
  `${targetName.replace(/[^a-z0-9]+/gi, "-")}.json`;

const valueType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const mergeField = (field: InferredField | undefined, value: unknown): InferredField => {
  const current: InferredField = field || { types: [] };
  const type = valueType(value);
  if (!current.types.includes(type)) current.types.push(type);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    current.nested ||= {};
    for (const [key, nestedValue] of Object.entries(value as JsonObject)) {
      current.nested[key] = mergeField(current.nested[key], nestedValue);
    }
  }

  current.types.sort();
  return current;
};

const inferFields = (rows: JsonObject[]): Record<string, InferredField> => {
  const fields: Record<string, InferredField> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      fields[key] = mergeField(fields[key], value);
    }
  }
  return fields;
};

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
    timeout: 60_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
};

const fetchTarget = async (
  client: AxiosInstance,
  target: SnapshotTarget,
): Promise<SnapshotEntry> => {
  const params = {
    limit: SAMPLE_LIMIT,
    ...target.params,
  };
  const response = await client.get(target.table, { params });
  const rows = Array.isArray(response.data) ? response.data : [];

  return {
    name: target.name,
    table: target.table,
    params,
    rowCount: rows.length,
    fields: inferFields(rows),
    sampleRows: rows,
  };
};

const main = async () => {
  const client = await createClient();
  const targets = [...WAS_TABLES, ...eventTargets];
  const entries: SnapshotEntry[] = [];

  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const target of targets) {
    try {
      const entry = await fetchTarget(client, target);
      entries.push(entry);
      writeFileSync(
        join(OUTPUT_DIR, fileNameForTarget(target.name)),
        `${JSON.stringify(entry, null, 2)}\n`,
      );
    } catch (error: any) {
      const entry = {
        name: target.name,
        table: target.table,
        params: {
          limit: SAMPLE_LIMIT,
          ...target.params,
        },
        rowCount: 0,
        fields: {},
        sampleRows: [
          {
            error: error?.response?.data || error?.message || "Unknown error",
          },
        ],
      };
      entries.push(entry);
      writeFileSync(
        join(OUTPUT_DIR, fileNameForTarget(target.name)),
        `${JSON.stringify(entry, null, 2)}\n`,
      );
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    nodeUrlHost: NODE_URL ? new URL(NODE_URL).host : undefined,
    sampleLimit: SAMPLE_LIMIT,
    targets: entries.map((entry) => ({
      name: entry.name,
      table: entry.table,
      file: fileNameForTarget(entry.name),
      rowCount: entry.rowCount,
    })),
  };

  writeFileSync(join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote schema snapshot files to ${OUTPUT_DIR}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
