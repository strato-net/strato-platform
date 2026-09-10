import { api } from '@/lib/axios';
import type { Event } from '@strato/shared-types';

export const METAL_ACTIVITY_PAIR = [
  { contract_name: "MetalForge", event_name: "MetalMinted" }
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
  const normalized = [...new Set(addresses.filter(Boolean).map((address) => address.toLowerCase().replace(/^0x/, "")))];
  const results = await Promise.all(Array.from({ length: Math.ceil(normalized.length / 100) }, async (_, index) => {
    try {
      const { data } = await api.get("/tokens/symbols", {
        params: { addresses: normalized.slice(index * 100, (index + 1) * 100).join(",") },
      });
      return data as Array<{ address: string; _symbol: string }>;
    } catch { return []; }
  }));
  for (const token of results.flat()) {
    if (!token._symbol) continue;
    const address = token.address.toLowerCase().replace(/^0x/, "");
    map.set(address, token._symbol);
    map.set(`0x${address}`, token._symbol);
  }
  for (const address of addresses.filter(Boolean)) {
    const symbol = map.get(address.toLowerCase());
    if (symbol) map.set(address, symbol);
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
