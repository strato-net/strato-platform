/**
 * @file nativeRedemptionProof.service.ts
 *
 * Build the trustless-claim proof bundle for **native redemptions** —
 * the external→STRATO direction of the StratoNativeBridge flow.
 *
 *   1. User burns a representation token on an external chain via
 *      `StratoNativeRepresentationBridge.requestRedemption(...)`.
 *   2. That emits `RedemptionRequested(repToken, amount, sender,
 *      stratoRecipient, redemptionId)`.
 *   3. After source-chain finality, the user (or anyone) calls
 *      `StratoNativeBridgeIn.claim(...)` on STRATO with an MPT proof
 *      of that log against the configured light client's anchored
 *      receipts root.
 *
 * This module produces the {@link ClaimInputs} bundle for step 3 — the
 * receipts-trie MPT proof + the receipt blob. The anchor side (proving
 * the source-chain block to the light client) is identical to the
 * standard flow, so the orchestrator continues to use
 * {@link bridgeProof.service}'s anchor builders, {@link baseProof.service},
 * etc.
 *
 * Why a separate file at all (vs. just calling `buildBaseClaimInputs`
 * with a different sig): structural clarity and a unique error type
 * for the UI's 404 path. The receipts-trie semantics are identical
 * across EVM chains, so the actual work delegates to the existing
 * builders.
 */

import { ClaimInputs } from "./bridgeProof.service";
import {
  buildBaseClaimInputs,
  UnsupportedL2ChainError,
} from "./baseProof.service";
import { getTransactionReceipt } from "./ethRpc.service";

// ─────────────────────────────────────────────────────────────────────
// Canonical event signature
// ─────────────────────────────────────────────────────────────────────

/**
 * keccak256("RedemptionRequested(address,uint256,address,address,uint96)")
 *
 * Matches the event declared by {StratoNativeRepresentationBridge.sol}.
 * Held as a module-level constant rather than a per-chain config field
 * because the event shape is part of the contract's published ABI —
 * a change would be a coordinated upgrade across the rep-bridge + the
 * STRATO-side `StratoNativeBridgeIn`'s `redemptionRequestedSig` field.
 *
 * The on-chain `StratoNativeBridgeIn` reads this sig from its own
 * configured state (set at `initialize()`), so this constant is just
 * the off-chain mirror — they must agree.
 */
export const REDEMPTION_REQUESTED_SIG =
  "0x8c3e37d44910f9975cca29b1cbb70b943d7107cf2091576b3291d4316c74129a";

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

/**
 * The supplied tx hash either doesn't have a receipt yet, or has one
 * but no `RedemptionRequested` log inside it. Distinct from the
 * standard path's "no DepositRouted log" so the UI can render the
 * right copy ("did you submit a redemption?" vs "did you submit a
 * deposit?").
 */
export class NoRedemptionLogError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NoRedemptionLogError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Build {@link ClaimInputs} for {StratoNativeBridgeIn.claim}.
 *
 * The receipt-MPT-proof construction is identical to every other
 * EVM-chain claim path; we delegate to {@link buildBaseClaimInputs}
 * with the RedemptionRequested signature. The only meaningful
 * difference vs the standard flow is the event we're looking for —
 * the trie semantics, RLP encoding, and proof verification are the
 * same on every EVM chain.
 *
 * Caller is responsible for already anchoring the source-chain block
 * on the appropriate light client before invoking
 * {StratoNativeBridgeIn.claim}.
 *
 * @param chainId               External chain id where the redemption
 *                              was emitted (1, 11155111, 8453, 84532,
 *                              59144, 59141, 56, 97, …).
 * @param redemptionTxHash      Tx hash of the user's `requestRedemption`
 *                              call on `StratoNativeRepresentationBridge`.
 * @param expectedEmitter       Optional: the rep-bridge address we
 *                              expect to have emitted the log. When
 *                              provided we pre-validate so we can give
 *                              a clean error before sending an on-chain
 *                              tx that would otherwise revert with
 *                              "SNBI: log not from rep bridge".
 *
 * @throws {UnsupportedL2ChainError} if `chainId` has no RPC config.
 * @throws {NoRedemptionLogError}    if the receipt has no matching log.
 */
export async function buildNativeRedemptionClaimInputs(
  chainId: string,
  redemptionTxHash: string,
  expectedEmitter?: string,
): Promise<ClaimInputs> {
  // Pre-validate emitter when supplied so the surface error is
  // actionable. {buildBaseClaimInputs} matches only on topic[0]; the
  // on-chain SNBI also requires log.address == representationBridge,
  // so a stale rep-bridge config could otherwise let this build
  // succeed and the on-chain claim revert downstream.
  if (expectedEmitter) {
    const receipt = await getTransactionReceipt(chainId, redemptionTxHash);
    if (!receipt) {
      throw new NoRedemptionLogError(
        `buildNativeRedemptionClaimInputs: receipt not found for tx ${redemptionTxHash}`,
      );
    }
    const sigLower = REDEMPTION_REQUESTED_SIG.toLowerCase();
    const emitterLower = expectedEmitter.toLowerCase();
    const found = receipt.logs.some(
      (l) =>
        l.topics.length > 0 &&
        l.topics[0].toLowerCase() === sigLower &&
        l.address.toLowerCase() === emitterLower,
    );
    if (!found) {
      throw new NoRedemptionLogError(
        `buildNativeRedemptionClaimInputs: no RedemptionRequested log from ${expectedEmitter} in tx ${redemptionTxHash} ` +
          `(looked for topic[0] == ${REDEMPTION_REQUESTED_SIG})`,
      );
    }
  }

  try {
    return await buildBaseClaimInputs(
      chainId,
      redemptionTxHash,
      REDEMPTION_REQUESTED_SIG,
    );
  } catch (err: any) {
    // {buildBaseClaimInputs} throws a plain `Error` with
    // "no DepositRouted log" — rewrap so the error type and message
    // match the native flow's vocabulary.
    if (typeof err?.message === "string" && err.message.includes("no DepositRouted log")) {
      throw new NoRedemptionLogError(
        err.message.replace("no DepositRouted log", "no RedemptionRequested log"),
      );
    }
    throw err;
  }
}

// Re-export so controller can dispatch on this without importing from
// two services.
export { UnsupportedL2ChainError };
