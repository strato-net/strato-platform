import { config } from "./config";
import { logInfo, logError } from "./logger";

interface TimeSeriesInfo {
  id: string;
  name: string;
  frequency: string;
  network: string;
}

interface InfoResponse {
  infos: TimeSeriesInfo[];
  validators: unknown;
}

interface AddDataPayload {
  tsId: string;
  records: { timestamp: number; value: string }[];
}

/**
 * Fetch all project time-series definitions from RWA.io and return the TVL
 * series ID. Throws if the TVL series cannot be found.
 */
export async function getTvlTimeSeriesId(): Promise<string> {
  const url = `${config.rwaIo.baseUrl}/project-time-series/info?slug=${config.rwaIo.slug}`;

  const res = await fetch(url, {
    headers: { "x-api-key": config.rwaIo.apiKey },
  });

  if (!res.ok) {
    throw new Error(
      `GET ${url} failed: ${res.status} ${res.statusText}`
    );
  }

  const body = (await res.json()) as InfoResponse;
  const tvlSeries = body.infos.find(
    (s) =>
      s.name.toLowerCase().includes("total value locked") ||
      s.name.toLowerCase() === "tvl"
  );

  if (!tvlSeries) {
    throw new Error(
      `No TVL time series found. Available series: ${body.infos.map((s) => s.name).join(", ")}`
    );
  }

  logInfo("Resolved TVL time-series", { tsId: tvlSeries.id, name: tvlSeries.name });
  return tvlSeries.id;
}

/**
 * Push one or more records to an RWA.io time series.
 */
export async function pushRecords(payload: AddDataPayload): Promise<void> {
  const url = `${config.rwaIo.baseUrl}/project-time-series/data/add?slug=${config.rwaIo.slug}`;

  const res = await fetch(url, {
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
