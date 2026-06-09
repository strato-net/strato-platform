import { config } from "./config";
import { fetchWithRetry } from "./fetchWithRetry";
import { logInfo } from "./logger";

interface AddDataPayload {
  tsId: string;
  records: { timestamp: number; value: string }[];
}

export interface TokenizedAssetTimeSeriesIds {
  aum: string;
  circulatingSupply: string;
  marketCap: string;
  nav: string;
  price: string;
  volume: string;
}

/**
 * Push records to a tokenized-asset time series on RWA.io.
 */
export async function pushTokenizedAssetRecords(
  rwaIoAssetId: string,
  payload: AddDataPayload
): Promise<void> {
  const url = `${config.rwaIo.baseUrl}/tokenized-asset-time-series/data/add?assetId=${rwaIoAssetId}`;

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.rwaIo.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `POST ${url} failed: ${res.status} ${res.statusText} — ${text}`
    );
  }

  logInfo("Pushed tokenized-asset records to RWA.io", {
    tsId: payload.tsId,
    count: payload.records.length,
  });
}

/**
 * Push one or more records to an RWA.io time series.
 */
export async function pushRecords(payload: AddDataPayload): Promise<void> {
  const url = `${config.rwaIo.baseUrl}/project-time-series/data/add?slug=${config.rwaIo.slug}`;

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.rwaIo.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `POST ${url} failed: ${res.status} ${res.statusText} — ${text}`
    );
  }

  logInfo("Pushed records to RWA.io", {
    tsId: payload.tsId,
    count: payload.records.length,
  });
}
