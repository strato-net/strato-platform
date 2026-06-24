// Token balances + activity for generic EVM networks (Ethereum, Base, Linea),
// sourced from the MetaMask accounts API (same endpoints the MetaMask extension
// uses). STRATO networks use Cirrus instead (see portfolio.ts / activity.ts).

import { formatUnits, parseUnits } from "viem";
import type { TokenBalance } from "./portfolio";
import type { ActivityItem } from "./activity";

const API = "https://accounts.api.cx.metamask.io/v4/multiaccount";
const MAX_TOKENS = 100;

function fmt(n: number): string {
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function tokenIcon(chainId: string, address: string): string {
  return `https://static.cx.metamask.io/api/v1/tokenIcons/${chainId}/${address.toLowerCase()}.png`;
}

/** Token balances for an address on an EVM chain. `balance` is human-readable. */
export async function fetchEvmTokens(
  chainId: string,
  address: string
): Promise<TokenBalance[]> {
  const url = `${API}/balances?accountAddresses=eip155:${chainId}:${address}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Balances fetch failed (${res.status})`);
  const data = await res.json();
  const all: any[] = Array.isArray(data?.balances) ? data.balances : [];
  // The API ignores the chainId in accountAddresses and returns balances across
  // ALL of the account's chains, so filter to the requested chain.
  const rows = all.filter((b) => String(b.chainId) === String(chainId));

  const tokens = rows
    .map((b): TokenBalance => {
      const decimals = Number(b.decimals) || 18;
      const human = String(b.balance ?? "0");
      let raw = "0";
      try {
        raw = parseUnits(human, decimals).toString();
      } catch {
        /* keep 0 */
      }
      return {
        address: b.address,
        name: b.name ?? b.symbol ?? "Token",
        symbol: b.symbol ?? "?",
        decimals,
        raw,
        amount: fmt(Number(human)),
        icon: tokenIcon(chainId, b.address),
        status: 2,
      };
    })
    .filter((t) => t.raw !== "0");

  // Native first, then alphabetical; cap to keep the list manageable.
  tokens.sort((a, b) => {
    const an = /^0x0+$/.test(a.address) ? 0 : 1;
    const bn = /^0x0+$/.test(b.address) ? 0 : 1;
    if (an !== bn) return an - bn;
    return a.symbol.localeCompare(b.symbol);
  });
  return tokens.slice(0, MAX_TOKENS);
}

/** Recent activity for an address on an EVM chain. */
export async function fetchEvmActivity(
  chainId: string,
  address: string,
  nativeSymbol: string
): Promise<ActivityItem[]> {
  const url =
    `${API}/transactions?accountAddresses=eip155:0:${address}` +
    `&networks=eip155:${chainId}&includeTxMetadata=true&lang=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Activity fetch failed (${res.status})`);
  const data = await res.json();
  const all: any[] = Array.isArray(data?.data) ? data.data : [];
  const rows = all.filter((tx) => String(tx.chainId) === String(chainId));
  const addr = address.toLowerCase();

  return rows.map((tx): ActivityItem => {
    const transfers: any[] = Array.isArray(tx.valueTransfers) ? tx.valueTransfers : [];
    const vt =
      transfers.find(
        (v) => v.to?.toLowerCase() === addr || v.from?.toLowerCase() === addr
      ) ?? transfers[0];

    if (vt) {
      const incoming = vt.to?.toLowerCase() === addr;
      let amount = "0";
      try {
        amount = fmt(Number(formatUnits(BigInt(vt.amount ?? "0"), Number(vt.decimal) || 18)));
      } catch {
        /* keep 0 */
      }
      return {
        hash: tx.hash,
        timestamp: Date.parse(tx.timestamp) || Date.now(),
        direction: incoming ? "in" : "out",
        symbol: vt.symbol ?? "?",
        amount,
        counterparty: incoming ? vt.from : vt.to,
      };
    }

    // Native value transfer.
    const incoming = tx.to?.toLowerCase() === addr;
    let amount = "0";
    try {
      amount = fmt(Number(formatUnits(BigInt(tx.value ?? "0"), 18)));
    } catch {
      /* keep 0 */
    }
    return {
      hash: tx.hash,
      timestamp: Date.parse(tx.timestamp) || Date.now(),
      direction: incoming ? "in" : "out",
      symbol: nativeSymbol,
      amount,
      counterparty: incoming ? tx.from : tx.to,
    };
  });
}
