import axios from "axios";
import { Config } from "./config";

/** Cirrus reads; attributes come back as an object or a JSON string depending on the table */
export async function cirrus<T = any>(cfg: Config, path: string, params: Record<string, string | number>): Promise<T[]> {
  const { data } = await axios.get(`${cfg.cirrusBase}${path}`, { params, timeout: 30_000 });
  return (data as any[]).map((row) =>
    typeof row.attributes === "string" ? { ...row, attributes: JSON.parse(row.attributes) } : row
  );
}

export async function stratoApi<T = any>(cfg: Config, path: string, body?: unknown): Promise<T> {
  const url = `${cfg.stratoApiBase}${path}`;
  const { data } = body === undefined
    ? await axios.get(url, { timeout: 30_000 })
    : await axios.post(url, body, { timeout: 60_000 });
  return data;
}

/** Split a list into chunks — keeps Cirrus `in.(...)` filters and batch bodies within URL/body limits */
export const chunk = <T>(xs: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
