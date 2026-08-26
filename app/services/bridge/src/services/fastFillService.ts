/**
 * Fast fill: advancing a deposit's funds to its recipient before the source
 * block finalises, then being reimbursed the full deposit when it is proven.
 *
 * BlockApps runs this for UX, not profit. A third-party LP fills when the fee
 * beats its risk-adjusted cost; we fill everything inside a safety envelope
 * even at a zero fee -- which is exactly what the UI sends today, since routers
 * ship with maxFeeBps = 0. So the parameters here bound EXPOSURE rather than
 * price risk.
 *
 * What we are actually underwriting: between filling and reimbursement the
 * deposit must finalise on the source chain. If it reorgs out, the fill is
 * never reimbursed and the money is gone. `minConfirmations` is the only lever
 * against that, and the caps bound how much can be lost at once.
 *
 * The decision is deliberately a pure function so the policy -- the part that
 * loses money when it is wrong -- is testable without a chain. It imports
 * nothing from config or logging on purpose: pulling those in makes the module
 * exit(2) without a full relayer environment, which would put the safety rules
 * out of reach of unit tests.
 */
export interface FastFillPolicy {
  enabled: boolean;
  /** Source-chain confirmations required before we believe a deposit. */
  minConfirmations: number;
  /** Largest single deposit we will front. */
  maxFillAmount: bigint;
  /** Cap on unreimbursed exposure for one STRATO token. */
  maxInFlightPerToken: bigint;
  /** Cap on unreimbursed exposure across all tokens. */
  maxInFlightTotal: bigint;
  /** Chains with a trustless bridge-in. Filling anywhere else can never be
   *  reimbursed, because reimbursement happens inside EthBridgeIn.claim. */
  allowedChainIds: number[];
  /** STRATO tokens we hold inventory in and are willing to front. */
  allowedStratoTokens: string[];
}

/** A deposit observed on the source chain, as a fill candidate. */
export interface FillCandidate {
  depositKey: string;
  externalChainId: number;
  /** Deposit amount in the units the bridge will mint 1:1. */
  amount: bigint;
  /** Most the depositor will leave us. Zero on V1 router logs. */
  maxFee: bigint;
  stratoRecipient: string;
  targetStratoToken: string;
  /** Source-chain confirmations this deposit currently has. */
  confirmations: number;
  /** True if EthBridgeIn already records a fill for this depositKey. */
  alreadyFilled: boolean;
  /** True if the deposit has already been claimed. */
  alreadyClaimed: boolean;
}

/** Unreimbursed exposure, so caps are enforced against reality. */
export interface Exposure {
  total: bigint;
  byToken: Record<string, bigint>;
}

export type FillDecision =
  | { fill: true; payAmount: bigint }
  | { fill: false; reason: string };

const norm = (a: string) => a.toLowerCase().replace(/^0x/, "");

/**
 * Decide whether to fast-fill a candidate.
 *
 * Ordered cheapest-and-most-decisive first, so a rejection reason names the
 * real cause rather than whichever check happened to run.
 */
export const decideFill = (
  candidate: FillCandidate,
  policy: FastFillPolicy,
  exposure: Exposure,
): FillDecision => {
  if (!policy.enabled) return { fill: false, reason: "fast fill disabled" };

  // Terminal states first: these never become fillable.
  if (candidate.alreadyClaimed) return { fill: false, reason: "deposit already claimed" };
  if (candidate.alreadyFilled) return { fill: false, reason: "deposit already filled" };

  if (!policy.allowedChainIds.includes(candidate.externalChainId)) {
    return { fill: false, reason: `chain ${candidate.externalChainId} not enabled for fast fill` };
  }
  if (!policy.allowedStratoTokens.some((t) => norm(t) === norm(candidate.targetStratoToken))) {
    return { fill: false, reason: `token ${candidate.targetStratoToken} not enabled for fast fill` };
  }

  if (candidate.amount <= 0n) return { fill: false, reason: "non-positive amount" };
  // A fee at or above the amount would make payAmount zero, which fastFill
  // rejects anyway. Treat it as malformed rather than filling for nothing.
  if (candidate.maxFee >= candidate.amount) {
    return { fill: false, reason: "maxFee >= amount" };
  }

  if (candidate.confirmations < policy.minConfirmations) {
    return {
      fill: false,
      reason: `only ${candidate.confirmations}/${policy.minConfirmations} confirmations`,
    };
  }

  if (candidate.amount > policy.maxFillAmount) {
    return { fill: false, reason: "amount above per-fill cap" };
  }

  // We front (amount - maxFee) and are reimbursed `amount`, so exposure is
  // measured by what we pay out.
  const payAmount = candidate.amount - candidate.maxFee;

  const tokenKey = norm(candidate.targetStratoToken);
  const tokenInFlight = exposure.byToken[tokenKey] ?? 0n;
  if (tokenInFlight + payAmount > policy.maxInFlightPerToken) {
    return { fill: false, reason: "per-token in-flight cap reached" };
  }
  if (exposure.total + payAmount > policy.maxInFlightTotal) {
    return { fill: false, reason: "total in-flight cap reached" };
  }

  return { fill: true, payAmount };
};

/** Add a just-issued fill to the running exposure. */
export const addExposure = (exposure: Exposure, token: string, payAmount: bigint): Exposure => {
  const key = norm(token);
  return {
    total: exposure.total + payAmount,
    byToken: { ...exposure.byToken, [key]: (exposure.byToken[key] ?? 0n) + payAmount },
  };
};

/** Drop a reimbursed fill from the running exposure, never going negative. */
export const releaseExposure = (exposure: Exposure, token: string, payAmount: bigint): Exposure => {
  const key = norm(token);
  const cur = exposure.byToken[key] ?? 0n;
  const next = cur > payAmount ? cur - payAmount : 0n;
  return {
    total: exposure.total > payAmount ? exposure.total - payAmount : 0n,
    byToken: { ...exposure.byToken, [key]: next },
  };
};

/**
 * Plan the transactions for a fill. Kept separate from sending so the shape is
 * assertable in tests.
 *
 * The approve is scoped to exactly this fill rather than left unlimited: this
 * key is hot in a long-running relayer, and an unbounded allowance turns a key
 * compromise into a drain of the whole inventory.
 */
export const buildFillTxs = (
  bridgeInAddress: string,
  candidate: FillCandidate,
  payAmount: bigint,
) => [
  {
    contractName: "Token",
    contractAddress: norm(candidate.targetStratoToken),
    method: "approve",
    args: { spender: norm(bridgeInAddress), value: payAmount.toString() },
  },
  {
    contractName: "EthBridgeIn",
    contractAddress: norm(bridgeInAddress),
    method: "fastFill",
    args: {
      depositKey: norm(candidate.depositKey),
      recipient: norm(candidate.stratoRecipient),
      stratoToken: norm(candidate.targetStratoToken),
      payAmount: payAmount.toString(),
    },
  },
];
