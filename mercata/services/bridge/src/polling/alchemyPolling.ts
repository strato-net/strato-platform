import { config, WAD } from "../config";
import {
  getEnabledChains,
  getBridgeInfo,
  getRebaseFactors,
} from "../services/cirrusService";
import { depositBatch } from "../services/bridgeService";
import { blockTrackingService } from "../services/blockTrackingService";
import { NonEmptyArray, DepositArgs, ChainInfo } from "../types";
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError, logInfo } from "../utils/logger";
import { normalizeAddress } from "../utils/utils";

import {
  DEPOSIT_EVENT_SIGNATURE,
  REP_BURN_EVENT_SIGNATURE,
} from "../config";

const parseDepositEvents = async (logs: any[], externalChainId: number): Promise<DepositArgs[]> => {
  return logs.map((log) => {
    const externalToken = normalizeAddress(log.topics[1]);
    const externalSender = normalizeAddress(log.topics[2]);
    const stratoRecipient = normalizeAddress(log.topics[3]);
    // Event: DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)
    // Data layout: [amount(32 bytes)][targetStratoToken(32 bytes)][depositId(32 bytes)]
    const externalTokenAmount = BigInt("0x" + log.data.substring(2, 66)).toString();
    const targetStratoTokenWord = log.data.substring(66, 130);
    const targetStratoToken = normalizeAddress("0x" + targetStratoTokenWord.slice(-40));

    return {
      externalChainId,
      externalSender,
      externalToken,
      externalTokenAmount,
      externalTxHash: log.transactionHash,
      stratoRecipient,
      targetStratoToken,
    };
  });
};

// Parse RepresentationBurned logs into DepositArgs. The STRATO-side
// MercataBridge treats these as deposits — confirmDeposit routes to
// StratoCustodyVault.unlock when the asset is registered with isNative=true.
//
// Event: RepresentationBurned(
//   address indexed stratoToken,
//   address indexed from,
//   address indexed stratoRecipient,
//   address representationToken,
//   uint256 amount
// )
//
// We set `externalToken` to the representation token (topic stripped from
// the non-indexed `representationToken` field) so the asset lookup on
// MercataBridge — keyed by [externalToken][chainId] — resolves to the
// native-asset mapping set up by setAsset(isNative=true).
const parseBurnEvents = (logs: any[], externalChainId: number): DepositArgs[] => {
  const parsed: DepositArgs[] = [];
  for (const log of logs) {
    if (!Array.isArray(log?.topics) || log.topics.length < 4) continue;
    const stratoToken = normalizeAddress(log.topics[1]);
    const externalSender = normalizeAddress(log.topics[2]);
    const stratoRecipient = normalizeAddress(log.topics[3]);

    // Data layout (non-indexed fields): [representationToken(32)][amount(32)]
    const data = typeof log.data === "string" ? log.data : "0x";
    if (data.length < 2 + 64 + 64) continue;
    const repToken = normalizeAddress("0x" + data.substring(2, 66).slice(-40));
    const amountHex = "0x" + data.substring(66, 130);
    const externalTokenAmount = BigInt(amountHex).toString();

    parsed.push({
      externalChainId,
      externalSender,
      externalToken: repToken,
      externalTokenAmount,
      externalTxHash: log.transactionHash,
      stratoRecipient,
      // For burn-initiated deposits the "target" on STRATO is the canonical
      // native token. This is also carried as topic1 on the burn event.
      targetStratoToken: stratoToken,
    });
  }
  return parsed;
};

const pollChainForDeposits = async (chainInfo: ChainInfo) => {
  const externalChainId = chainInfo.externalChainId;
  const depositRouter = chainInfo.depositRouter;
  const representationBridge = chainInfo.representationBridge || "";
  const blockchainLastProcessedBlock = chainInfo.lastProcessedBlock;
  // Get the effective last processed block (max of blockchain and local storage)
  const lastProcessedBlock = await blockTrackingService.getEffectiveLastProcessedBlock(
    externalChainId,
    blockchainLastProcessedBlock
  );

  let currentBlock: number | null = null;
  let depositsProcessed = false;

  try {
    if (!isChainConfigured(externalChainId)) return;

    currentBlock = await getCurrentBlockNumber(externalChainId);
    if (currentBlock <= lastProcessedBlock) {
      return;
    }

    // Fetch DepositRouted logs and (if rep bridge is configured for this
    // chain) RepresentationBurned logs in parallel over the same window.
    const [depositLogs, burnLogs] = await Promise.all([
      getChainLogs(
        externalChainId,
        lastProcessedBlock + 1,
        currentBlock,
        depositRouter,
        DEPOSIT_EVENT_SIGNATURE,
      ),
      representationBridge
        ? getChainLogs(
            externalChainId,
            lastProcessedBlock + 1,
            currentBlock,
            representationBridge,
            REP_BURN_EVENT_SIGNATURE,
          )
        : Promise.resolve([] as any[]),
    ]);

    if (depositLogs.length === 0 && burnLogs.length === 0) {
      // No deposits found - only update locally
      await blockTrackingService.updateLastProcessedBlockLocally(externalChainId, currentBlock);
      return;
    }

    const [parsedDeposits, parsedBurns] = await Promise.all([
      parseDepositEvents(depositLogs, externalChainId),
      Promise.resolve(parseBurnEvents(burnLogs, externalChainId)),
    ]);

    const filteredDeposits = parsedDeposits.filter(
      (deposit) => deposit !== null,
    );
    const failedParses = parsedDeposits.length - filteredDeposits.length;

    // Apply rebase factor for xStock tokens (divide by currentMultiplier to
    // get underlying shares). Burns are already emitted in 18-decimal STRATO
    // precision with the canonical amount and do not need rebasing.
    if (filteredDeposits.length > 0) {
      const targetTokens = [...new Set(filteredDeposits.map(d => d.targetStratoToken))];
      const factors = await getRebaseFactors(targetTokens);
      for (const deposit of filteredDeposits) {
        const stratoKey = deposit.targetStratoToken.toLowerCase().replace(/^0x/, "");
        const factor = factors.get(stratoKey);
        if (factor) {
          const original = BigInt(deposit.externalTokenAmount);
          const adjusted = (original * WAD) / factor;
          logInfo("AlchemyPolling", `Rebasing deposit ${deposit.externalTxHash}: ${original} → ${adjusted} (factor=${factor})`);
          deposit.externalTokenAmount = adjusted.toString();
        }
      }
    }

    const allDeposits: DepositArgs[] = [...filteredDeposits, ...parsedBurns];

    if (parsedBurns.length > 0) {
      logInfo(
        "AlchemyPolling",
        `Chain ${externalChainId}: observed ${parsedBurns.length} RepresentationBurned event(s) for native return-to-STRATO flow`,
      );
    }

    // Process valid deposits
    if (allDeposits.length > 0) {
      await depositBatch(allDeposits as NonEmptyArray<DepositArgs>);
      depositsProcessed = true;
    }

    // If there were parse failures, throw error after processing valid ones
    if (failedParses > 0) {
      throw new Error(`Failed to parse ${failedParses} out of ${parsedDeposits.length} deposits for chain ${externalChainId}`);
    }
  } finally {
    // Update lastProcessedBlock based on whether deposits were processed
    if (currentBlock !== null && currentBlock > lastProcessedBlock) {
      try {
        if (depositsProcessed) {
          // Deposits were processed - update both local and blockchain
          await blockTrackingService.updateLastProcessedBlockEverywhere(externalChainId, currentBlock);
        }
        // Note: Local-only update for no deposits case is already handled above in the "no logs" section
      } catch (updateError) {
        // Enhance error with context before re-throwing
        const enhancedError = new Error(`Block update failed for chain ${externalChainId} block ${currentBlock}: ${(updateError as Error).message}\nOriginal stack: ${(updateError as Error).stack}`);
        throw enhancedError;
      }
    }
  }
};

export const startMultiChainDepositPolling = () => {
  const interval = config.polling.bridgeInInterval || 100_000;
  const poll = async () => {
    try {
      const [chains, info] = await Promise.all([getEnabledChains(), getBridgeInfo()]);
      if (!chains.size) return logInfo("AlchemyPolling", "No enabled chains");
      if (info?.withdrawalsPaused) logInfo("AlchemyPolling", "Withdrawals are paused");
      if (info?.depositsPaused) return logInfo("AlchemyPolling", "Deposits are paused");
      const infos = Array.from(chains.values());
      (await Promise.allSettled(infos.map(pollChainForDeposits)))
        .forEach((r, i) => r.status === "rejected" && logError("AlchemyPolling", r.reason, { operation: "pollChainForDeposits", chain: infos[i]}));
    } catch (e) {
      logError("AlchemyPolling", e as Error, { operation: "startMultiChainDepositPolling" });
    }
  };
  poll();
  setInterval(poll, interval);
};
