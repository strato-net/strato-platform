// CDP (Collateralized Debt Position) liquidation risk, read from the CDPEngine
// contracts — the more common borrowing route on the app. A user can hold
// positions across multiple engine instances and multiple collateral assets; each
// (engine, asset) vault is liquidatable once its collateralizationRatio falls
// below that asset's liquidationRatio. We normalize to the SAME 1e18 health scale
// the lending watcher uses: hf = CR / liquidationRatio, so 1e18 == exactly at the
// liquidation threshold (below = liquidatable).
//
// Reads are unauthenticated (Cirrus + eth_call), so this works while locked.

import { encodeFunctionData, type Address } from "viem";
import type { StratoNetwork } from "./networks";
import { rpcCall } from "./rpc";
import { HEALTH_SCALE } from "./lending";

const CR_ABI = [
  {
    type: "function",
    name: "collateralizationRatio",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface CdpPosition {
  /** CDPEngine instance holding this vault (0x). */
  engine: Address;
  /** Collateral asset, lowercased hex without 0x. */
  asset: string;
  /** Collateral token symbol (best-effort). */
  symbol: string;
  /** CR / liquidationRatio scaled to 1e18 (1e18 = at the liquidation threshold). */
  healthFactor: bigint;
}

function cirrusUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}
const noPrefix = (a: string): string => a.replace(/^0x/, "").toLowerCase();

/**
 * All of a user's CDP positions that carry debt, with a normalized health factor.
 * Returns [] if there's no CDP deployment, no positions, or on any read failure
 * (the watcher treats that as "nothing to report").
 */
export async function fetchCdpPositions(
  network: StratoNetwork,
  user: Address
): Promise<CdpPosition[]> {
  try {
    const u = noPrefix(user);
    // The -vaults table spans every CDPEngine instance (one `address` column per
    // engine), so a single user-filtered query returns all positions everywhere.
    const vRes = await fetch(
      `${cirrusUrl(network)}/BlockApps-CDPEngine-vaults?select=address,asset:key2,Vault:value&key=eq.${u}`
    );
    if (!vRes.ok) return [];
    const vaults = await vRes.json();
    if (!Array.isArray(vaults)) return [];

    const debtVaults = vaults.filter((v) => {
      try {
        return BigInt(v?.Vault?.scaledDebt ?? "0") > 0n;
      } catch {
        return false;
      }
    });
    if (!debtVaults.length) return [];

    const out: CdpPosition[] = [];
    for (const v of debtVaults) {
      const engineRaw = noPrefix(String(v.address));
      const engine = `0x${engineRaw}` as Address;
      const asset = noPrefix(String(v.asset));

      // Authoritative CR from the engine (handles interest accrual / live price).
      let cr: bigint;
      try {
        const data = encodeFunctionData({
          abi: CR_ABI,
          functionName: "collateralizationRatio",
          args: [user, `0x${asset}` as Address],
        });
        const hex = await rpcCall<string>(network.rpcUrl, "eth_call", [
          { to: engine, data },
          "latest",
        ]);
        if (!hex || hex === "0x") continue;
        cr = BigInt(hex);
      } catch {
        continue;
      }
      if (cr >= 2n ** 200n) continue; // no-debt sentinel / infinite

      // Per-asset liquidation threshold for this engine.
      let liqRatio = 0n;
      try {
        const cRes = await fetch(
          `${cirrusUrl(network)}/BlockApps-CDPEngine-collateralConfigs` +
            `?select=CollateralConfig:value&address=eq.${engineRaw}&key=eq.${asset}`
        );
        if (cRes.ok) {
          const rows = await cRes.json();
          liqRatio = BigInt(rows?.[0]?.CollateralConfig?.liquidationRatio ?? "0");
        }
      } catch {
        /* fall through */
      }
      if (liqRatio <= 0n) continue;

      out.push({ engine, asset, symbol: "", healthFactor: (cr * HEALTH_SCALE) / liqRatio });
    }
    if (!out.length) return out;

    // Resolve collateral symbols in one batched lookup.
    try {
      const list = [...new Set(out.map((p) => p.asset))].join(",");
      const tRes = await fetch(
        `${cirrusUrl(network)}/BlockApps-Token?select=address,_symbol&address=in.(${list})`
      );
      if (tRes.ok) {
        const toks = await tRes.json();
        const bySym = new Map<string, string>();
        if (Array.isArray(toks)) {
          for (const t of toks) bySym.set(noPrefix(String(t.address)), String(t._symbol ?? ""));
        }
        for (const p of out) p.symbol = bySym.get(p.asset) || "collateral";
      }
    } catch {
      /* symbols are cosmetic */
    }
    return out;
  } catch {
    return [];
  }
}
