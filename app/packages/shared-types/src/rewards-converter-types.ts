import { TransactionResponse } from "./common-types";

/** One of the converter's two tokens, as read from chain. */
export interface RewardsConverterToken {
  address: string;
  symbol: string;
  decimals: number;
}

/** The converter on this network. All amounts are raw integer strings. */
export interface RewardsConverterInfo {
  configured: true;
  address: string;
  rewardsToken: RewardsConverterToken;
  stratoToken: RewardsConverterToken;
  /** STRATO paid per rewards token, scaled by 1e18 (1e18 = 1:1). */
  rate: string;
  paused: boolean;
  /** STRATO the converter holds. */
  reserve: string;
  /** Largest rewards-token amount the reserve can pay for at the current rate. */
  maxConvertible: string;
}

export type RewardsConverterState = { configured: false } | RewardsConverterInfo;

/** One account's rewards-token balance and lifetime conversion totals. */
export interface RewardsConverterAccount {
  balance: string;
  totalConverted: string;
  totalReceived: string;
  conversionCount: number;
}

export interface RewardsConverterConversion {
  /** ISO 8601 time of the block. */
  timestamp: string;
  /** Rewards tokens burned. */
  converted: string;
  /** STRATO paid. */
  received: string;
  /** Rate the conversion ran at, scaled by 1e18. */
  rate: string;
  transactionHash: string;
}

/** One page of an account's conversions, newest first. */
export interface RewardsConverterHistory {
  data: RewardsConverterConversion[];
  totalCount: number;
}

export interface RewardsConverterAdminStats {
  totalBurned: string;
  totalPaid: string;
  conversionCount: number;
  /** Total supply of the rewards token. */
  outstandingSupply: string;
  /** Reserve over what converting the whole supply would pay, scaled by 1e18; null when that is zero. */
  coverage: string | null;
  /** STRATO funded into the reserve, net of withdrawals: reserve + totalPaid. */
  totalFunded: string;
  totalWithdrawn: string;
}

export interface RewardsConverterVolumeBucket {
  /** UTC day ("2026-11-19") in a daily series, UTC month ("2026-11") in a monthly one. */
  period: string;
  /** STRATO paid. */
  paid: string;
  /** Rewards tokens burned. */
  burned: string;
  count: number;
}

/** Outcome of an owner-only call sent as the caller's vote through the AdminRegistry. */
export interface GovernedCallResult extends TransactionResponse {
  /** The issue the vote was recorded on; null once the call executed, or when a wallet signs after the response. */
  issueId: string | null;
  /** True when this vote ran the call. */
  executed: boolean;
}
