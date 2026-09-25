import { Interface } from "ethers";
import {
  config,
  getNativeRepresentationBridgeAddress,
  NATIVE_REDEMPTION_EVENT_SIGNATURES,
} from "../config";
import { getCurrentBlockNumber, getChainLogs, isChainConfigured } from "../services/rpcService";
import { getEnabledChains } from "../services/cirrusService";
import { recordNativeDepositBatch } from "../services/bridgeService";
import { nativeBlockTrackingService } from "../services/nativeBlockTrackingService";
import { NativeDepositArgs } from "../types";
import { logError, logInfo } from "../utils/logger";

/// Decoded with an Interface rather than by slicing the data blob: the
/// fee-bearing variant appends three words, and hand-slicing two of five would
/// read a fee as an amount.
export const NATIVE_REDEMPTION_EVENTS_ABI = [
  "event RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)",
  "event RedemptionRequestedWithFee(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId, uint256 maxFee, uint256 requestedAt, uint256 feeHalfLife)",
];

const redemptionEvents = new Interface(NATIVE_REDEMPTION_EVENTS_ABI);

const normalize = (value: string): string => value.toLowerCase();

export const parseNativeDepositLog = (
  chainId: number,
  log: any,
): NativeDepositArgs | null => {
  if (!log.transactionHash || log.topics.length < 4) {
    return null;
  }

  const parsed = redemptionEvents.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) {
    return null;
  }

  const base: NativeDepositArgs = {
    externalChainId: chainId,
    externalBridge: normalize(log.address),
    externalRedemptionId: parsed.args.redemptionId.toString(),
    externalSender: normalize(parsed.args.sender),
    representationToken: normalize(parsed.args.representationToken),
    externalTxHash: log.transactionHash,
    stratoRecipient: normalize(parsed.args.stratoRecipient),
    stratoTokenAmount: parsed.args.amount.toString(),
  };

  if (parsed.name !== "RedemptionRequestedWithFee") {
    return base;
  }

  return {
    ...base,
    feeTerms: {
      maxFee: parsed.args.maxFee.toString(),
      // The ORIGIN chain's timestamp, passed through unchanged: STRATO starts
      // the fee decay there, so relayer lag is refunded to the user.
      requestedAt: parsed.args.requestedAt.toString(),
      feeHalfLife: parsed.args.feeHalfLife.toString(),
    },
  };
};

const pollChainNativeRedemptions = async (chainId: number) => {
  const nativeRepresentationBridge = getNativeRepresentationBridgeAddress(chainId);
  if (!nativeRepresentationBridge) {
    return;
  }
  if (!isChainConfigured(chainId)) {
    return;
  }

  const currentBlock = await getCurrentBlockNumber(chainId);
  const lastProcessedBlock = await nativeBlockTrackingService.getLastProcessedBlock(chainId);

  if (lastProcessedBlock >= currentBlock) {
    return;
  }

  const logs = await getChainLogs(
    chainId,
    lastProcessedBlock + 1,
    currentBlock,
    nativeRepresentationBridge,
    NATIVE_REDEMPTION_EVENT_SIGNATURES,
  );

  const deposits = logs
    .map((log) => parseNativeDepositLog(chainId, log))
    .filter((deposit): deposit is NativeDepositArgs => deposit !== null);

  if (deposits.length > 0) {
    for (const deposit of deposits) {
      await recordNativeDepositBatch([deposit]);
    }
    logInfo(
      "NativeRedemptionPolling",
      `Recorded ${deposits.length} native redemption deposits for chain ${chainId}`,
    );
  }

  await nativeBlockTrackingService.updateLastProcessedBlockLocally(chainId, currentBlock);
};

export const startNativeRedemptionPolling = () => {
  const poll = async () => {
    try {
      const enabledChains = Array.from((await getEnabledChains()).values());

      await Promise.all(
        enabledChains.map(async (chainInfo) => {
          if (!chainInfo.externalChainId) {
            return;
          }

          await pollChainNativeRedemptions(Number(chainInfo.externalChainId));
        }),
      );
    } catch (error) {
      logError("NativeRedemptionPolling", error as Error, {
        operation: "startNativeRedemptionPolling",
      });
    }
  };

  const run = async () => {
    await poll();
    setTimeout(run, config.polling.bridgeInInterval);
  };

  void run();

  logInfo("NativeRedemptionPolling", "Started native redemption polling");
};
