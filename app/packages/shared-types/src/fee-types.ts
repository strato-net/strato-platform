/**
 * What the fee hook charges this user for one contract call right now.
 * Every call is covered by one whole voucher when the user has any; the
 * rest are charged in `currency`. When that is STRATO and the user holds
 * too little, the router buys the shortfall with their USDST instead.
 */
export interface FeeQuote {
  /** Currency charged for a call no voucher covers. */
  currency: "STRATO" | "USDST";
  /** Address of that token. */
  currencyAddress: string;
  /** Per-call charge in `currency`, wei. */
  feeWei: string;
  /** Reference value of one call, wei of USDST (0.01). */
  usdFeeWei: string;
  /** Fee router price version the STRATO amount was quoted under; "0" for USDST. */
  priceVersion: string;
  /** False when the STRATO price is stale: only vouchers pay until it recovers. */
  valid: boolean;
  /** Whole vouchers the user holds; each covers one call. */
  vouchers: string;
  /** User's balance of `currency`, wei. */
  balanceWei: string;
  /** The USDST that buys a STRATO shortfall; absent while USDST is the currency itself. */
  fallback?: FeeFallback;
}

export interface FeeFallback {
  /** USDST's address. */
  address: string;
  /** Most USDST the router may spend buying one call's worth of STRATO, wei. */
  maxWei: string;
  /** User's USDST balance, wei. */
  balanceWei: string;
}
