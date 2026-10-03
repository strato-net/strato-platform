import { api } from '@/lib/axios';
import type { Event } from '@strato/shared-types';
import type { TokenDisplayMetadata } from '@/lib/bridge/types';

export const METAL_ACTIVITY_PAIR = [
  { contract_name: "MetalForge", event_name: "MetalMinted" }
];

export interface MetalTx {
  block_timestamp: string;
  payAmount: string;
  paySymbol: string;
  metalAmount: string;
  metalSymbol: string;
  payDecimals: number;
  metalDecimals: number;
}

export async function resolveTokenMetadata(addresses: string[]): Promise<Map<string, TokenDisplayMetadata>> {
  const map = new Map<string, TokenDisplayMetadata>();
  const normalized = [...new Set(addresses.filter(Boolean).map((address) => address.toLowerCase().replace(/^0x/, "")))];
  const results = await Promise.all(Array.from({ length: Math.ceil(normalized.length / 100) }, async (_, index) => {
    try {
      const { data } = await api.get("/tokens/symbols", {
        params: { addresses: normalized.slice(index * 100, (index + 1) * 100).join(",") },
      });
      return data as Array<TokenDisplayMetadata & { address: string }>;
    } catch { return []; }
  }));
  for (const token of results.flat()) {
    if (!token._symbol) continue;
    const address = token.address.toLowerCase().replace(/^0x/, "");
    const metadata = { _symbol: token._symbol, customDecimals: Number(token.customDecimals ?? 18) };
    map.set(address, metadata);
    map.set(`0x${address}`, metadata);
  }
  for (const address of addresses.filter(Boolean)) {
    const metadata = map.get(address.toLowerCase());
    if (metadata) map.set(address, metadata);
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

export function mapEventsToMetalTxs(events: Event[], metadataMap: Map<string, TokenDisplayMetadata>): MetalTx[] {
  return events.map((e) => {
    const a = e.attributes || {};
    const payToken = metadataMap.get(a.payToken) || metadataMap.get(a.payToken?.toLowerCase());
    const metalToken = metadataMap.get(a.metalToken) || metadataMap.get(a.metalToken?.toLowerCase());
    return {
      block_timestamp: e.block_timestamp || "",
      payAmount: a.payAmount || "0",
      paySymbol: payToken?._symbol || "-",
      payDecimals: payToken?.customDecimals ?? 18,
      metalAmount: a.metalAmount || "0",
      metalSymbol: metalToken?._symbol || "-",
      metalDecimals: metalToken?.customDecimals ?? 18,
    };
  });
}
