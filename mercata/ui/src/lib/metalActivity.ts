import { api } from '@/lib/axios';
import type { Event } from '@mercata/shared-types';

export const METAL_ACTIVITY_PAIR = [
  { contract_name: "MetalForge", event_name: "MetalMinted", filterConfig: { type: "single" as const, attribute: "buyer" } }
];

export interface MetalTx {
  block_timestamp: string;
  payAmount: string;
  paySymbol: string;
  metalAmount: string;
  metalSymbol: string;
}

export async function resolveTokenSymbols(addresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!addresses.length) return map;
  const results = await Promise.all(
    addresses.map(async (addr) => {
      try {
        const res = await api.get(`/tokens/${addr}`);
        const token = Array.isArray(res.data) ? res.data[0] : res.data;
        return { addr, symbol: token?._symbol || "" };
      } catch { return { addr, symbol: "" }; }
    })
  );
  for (const { addr, symbol } of results) {
    if (symbol) { map.set(addr, symbol); map.set(addr.toLowerCase(), symbol); }
  }
  return map;
}

export function collectMetalTokenAddrs(events: Event[]): Set<string> {
  const addrs = new Set<string>();
  for (const e of events) {
    const a = e.attributes || {};
    if (a.metalToken) addrs.add(a.metalToken);
    if (a.payToken) addrs.add(a.payToken);
  }
  return addrs;
}

export function mapEventsToMetalTxs(events: Event[], symbolMap: Map<string, string>): MetalTx[] {
  return events.map((e) => {
    const a = e.attributes || {};
    return {
      block_timestamp: e.block_timestamp || "",
      payAmount: a.payAmount || "0",
      paySymbol: symbolMap.get(a.payToken) || symbolMap.get(a.payToken?.toLowerCase()) || "-",
      metalAmount: a.metalAmount || "0",
      metalSymbol: symbolMap.get(a.metalToken) || symbolMap.get(a.metalToken?.toLowerCase()) || "-",
    };
  });
}
