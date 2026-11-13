/**
 * One VestingPool grant as GET /api/vesting computes it from the pool's Cirrus row.
 * Amounts are decimal strings in token atoms (18 decimals); times are unix seconds.
 */
export type VestingStatus = "not_started" | "vesting" | "paused" | "cancelled" | "fully_vested" | "complete";

export interface VestingView {
  /** 64-hex vesting id, no 0x. */
  vestingId: string;
  /** 40-hex beneficiary account, no 0x. */
  account: string;
  managed: boolean;
  cancelled: boolean;
  /** 0 linear, 1 quadratic. */
  curveType: number;
  durationWeeks: number;
  durationSeconds: number;
  startDate: number;
  /** startDate + durationSeconds; a lower bound while paused. */
  endDate: number;
  /** 0 when not paused; the freeze instant when paused or cancelled. */
  pausingDate: number;
  amount: string;
  amountClaimed: string;
  vested: string;
  claimable: string;
  /** Still to vest. 0 for a cancelled vesting, whose remainder is `returned`. */
  locked: string;
  /** Unvested remainder returned to the pool by a cancel; "0" otherwise. */
  returned: string;
  status: VestingStatus;
}

export interface VestingSummary {
  amount: string;
  vested: string;
  claimed: string;
  claimable: string;
  locked: string;
  returned: string;
}

export interface VestingsResponse {
  /** Pool address, or null when the network has no configured pool. */
  pool: string | null;
  vestings: VestingView[];
  summary: VestingSummary;
}
