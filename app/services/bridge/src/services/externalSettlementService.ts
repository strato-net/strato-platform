/**
 * "Was this withdrawal already paid on the external chain?" -- asked BEFORE an
 * abort, because an abort hands the escrow back.
 *
 * WHY THIS EXISTS. The relayer used to abort whenever a Safe proposal came back
 * "rejected". But the Safe Transaction Service reports "rejected" for a
 * proposal that was merely REPLACED at its nonce, which says nothing about
 * whether the user was paid: the same payout can be executed by a different
 * Safe transaction, or minted through another path entirely. Treating
 * "my proposal is gone" as "nobody was paid" is how native withdrawals 93-96
 * were aborted on STRATO while their representation tokens already existed on
 * Sepolia -- escrow returned AND tokens minted, 4,000 USDST of unbacked supply.
 *
 * The external contracts know the truth, in one public mapping each, under the
 * same key: DepositRouter.withdrawalSettled and
 * StratoNativeRepresentationBridge.processedMints. So ask them.
 *
 * THE ASYMMETRY THAT DECIDES EVERY AMBIGUOUS CASE: aborting a withdrawal that
 * was in fact paid double-pays and cannot be undone; declining to abort one
 * that was genuinely rejected only makes someone wait. Anything short of a
 * clear "not settled" therefore HOLDS.
 */
import { AbiCoder, Interface, JsonRpcProvider, keccak256 } from "ethers";
import { getChainRpcUrl } from "../config";
import { logError, logInfo } from "../utils/logger";
import { ensureHexPrefix, safeChecksum } from "../utils/utils";

export type SettlementKind = "mercata" | "native";

export type SettlementState =
  /** Paid on the external chain. Never abort; finalize instead. */
  | { state: "settled"; txHash?: string }
  /** The contract answered and says no. Safe to abort. */
  | { state: "unsettled" }
  /** The contract predates the fast path and has no such mapping. */
  | { state: "unsupported" }
  /** Could not find out (RPC down, timeout). */
  | { state: "unknown"; reason: string };

export type AbortDecision = "abort" | "finalize" | "hold";

/**
 * What to do with a withdrawal whose proposal came back rejected.
 *
 * Pure, so the policy can be tested without a chain. `unsupported` aborts
 * because that is exactly the pre-fast-path behaviour on a contract that cannot
 * be asked, and refusing would strand every rejection on an un-upgraded chain.
 */
export function decideOnRejection(
  s: SettlementState,
  /**
   * StratoNativeBridge.finalizeWithdrawal records the external tx hash, so a
   * native withdrawal can only be finalized once that tx is found.
   * MercataBridge.finaliseWithdrawal takes the id alone.
   */
  needsTxHash = true,
): AbortDecision {
  switch (s.state) {
    case "settled": return !needsTxHash || s.txHash ? "finalize" : "hold";
    case "unsettled": return "abort";
    case "unsupported": return "abort";
    case "unknown": return "hold";
  }
}

const PROBE = new Interface([
  "function withdrawalSettled(bytes32) view returns (bool)",
  "function processedMints(bytes32) view returns (bool)",
  "event WithdrawalSettled(bytes32 indexed withdrawalKey,address indexed payee,address indexed recipient,address token,uint256 amount,uint32 claimIndex)",
  "event RepresentationMinted(uint256 sourceChainId,address indexed sourceBridge,uint256 indexed sourceWithdrawalId,address indexed stratoToken,address representationToken,address recipient,uint256 amount,bytes32 mintId)",
]);

/** Identical preimage on both contracts, by design. */
export const withdrawalKeyOf = (
  sourceChainId: bigint | string,
  sourceBridge: string,
  withdrawalId: bigint | string | number,
): string =>
  keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"],
    [BigInt(sourceChainId), safeChecksum(ensureHexPrefix(sourceBridge)), BigInt(withdrawalId)],
  ));

const LOOKBACK_BLOCKS = Number(process.env.SETTLEMENT_LOOKBACK_BLOCKS || 50_000);
const LOG_SPAN = 800;

export async function getExternalSettlementState(args: {
  kind: SettlementKind;
  chainId: number | bigint;
  /** The router (mercata) or the representation bridge (native). */
  contract: string;
  sourceChainId: bigint | string;
  sourceBridge: string;
  withdrawalId: bigint | string | number;
}): Promise<SettlementState> {
  const fn = args.kind === "mercata" ? "withdrawalSettled" : "processedMints";
  const key = withdrawalKeyOf(args.sourceChainId, args.sourceBridge, args.withdrawalId);
  const to = safeChecksum(ensureHexPrefix(args.contract));
  let provider: JsonRpcProvider | undefined;
  try {
    provider = new JsonRpcProvider(getChainRpcUrl(args.chainId));

    let settled: boolean;
    try {
      const raw = await provider.call({ to, data: PROBE.encodeFunctionData(fn, [key]) });
      // A contract without the function falls through to a fallback or returns
      // empty data; neither decodes as a bool.
      if (!raw || raw === "0x") return { state: "unsupported" };
      settled = PROBE.decodeFunctionResult(fn, raw)[0] === true;
    } catch (e: any) {
      // A REVERT means the function is not there. A transport error does not,
      // and must not be mistaken for one -- that would turn "RPC is down" into
      // "safe to abort".
      if (e?.code === "CALL_EXCEPTION") return { state: "unsupported" };
      return { state: "unknown", reason: e?.shortMessage || e?.message || "rpc error" };
    }
    if (!settled) return { state: "unsettled" };

    // Settled. Find the transaction so the STRATO record can be finalized
    // against what actually paid, not against the proposal that did not.
    const head = await provider.getBlockNumber();
    const topics = args.kind === "mercata"
      ? [PROBE.getEvent("WithdrawalSettled")!.topicHash, key]
      : [PROBE.getEvent("RepresentationMinted")!.topicHash, null,
         "0x" + BigInt(args.withdrawalId).toString(16).padStart(64, "0")];
    for (let hi = head; hi > head - LOOKBACK_BLOCKS && hi > 0; hi -= LOG_SPAN) {
      const logs = await provider.getLogs({
        address: to, topics, fromBlock: Math.max(0, hi - LOG_SPAN + 1), toBlock: hi,
      });
      if (logs.length) return { state: "settled", txHash: logs[logs.length - 1].transactionHash };
    }
    return { state: "settled" };
  } catch (e: any) {
    return { state: "unknown", reason: e?.shortMessage || e?.message || "rpc error" };
  } finally {
    provider?.destroy();
  }
}

/** Ask, decide, and say why -- the log line is the audit trail for a non-abort. */
export async function decideRejectedWithdrawal(
  label: string,
  args: Parameters<typeof getExternalSettlementState>[0],
): Promise<{ decision: AbortDecision; state: SettlementState }> {
  const state = await getExternalSettlementState(args);
  const decision = decideOnRejection(state, args.kind === "native");
  if (decision === "abort") {
    logInfo("SettlementCheck", `${label}: not settled on chain ${args.chainId} (${state.state}); abort is safe`);
  } else if (decision === "finalize") {
    logInfo("SettlementCheck",
      `${label}: proposal rejected but ALREADY PAID on chain ${args.chainId} in ` +
      `${(state as any).txHash}; finalizing instead of aborting`);
  } else {
    logError("SettlementCheck", new Error(
      `${label}: NOT aborting -- ${state.state === "settled"
        ? "paid on the external chain but the paying tx was not found in the lookback window"
        : `could not determine settlement (${(state as any).reason})`}. Needs operator attention.`));
  }
  return { decision, state };
}
