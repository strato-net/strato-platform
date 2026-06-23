// Token balances + DeFi positions, pulled from the node's Cirrus index.
// Cirrus is PostgREST-style; addresses are lowercase hex WITHOUT 0x.

import { formatUnits } from "viem";
import type { StratoNetwork } from "./networks";

export interface TokenBalance {
  address: string; // 0x-prefixed
  name: string;
  symbol: string;
  decimals: number;
  raw: string; // base-unit balance
  amount: string; // formatted
  icon?: string; // image URL
}

export interface DefiPosition {
  kind: "pool" | "vault";
  label: string; // e.g. "ETH / USDST" or "ETH Carry Vault"
  sub: string; // e.g. "Liquidity pool" / "Stable pool" / "Vault"
  symbol: string; // LP / share token symbol
  amount: string; // formatted balance
  icon?: string; // image URL
}

function firstImage(rel: unknown): string | undefined {
  const arr = rel as { value?: string }[] | undefined;
  return Array.isArray(arr) ? arr[0]?.value : undefined;
}

function base(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}

function fmt(raw: unknown, decimals: number): string {
  try {
    const n = Number(formatUnits(BigInt(String(raw ?? "0")), decimals));
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return "0";
  }
}

async function cget(url: string): Promise<any[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cirrus ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}

/** Every token the user holds (balance > 0), USDST first then alphabetical. */
export async function fetchTokens(
  network: StratoNetwork,
  address: string
): Promise<TokenBalance[]> {
  const addr = address.toLowerCase().replace(/^0x/, "");
  const url =
    `${base(network)}/BlockApps-Token?balances.key=eq.${addr}` +
    `&select=address,_name,_symbol,customDecimals,images:BlockApps-Token-images(value),` +
    `balances:BlockApps-Token-_balances!inner(balance:value::text)&limit=200`;
  const rows = await cget(url);
  const tokens = rows
    .map((r): TokenBalance => {
      const decimals = Number(r.customDecimals) || 18;
      const raw = r.balances?.[0]?.balance ?? "0";
      return {
        address: `0x${String(r.address ?? "").replace(/^0x/, "")}`,
        name: r._name ?? r._symbol ?? "Token",
        symbol: r._symbol ?? "?",
        decimals,
        raw,
        amount: fmt(raw, decimals),
        icon: firstImage(r.images),
      };
    })
    .filter((t) => t.raw !== "0");
  tokens.sort((a, b) =>
    a.symbol === "USDST" ? -1 : b.symbol === "USDST" ? 1 : a.symbol.localeCompare(b.symbol)
  );
  return tokens;
}

/** The user's liquidity-pool and vault positions. */
export async function fetchDefi(
  network: StratoNetwork,
  address: string
): Promise<DefiPosition[]> {
  const addr = address.toLowerCase().replace(/^0x/, "");
  const b = base(network);

  const poolsUrl =
    `${b}/BlockApps-Pool?lpToken.balances.key=eq.${addr}&lpToken.balances.value=gt.0` +
    `&select=address,isStable,tokenA:tokenA_fkey(_symbol,images:BlockApps-Token-images(value)),` +
    `tokenB:tokenB_fkey(_symbol),` +
    `lpToken:lpToken_fkey!inner(_symbol,images:BlockApps-Token-images(value),` +
    `balances:BlockApps-Token-_balances!inner(balance:value::text))&limit=100`;
  const saveUrl =
    `${b}/BlockApps-SaveUSDSTVault-_balances?key=eq.${addr}&value=gt.0` +
    `&select=value::text,vault:BlockApps-SaveUSDSTVault(_symbol,_name)&limit=50`;
  const yieldUrl =
    `${b}/BlockApps-YieldVault-_balances?key=eq.${addr}&value=gt.0` +
    `&select=value::text,vault:BlockApps-YieldVault(_symbol,_name)&limit=50`;

  // Tolerate networks where a given table doesn't exist.
  const [pools, save, yieldV] = await Promise.all([
    cget(poolsUrl).catch(() => []),
    cget(saveUrl).catch(() => []),
    cget(yieldUrl).catch(() => []),
  ]);

  const positions: DefiPosition[] = [];

  for (const p of pools) {
    const a = p.tokenA?._symbol ?? "?";
    const c = p.tokenB?._symbol ?? "?";
    positions.push({
      kind: "pool",
      label: `${a} / ${c}`,
      sub: p.isStable ? "Stable pool" : "Liquidity pool",
      symbol: p.lpToken?._symbol ?? "LP",
      amount: fmt(p.lpToken?.balances?.[0]?.balance, 18),
      icon: firstImage(p.lpToken?.images) ?? firstImage(p.tokenA?.images),
    });
  }
  for (const v of save) {
    positions.push({
      kind: "vault",
      label: v.vault?._name || "Save USDST",
      sub: "Vault",
      symbol: v.vault?._symbol || "saveUSDST",
      amount: fmt(v.value, 18),
    });
  }
  for (const v of yieldV) {
    positions.push({
      kind: "vault",
      label: v.vault?._name || "Yield vault",
      sub: "Vault",
      symbol: v.vault?._symbol || "vault",
      amount: fmt(v.value, 18),
    });
  }
  return positions;
}
