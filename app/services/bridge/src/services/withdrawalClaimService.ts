import { Interface } from "ethers";
import {
  getNativeRepresentationBridgeAddress,
  WITHDRAWAL_FILLED_EVENT_SIGNATURE,
} from "../config";
import { WithdrawalClaimArgs } from "../types";

/**
 * Reading solver claims off an external chain.
 *
 * Both external-chain bridges emit the same `WithdrawalFilled` shape when a
 * solver takes over a withdrawal's claim, keyed by the withdrawal key rather
 * than by the withdrawal id -- the key is a hash, so the id has to be recovered
 * by matching against the withdrawals the relayer already knows about. That is
 * deliberate on the contract side: a claim is bound to a withdrawal's identity,
 * not to a number that two bridges could both use.
 */
export const WITHDRAWAL_FILLED_ABI = [
  "event WithdrawalFilled(bytes32 indexed withdrawalKey, address indexed filler, address indexed paidTo, uint32 claimIndex, address token, uint256 amount, uint256 feeCharged, uint256 netPaid)",
];

const filledEvents = new Interface(WITHDRAWAL_FILLED_ABI);

export interface RawFillLog {
  address: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  topics: string[];
  transactionHash: string;
}

export interface ParsedFill {
  withdrawalKey: string;
  claimant: string;
  paidTo: string;
  claimIndex: number;
  token: string;
  amount: string;
  feeCharged: string;
  netPaid: string;
  externalFillTxHash: string;
  blockNumber: number;
}

export const parseFillLog = (log: RawFillLog): ParsedFill | null => {
  const parsed = filledEvents.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) return null;

  return {
    withdrawalKey: parsed.args.withdrawalKey.toLowerCase(),
    claimant: parsed.args.filler.toLowerCase(),
    paidTo: parsed.args.paidTo.toLowerCase(),
    claimIndex: Number(parsed.args.claimIndex),
    token: parsed.args.token.toLowerCase(),
    amount: parsed.args.amount.toString(),
    feeCharged: parsed.args.feeCharged.toString(),
    netPaid: parsed.args.netPaid.toString(),
    externalFillTxHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  };
};

/**
 * Which external-chain contracts to watch for fills on a given chain: the
 * deposit router (for MercataBridge withdrawals) and the representation bridge
 * (for native ones). Either may be absent on a chain that only runs one.
 */
export const fillSourcesForChain = (
  chainId: number,
  depositRouter?: string,
): Array<{ address: string; bridge: "MercataBridge" | "StratoNativeBridge" }> => {
  const sources: Array<{
    address: string;
    bridge: "MercataBridge" | "StratoNativeBridge";
  }> = [];

  if (depositRouter) {
    sources.push({ address: depositRouter, bridge: "MercataBridge" });
  }

  const representationBridge = getNativeRepresentationBridgeAddress(chainId);
  if (representationBridge) {
    sources.push({ address: representationBridge, bridge: "StratoNativeBridge" });
  }

  return sources;
};

export { WITHDRAWAL_FILLED_EVENT_SIGNATURE };

/**
 * Match a fill to a withdrawal the relayer knows is open.
 *
 * The withdrawal key is keccak(sourceChainId, sourceBridge, withdrawalId) on
 * both external bridges, so the match is by recomputed key. Anything that does
 * not match an open withdrawal is ignored rather than guessed at: an
 * unrecognised fill is a solver who claimed something this relayer has no
 * record of, which is exactly the case where reporting it would be wrong.
 */
export const matchFillToWithdrawal = <T extends { withdrawalId: string }>(
  fill: ParsedFill,
  keysByWithdrawalId: Map<string, string>,
  openWithdrawals: T[],
): T | undefined =>
  openWithdrawals.find(
    (withdrawal) =>
      keysByWithdrawalId.get(String(withdrawal.withdrawalId)) === fill.withdrawalKey,
  );

export const toClaimArgs = (
  fill: ParsedFill,
  withdrawalId: string,
  externalChainId: number,
  claimedAt: string,
): WithdrawalClaimArgs => ({
  withdrawalId,
  externalChainId,
  claimant: fill.claimant,
  claimIndex: fill.claimIndex,
  feeCharged: fill.feeCharged,
  netPaid: fill.netPaid,
  claimedAt,
  externalFillTxHash: fill.externalFillTxHash,
});
