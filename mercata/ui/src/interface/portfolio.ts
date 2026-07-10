/**
 * Portfolio-tracker aggregated data shapes.
 *
 * These describe the brokerage-style view rendered at `/portfolio`: the overall
 * summary, a breakdown per underlying asset (group), and a breakdown per
 * position within each group. Values are USD numbers already reduced from the
 * various contexts (tokens, CDP, lending, swap) — see `usePortfolio`.
 */

/** Canonical underlying identifier, e.g. "ETH", "USDST", "GOLD", "BTC", "LP". */
export type GroupKey = string;

export type PositionKind =
  | "holding" // plain token balance (may include collateral portion)
  | "cdpCollateral" // collateral locked in a CDP vault
  | "cdpDebt" // USDST debt owed against a CDP vault (liability)
  | "loan" // borrowed amount from the lending pool (liability)
  | "lendingSupply" // supplied liquidity to the lending pool
  | "saveVault" // Save-USDST vault share position
  | "carryVault" // ETH/wBTC carry vault share position
  | "yieldVault" // yield vault share position (e.g. USDC yield)
  | "lpPool" // liquidity-provider token position
  | "safetyStake"; // safety-module stake

export interface PortfolioPosition {
  /** Stable key, `${kind}:${address|asset|symbol}`. */
  id: string;
  kind: PositionKind;
  /** Human label, e.g. "ETHST Holding", "ETH Carry Vault", "USDST Loan". */
  label: string;
  symbol: string;
  address?: string;
  /** Raw on-chain balance (wei-style string in `decimals`). */
  balanceRaw: string;
  decimals: number;
  /** USD value. Signed: liabilities (debt/loan) are negative. */
  valueUsd: number;
  /** Annual percentage yield, when applicable. */
  apy?: number | null;
  /** CDP vault health factor, when applicable. */
  healthFactor?: number | null;
  /** Optional route to a detail/management page for this position. */
  href?: string;
  /** Optional icon image URL. */
  imageUrl?: string;

  // ----- Estimated P&L (flows-based; null when flows unavailable) -----
  investedUsd?: number | null;
  unrealizedUsd?: number | null;
  unrealizedPct?: number | null;
}

export interface PortfolioGroup {
  key: GroupKey;
  label: string;
  /** Net USD value of the group (gross assets minus liabilities within it). */
  totalValueUsd: number;
  /** Sum of asset (non-liability) positions. */
  grossValueUsd: number;
  /** Sum of liability positions (absolute, positive number). */
  debtUsd: number;
  /** Value-weighted blended APY across the group's asset positions. */
  blendedApy?: number | null;
  /** Share of total gross portfolio value (0-100). */
  allocationPct: number;
  positions: PortfolioPosition[];

  // ----- Estimated P&L rollup -----
  investedUsd?: number | null;
  unrealizedUsd?: number | null;
  unrealizedPct?: number | null;
}

export interface PortfolioSummary {
  /** Authoritative net worth (reconciled to `/tokens/v2/net-balance`). */
  totalValueUsd: number;
  /** Sum of all asset positions across groups. */
  totalGrossUsd: number;
  /** Sum of all liabilities across groups (absolute, positive). */
  totalDebtUsd: number;
  groups: PortfolioGroup[];
  isLoading: boolean;

  // ----- Estimated P&L rollup -----
  totalInvestedUsd?: number | null;
  totalUnrealizedUsd?: number | null;
  totalUnrealizedPct?: number | null;
}
