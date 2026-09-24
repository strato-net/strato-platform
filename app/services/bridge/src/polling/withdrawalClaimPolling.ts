import { AbiCoder, keccak256 } from "ethers";
import { config } from "../config";
import {
  getEnabledChains,
  getWithdrawalsByStatus,
  getNativeWithdrawalsByStatus,
} from "../services/cirrusService";
import { recordWithdrawalClaim } from "../services/bridgeService";
import {
  getBlockTimestamp,
  getChainLogs,
  getCurrentBlockNumber,
  isChainConfigured,
} from "../services/rpcService";
import {
  fillSourcesForChain,
  matchFillToWithdrawal,
  parseFillLog,
  toClaimArgs,
  ParsedFill,
  RawFillLog,
  WITHDRAWAL_FILLED_EVENT_SIGNATURE,
} from "../services/withdrawalClaimService";
import { eth } from "../utils/api";
import { logError, logInfo } from "../utils/logger";

/**
 * Mirror solver claims from the external chains back onto STRATO.
 *
 * This is the relayer's new job, and it moves no money: the solver is paid on
 * the external chain by that chain's own settlement. What the mirror buys is
 * the thing STRATO cannot see for itself -- that somebody has already paid this
 * user -- and the reason it matters is {abortWithdrawal}: without the record, a
 * user could take a solver's tokens on one chain and their own escrow back on
 * the other. STRATO re-checks the arithmetic, so a wrong report is refused
 * rather than believed.
 *
 * Claims are read from whichever withdrawals are still open, rather than from a
 * block watermark, because a claim only matters while the withdrawal it belongs
 * to can still be aborted. A missed one is caught on the next tick; a claim on
 * a withdrawal that has already settled is simply moot.
 */

// A claim can be taken at any rung, so the scan has to cover the whole window a
// withdrawal stays open for rather than only new blocks.
const DEFAULT_CLAIM_LOOKBACK_BLOCKS = 5000;

const lookbackFor = (chainId: number): number =>
  Number(process.env[`CHAIN_${chainId}_CLAIM_LOOKBACK_BLOCKS`]) ||
  DEFAULT_CLAIM_LOOKBACK_BLOCKS;

// The highest rung already recorded per withdrawal, so a tick does not re-report
// a claim STRATO has. Advisory only: STRATO refuses a non-advancing index
// anyway, and this just keeps the log quiet.
const reportedRungs = new Map<string, number>();

let cachedStratoNetworkId: bigint | null = null;

const getStratoNetworkId = async (): Promise<bigint> => {
  if (cachedStratoNetworkId != null) return cachedStratoNetworkId;
  const metadata: any = await eth.get("/metadata");
  if (metadata?.networkID == null) {
    throw new Error("Network ID not found in STRATO metadata");
  }
  cachedStratoNetworkId = BigInt(metadata.networkID.toString());
  return cachedStratoNetworkId;
};

/// keccak(sourceChainId, sourceBridge, withdrawalId) -- the same preimage both
/// external bridges use, so a key computed here matches a key emitted there.
const withdrawalKeyFor = (
  sourceChainId: bigint,
  sourceBridge: string,
  withdrawalId: string,
): string =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [sourceChainId, sourceBridge, withdrawalId],
    ),
  ).toLowerCase();

const shouldReport = (bridgeKey: string, fill: ParsedFill): boolean => {
  const seen = reportedRungs.get(bridgeKey);
  return seen === undefined || fill.claimIndex > seen;
};

const reportFills = async <T extends { withdrawalId: string }>(
  fills: ParsedFill[],
  openWithdrawals: T[],
  keysByWithdrawalId: Map<string, string>,
  externalChainId: number,
  bridge: "MercataBridge" | "StratoNativeBridge",
) => {
  // Oldest rung first: STRATO requires a claim index to advance, so reporting
  // out of order would drop the rungs in between.
  const ordered = [...fills].sort((a, b) => a.claimIndex - b.claimIndex);

  for (const fill of ordered) {
    const withdrawal = matchFillToWithdrawal(fill, keysByWithdrawalId, openWithdrawals);
    if (!withdrawal) continue;

    const bridgeKey = `${bridge}:${withdrawal.withdrawalId}`;
    if (!shouldReport(bridgeKey, fill)) continue;

    const claimedAt = await getBlockTimestamp(externalChainId, fill.blockNumber);
    await recordWithdrawalClaim(
      toClaimArgs(fill, String(withdrawal.withdrawalId), externalChainId, claimedAt),
      bridge,
    );
    reportedRungs.set(bridgeKey, fill.claimIndex);
  }
};

const pollChainForClaims = async (
  externalChainId: number,
  depositRouter: string | undefined,
  sourceChainId: bigint,
) => {
  if (!isChainConfigured(externalChainId)) return;

  const sources = fillSourcesForChain(externalChainId, depositRouter);
  if (sources.length === 0) return;

  const [initiated, pendingReview, nativeInitiated, nativePending] = await Promise.all([
    getWithdrawalsByStatus("1"),
    getWithdrawalsByStatus("2"),
    getNativeWithdrawalsByStatus("1"),
    getNativeWithdrawalsByStatus("2"),
  ]);

  const openByBridge = {
    MercataBridge: [...initiated, ...pendingReview].filter(
      (w) => Number(w.externalChainId) === externalChainId,
    ),
    StratoNativeBridge: [...nativeInitiated, ...nativePending].filter(
      (w) => Number(w.externalChainId) === externalChainId,
    ),
  };

  if (
    openByBridge.MercataBridge.length === 0 &&
    openByBridge.StratoNativeBridge.length === 0
  ) {
    return;
  }

  const currentBlock = await getCurrentBlockNumber(externalChainId);
  const fromBlock = Math.max(0, currentBlock - lookbackFor(externalChainId));

  for (const source of sources) {
    const open = openByBridge[source.bridge];
    if (open.length === 0) continue;

    const bridgeAddress =
      source.bridge === "MercataBridge"
        ? config.bridge.address!
        : config.nativeBridge.address;
    if (!bridgeAddress) continue;

    const keysByWithdrawalId = new Map<string, string>(
      open.map((w): [string, string] => [
        String(w.withdrawalId),
        withdrawalKeyFor(sourceChainId, bridgeAddress, String(w.withdrawalId)),
      ]),
    );

    const logs = (await getChainLogs(
      externalChainId,
      fromBlock,
      currentBlock,
      source.address,
      WITHDRAWAL_FILLED_EVENT_SIGNATURE,
    )) as RawFillLog[];

    const fills = logs
      .map(parseFillLog)
      .filter((fill): fill is ParsedFill => fill !== null);
    if (fills.length === 0) continue;

    // Both bridges' records are narrowed to the one field the mirror needs:
    // matching is by recomputed withdrawal key, and nothing else about the
    // record is read here.
    await reportFills(
      fills,
      open.map((w) => ({ withdrawalId: String(w.withdrawalId) })),
      keysByWithdrawalId,
      externalChainId,
      source.bridge,
    );
  }
};

export const startWithdrawalClaimPolling = (): void => {
  const interval = config.polling.bridgeOutInterval ?? 60_000;

  const poll = async () => {
    try {
      const [chains, sourceChainId] = await Promise.all([
        getEnabledChains(),
        getStratoNetworkId(),
      ]);
      if (!chains.size) return;

      const results = await Promise.allSettled(
        Array.from(chains.values()).map((chain) =>
          pollChainForClaims(
            Number(chain.externalChainId),
            chain.depositRouter,
            sourceChainId,
          ),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          logError("WithdrawalClaimPolling", result.reason as Error, {
            operation: "pollChainForClaims",
            chain: Array.from(chains.values())[index],
          });
        }
      });
    } catch (error) {
      logError("WithdrawalClaimPolling", error as Error, {
        operation: "startWithdrawalClaimPolling",
      });
    }
  };

  const run = async () => {
    await poll();
    setTimeout(run, interval);
  };

  void run();
  logInfo("WithdrawalClaimPolling", "Started solver claim mirroring");
};
