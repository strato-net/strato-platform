// Data for the token details page (STRATO tokens + DeFi position tokens), pulled
// from Cirrus: token metadata + supply (BlockApps-Token), current price
// (PriceOracle-prices), the user's balance, and a reconstructed price series from
// the PriceOracle's BatchPricesUpdated events (aligned assets[]/priceValues[]).

import { formatUnits } from "viem";
import type { StratoNetwork } from "./networks";

function base(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}
const noPrefix = (a: string): string => a.replace(/^0x/, "").toLowerCase();

async function cget(url: string): Promise<any[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cirrus ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}
function firstImage(rel: unknown): string | undefined {
  const arr = rel as { value?: string }[] | undefined;
  return Array.isArray(arr) ? arr[0]?.value : undefined;
}
function toNum(raw: unknown, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(String(raw ?? "0")), decimals));
  } catch {
    return 0;
  }
}

export interface TokenDetail {
  address: string; // 0x
  symbol: string;
  name: string;
  icon?: string;
  decimals: number;
  description?: string;
  status: number;
  /** USD per token (undefined if the oracle has no price — e.g. LP/vault tokens). */
  priceUsd?: number;
  balanceAmount: string; // formatted token amount
  balanceUsd?: number;
  marketCapUsd?: number;
  circulatingSupply?: number; // = total supply
}

export interface PricePoint {
  t: number; // unix seconds
  price: number; // USD
}

/** Token metadata + the user's balance + current price/market figures. */
export async function fetchTokenDetail(
  network: StratoNetwork,
  token: string,
  user: string
): Promise<TokenDetail | null> {
  const t = noPrefix(token);
  const u = noPrefix(user);
  const url =
    `${base(network)}/BlockApps-Token?address=eq.${t}` +
    `&select=address,_name,_symbol,customDecimals,status,description,_totalSupply::text,` +
    `images:BlockApps-Token-images(value),` +
    `balances:BlockApps-Token-_balances(balance:value::text)&balances.key=eq.${u}&limit=1`;
  const rows = await cget(url).catch(() => []);
  if (!rows.length) return null;
  const r = rows[0];

  const decimals = Number(r.customDecimals) || 18;
  const raw = r.balances?.[0]?.balance ?? "0";

  const priceRows = await cget(
    `${base(network)}/BlockApps-PriceOracle-prices?select=value::text&key=eq.${t}`
  ).catch(() => []);
  const priceUsd = priceRows.length ? toNum(priceRows[0].value, 18) : undefined;

  const balanceAmount = toNum(raw, decimals);
  const supplyAmount = toNum(r._totalSupply, decimals);

  return {
    address: `0x${t}`,
    symbol: r._symbol ?? "?",
    name: r._name ?? r._symbol ?? "Token",
    icon: firstImage(r.images),
    decimals,
    description: r.description || undefined,
    status: Number(r.status),
    priceUsd: priceUsd && priceUsd > 0 ? priceUsd : undefined,
    balanceAmount: balanceAmount.toLocaleString(undefined, { maximumFractionDigits: 6 }),
    balanceUsd: priceUsd ? balanceAmount * priceUsd : undefined,
    marketCapUsd: priceUsd && supplyAmount ? priceUsd * supplyAmount : undefined,
    circulatingSupply: supplyAmount || undefined,
  };
}

/** ISO timestamp (UTC, no ms/zone suffix) the history table's valid_from/to expect. */
function isoAt(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 19);
}

/**
 * USD price series for a token over [sinceUnix, now], sampled at `samples` evenly
 * spaced points from the temporal price-history table (history@mapping, the
 * PriceOracle's `prices` mapping with valid_from/valid_to). For each sample time we
 * ask for the price that was valid at that instant. Samples that predate the
 * token's first price return nothing and are dropped, so "All" naturally trims to
 * the available history.
 */
export async function fetchPriceHistory(
  network: StratoNetwork,
  token: string,
  sinceUnix = 0,
  samples = 40
): Promise<PricePoint[]> {
  const t = noPrefix(token);
  // Discover the price-oracle instance (all prices live under one).
  const oraRows = await cget(
    `${base(network)}/BlockApps-PriceOracle-prices?select=address&limit=1`
  ).catch(() => []);
  const oracle = oraRows[0]?.address ? noPrefix(String(oraRows[0].address)) : null;
  if (!oracle) return [];

  const now = Math.floor(Date.now() / 1000);
  const start = sinceUnix > 0 ? sinceUnix : now - 5 * 365 * 24 * 3600; // "All" → up to 5y back
  const span = Math.max(1, now - start);
  const n = Math.max(2, samples);

  const sampleAt = async (sec: number): Promise<PricePoint | null> => {
    const iso = isoAt(sec);
    const url =
      `${base(network)}/history@mapping?address=eq.${oracle}&collection_name=eq.prices` +
      `&valid_from=lte.${iso}&valid_to=gte.${iso}&key-%3E%3Ekey=eq.${t}&select=value`;
    const rows = await cget(url).catch(() => []);
    const v = rows[0]?.value;
    if (v == null) return null;
    const price = Number(v) / 1e18;
    return isFinite(price) && price > 0 ? { t: sec, price } : null;
  };

  const secs = Array.from({ length: n }, (_, i) => Math.floor(start + (span * i) / (n - 1)));
  const results = await Promise.all(secs.map(sampleAt));
  return results.filter((p): p is PricePoint => p !== null);
}
