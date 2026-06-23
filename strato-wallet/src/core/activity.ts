// Activity feed pulled from the node's Cirrus index (BlockApps-Token-Transfer),
// which lists token transfers in BOTH directions with the token symbol — ideal
// for a wallet activity view. Addresses in Cirrus are lowercase hex with no 0x.

import { formatEther } from "viem";
import type { StratoNetwork } from "./networks";

export type ActivityDirection = "in" | "out" | "self";

export interface ActivityItem {
  hash: string; // 0x-prefixed
  timestamp: number; // epoch ms
  direction: ActivityDirection;
  symbol: string;
  /** formatted token amount, e.g. "0.82" */
  amount: string;
  /** the other party, 0x-prefixed */
  counterparty: string;
}

function cirrusBase(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}

function toWei(value: unknown): bigint {
  try {
    if (typeof value === "string") return BigInt(value);
    if (typeof value === "number") return BigInt(Math.trunc(value));
    return 0n;
  } catch {
    return 0n;
  }
}

function parseTs(s: unknown): number {
  // Cirrus format: "2026-06-23 19:18:43 UTC"
  const t = Date.parse(String(s).replace(" ", "T").replace(" UTC", "Z"));
  return Number.isNaN(t) ? Date.now() : t;
}

function fmtAmount(v: bigint): string {
  return Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export async function fetchActivity(
  network: StratoNetwork,
  address: string,
  limit = 25
): Promise<ActivityItem[]> {
  const addr = address.toLowerCase().replace(/^0x/, "");
  const url =
    `${cirrusBase(network)}/BlockApps-Token-Transfer` +
    `?or=(from.eq.${addr},to.eq.${addr})` +
    `&select=*,BlockApps-Token(_name,_symbol)` +
    `&order=block_timestamp.desc&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Activity fetch failed (${res.status})`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows.map((r): ActivityItem => {
    const from = String(r.from ?? "").toLowerCase();
    const to = String(r.to ?? "").toLowerCase();
    const direction: ActivityDirection =
      from === addr && to === addr ? "self" : from === addr ? "out" : "in";
    const token = r["BlockApps-Token"] ?? {};
    return {
      hash: `0x${String(r.transaction_hash ?? "").replace(/^0x/, "")}`,
      timestamp: parseTs(r.block_timestamp),
      direction,
      symbol: token._symbol || token._name || "token",
      amount: fmtAmount(toWei(r.value)),
      counterparty: `0x${(direction === "out" ? to : from).replace(/^0x/, "")}`,
    };
  });
}
