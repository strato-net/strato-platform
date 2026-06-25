// Lending position health, read straight from the STRATO LendingPool contract via
// eth_call (no signing, works while locked). Used by the liquidation-risk watcher.
//
// LendingPool.getHealthFactor(user) returns the Aave-style health factor scaled by
// 1e18: 1e18 == the liquidation threshold (anything below is liquidatable), and a
// max-uint sentinel means "no debt" (infinite health). The LendingPool address is
// discovered from the BlockApps-LendingRegistry Cirrus row.

import { encodeFunctionData, type Address } from "viem";
import type { StratoNetwork } from "./networks";
import { rpcCall } from "./rpc";

const HEALTH_ABI = [
  {
    type: "function",
    name: "getHealthFactor",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** 1e18-scaled health factor where 1e18 = liquidation threshold. */
export const HEALTH_SCALE = 10n ** 18n;

export interface LoanHealth {
  /** Health factor scaled by 1e18 (only meaningful when hasDebt). */
  healthFactor: bigint;
  /** False when the user has no outstanding debt (nothing to liquidate). */
  hasDebt: boolean;
}

function cirrusUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}

/**
 * Discover the LendingPool contract address from the LendingRegistry. There can be
 * multiple registry rows (and the first one often has an EMPTY lendingPool), so
 * pick the first row with a real, non-zero pool address rather than `limit=1`.
 */
async function lendingPoolAddress(n: StratoNetwork): Promise<Address | null> {
  const url = `${cirrusUrl(n)}/BlockApps-LendingRegistry?select=lendingPool`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ lendingPool?: string }>;
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    const raw = String(r.lendingPool ?? "").replace(/^0x/, "");
    if (raw && !/^0+$/.test(raw)) return `0x${raw}` as Address;
  }
  return null;
}

/**
 * Read a user's lending health on a STRATO network. Returns null if there's no
 * lending deployment or the call fails (the watcher treats that as "nothing to
 * report" rather than surfacing an error).
 */
export async function fetchLoanHealth(
  network: StratoNetwork,
  user: Address
): Promise<LoanHealth | null> {
  try {
    const pool = await lendingPoolAddress(network);
    if (!pool) return null;
    const data = encodeFunctionData({
      abi: HEALTH_ABI,
      functionName: "getHealthFactor",
      args: [user],
    });
    const hex = await rpcCall<string>(network.rpcUrl, "eth_call", [
      { to: pool, data },
      "latest",
    ]);
    if (!hex || hex === "0x") return null;
    const hf = BigInt(hex);
    // No-debt sentinel is ~2^256-1; treat anything astronomically large as no debt.
    const hasDebt = hf < 2n ** 200n;
    return { healthFactor: hf, hasDebt };
  } catch {
    return null;
  }
}
